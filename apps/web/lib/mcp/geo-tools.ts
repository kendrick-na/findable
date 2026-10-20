// 읽기 전용 MCP 도구 3개 — `FINDABLE_MCP_READONLY_MODE_ENABLED` 가 켜졌을 때만 등록된다.
//
//   get_brand_measurement_summary   M-sum   저장된 최신 측정 → 노출률·수집률·못 잰 사유(근거 봉투)
//   get_answer_verdict_breakdown    M-brk   5분류 건수와 비율(분모는 기존 규칙 그대로)
//   check_official_facts            M-facts 기존 점검 재사용(같은 모드·토큰 뒤에서만)
//
// 설계 불변식
//   - `start_ai_visibility_check`·`get_ai_visibility_result` 는 **등록하지 않는다**(이름으로 불러도 없는 도구).
//   - DB 손잡이는 `ReadonlyDb`(auditJob.findMany/findFirst, brand.findFirst)뿐이다. `makeBridgeDeps()`(쓰기 가능)는 쓰지 않는다.
//   - 응답은 **화이트리스트**(geo-schemas 의 strict 스키마)로만 조립한다. 사업자번호·법인명·이메일·답변 원문·원가는 싣지 않는다.
//   - 계산하지 않는다: 분류·분모는 `summarizeAnswerBuckets`, 수집률은 `countMeasurementCoverage`, 보정은
//     `withRecomputedAuditMetrics` 를 그대로 쓴다. 이 파일은 조립만 한다(새 분류·새 분모 금지).
//   - 값이 없으면 0 이 아니라 Known.unavailable. 봉투를 못 만들면 거부가 아니라 status:"unverifiable".
//   - 허용 목록 밖 브랜드와 존재하지 않는 브랜드는 **같은** not_available 오류.
//   - 신뢰구간은 S1 머지 전까지 unavailable(not_configured).
// 도구 설명은 동작 사실만 쓴다(모델에게 행동을 지시하는 문장 금지). 모든 도구에 title + annotations.

import type { McpServer } from "@modelcontextprotocol/server";
import {
  answerGroup,
  type BucketableAnswer,
  isDiscoveryAnswer,
  summarizeAnswerBuckets,
} from "@repo/audit/answer-buckets";
import { countMeasurementCoverage } from "@repo/audit/measurement-coverage";
import {
  GAP_ACTION_KO,
  GAP_LABEL_KO,
  type GapCode,
} from "@repo/audit/measurement-gap";
import {
  isPublishableAuditResult,
  withRecomputedAuditMetrics,
} from "@repo/audit/normalize-stored-metrics";
import type {
  EvidenceEnvelope,
  McpReadonlyToolName,
  UnavailableReason,
  UnmeasuredRow,
} from "@repo/audit/proof-types";
import {
  engineSetKeyOf,
  questionLanguagesOf,
  savedQuestionSetKeyOf,
  searchSamplingVersionOf,
} from "@repo/audit/search-sampling-version";
import { z } from "zod";

import {
  type BreakdownData,
  breakdownDataSchema,
  type FactsData,
  factsDataSchema,
  LIMITS_BLOCK,
  LIMITS_EN,
  okResponseSchema,
  READONLY_ERROR_MESSAGES_KO,
  type SummaryData,
  summaryDataSchema,
  unverifiableEnvelope,
  unverifiableResponseSchema,
} from "./geo-schemas";
import { ERROR_MESSAGES_KO, LIMITS_KO, mapUrlError } from "./messages";
import { checkOfficialFacts, type FetchLike } from "./official-facts";

// [읽기 전용 DB 손잡이]

export interface StoredJobRow {
  completedAt: Date | null;
  createdAt: Date;
  id: string;
  result: unknown;
}

export interface StoredBrandRow {
  domain: string;
  id: string;
  name: string;
}

type FindArgs = Record<string, unknown>;

/** 타입으로 허용하는 읽기 메서드만 가진 DB 손잡이. 쓰기 메서드는 타입에도 없고 객체에도 없다. */
export interface ReadonlyDb {
  auditJob: {
    findFirst(args: FindArgs): Promise<StoredJobRow | null>;
    findMany(args: FindArgs): Promise<StoredJobRow[]>;
  };
  brand: {
    findFirst(args: FindArgs): Promise<StoredBrandRow | null>;
  };
}

interface PrismaLike {
  auditJob: {
    findFirst(args: never): Promise<unknown>;
    findMany(args: never): Promise<unknown>;
  };
  brand: { findFirst(args: never): Promise<unknown> };
}

/** 실제 DB 객체에서 읽기 3개 메서드만 꺼내 감싼다. 이 객체는 그 밖의 메서드를 갖지 않는다. */
export function toReadonlyDb(db: unknown): ReadonlyDb {
  const source = db as PrismaLike;
  return {
    auditJob: {
      findFirst: (args) =>
        source.auditJob.findFirst(
          args as never
        ) as Promise<StoredJobRow | null>,
      findMany: (args) =>
        source.auditJob.findMany(args as never) as Promise<StoredJobRow[]>,
    },
    brand: {
      findFirst: (args) =>
        source.brand.findFirst(args as never) as Promise<StoredBrandRow | null>,
    },
  };
}

export interface GeoToolContext {
  allowlist: ReadonlySet<string>;
  db: ReadonlyDb;
  fetchImpl?: FetchLike;
  log: { error: (event: string, data?: Record<string, unknown>) => void };
}

// [응답 헬퍼]

function ok(structured: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

function fail(code: keyof typeof READONLY_ERROR_MESSAGES_KO) {
  const payload = {
    error: { code, message_ko: READONLY_ERROR_MESSAGES_KO[code] },
  };
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

function failUrl(code: keyof typeof ERROR_MESSAGES_KO) {
  const payload = { error: { code, message_ko: ERROR_MESSAGES_KO[code] } };
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

function unverifiable(
  tool: McpReadonlyToolName,
  reason: UnavailableReason,
  detail_ko: string,
  language?: EvidenceEnvelope["language"]
) {
  const evidence = unverifiableEnvelope(reason, detail_ko, language);
  return unverifiableResponseSchema.parse({
    message_ko: `확인 불가: ${detail_ko} 이 값은 0이 아니라 확인하지 못한 상태입니다.`,
    tool,
    status: "unverifiable",
    reason,
    language: evidence.language,
    data: null,
    evidence,
    limits_ko: LIMITS_KO,
    limits_en: LIMITS_EN,
  });
}

/**
 * 조립한 응답이 계약(strict 스키마)을 통과하면 그대로, 아니면 거부가 아니라 「확인 불가」 봉투로 낮춘다.
 * 통과는 「형태가 있다」일 뿐 「값이 맞다」가 아니다.
 */
function finalize<T extends z.ZodType>(
  tool: McpReadonlyToolName,
  dataSchema: T,
  candidate: unknown
) {
  const parsed = okResponseSchema(dataSchema).safeParse(candidate);
  if (parsed.success) {
    return parsed.data as Record<string, unknown>;
  }
  return unverifiable(
    tool,
    "not_recorded",
    "응답의 필수 칸을 채우지 못했습니다."
  ) as Record<string, unknown>;
}

// [저장 결과 읽기]

interface StoredRow extends BucketableAnswer {
  usage?: { searchUnavailable?: boolean } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowsOf(result: unknown): StoredRow[] {
  const rows = isRecord(result) ? result.engineResponses : null;
  return Array.isArray(rows)
    ? (rows.filter(isRecord) as unknown as StoredRow[])
    : [];
}

function coverageOf(rows: readonly StoredRow[]) {
  return countMeasurementCoverage(
    rows.map((r) => ({
      engineId: r.engineId,
      errorMessage: r.errorMessage,
      isStub: r.isStub ?? undefined,
    }))
  );
}

type ToolOutcome =
  | { error: "not_available" }
  | { response: Record<string, unknown> };

function rate(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

function languageKeyOf(
  stored: string | null
): EvidenceEnvelope["language"] | null {
  if (stored === "ko") {
    return { language: "ko", script: "Hang" };
  }
  if (stored === "en") {
    return { language: "en", script: "Latn" };
  }
  if (stored === "ko-en") {
    return { language: "mixed", script: null };
  }
  return null;
}

const ENGINE_ROW_LABELS_KO: Record<string, { action: string; label: string }> =
  {
    engine_error: {
      label: "엔진 응답 오류로 못 잼",
      action: "해당 답변은 비율의 분모에서 제외했습니다.",
    },
    search_unavailable: {
      label: "검색을 원했지만 검색 없이 답함",
      action: "이 답변의 출처 0건은 미수집으로 취급합니다.",
    },
    stub_response: {
      label: "키가 없어 만든 가짜 응답",
      action: "측정으로 세지 않았습니다.",
    },
  };

function unmeasuredRowsOf(
  corrected: unknown,
  rows: readonly StoredRow[]
): UnmeasuredRow[] {
  const out: UnmeasuredRow[] = [];
  const context = isRecord(corrected) ? corrected.measurementContext : null;
  const diagnostics = isRecord(context) ? context.gapDiagnostics : null;
  const codes =
    isRecord(diagnostics) && Array.isArray(diagnostics.codes)
      ? diagnostics.codes
      : [];
  for (const code of codes) {
    if (typeof code === "string" && code in GAP_LABEL_KO) {
      const gap = code as GapCode;
      // 사이트·질문 수준 사유는 회차 단위(1회차 중 1회차).
      out.push({
        action_ko: GAP_ACTION_KO[gap],
        code: gap,
        count: 1,
        denominator: 1,
        label_ko: GAP_LABEL_KO[gap],
        rate: 1,
      });
    }
  }
  const considered = rows.filter((r) => {
    const group = answerGroup(r.engineId);
    return group === "ai" || group === "search";
  });
  const tally: [keyof typeof ENGINE_ROW_LABELS_KO, number][] = [
    [
      "engine_error",
      considered.filter((r) => r.errorMessage && !r.isStub).length,
    ],
    ["stub_response", considered.filter((r) => r.isStub).length],
    [
      "search_unavailable",
      considered.filter((r) => r.usage?.searchUnavailable === true).length,
    ],
  ];
  for (const [code, n] of tally) {
    const text = ENGINE_ROW_LABELS_KO[code];
    if (n > 0 && text) {
      out.push({
        action_ko: text.action,
        code: code as UnmeasuredRow["code"],
        count: n,
        denominator: considered.length,
        label_ko: text.label,
        rate: rate(n, considered.length),
      });
    }
  }
  return out;
}

export interface BrandRun {
  corrected: unknown;
  evidence: EvidenceEnvelope;
  language: EvidenceEnvelope["language"];
  measuredAt: string;
  rows: StoredRow[];
  summary: ReturnType<typeof summarizeAnswerBuckets>;
}

type RunOutcome =
  | { ok: true; run: BrandRun }
  | {
      detail: string;
      ok: false;
      reason: UnavailableReason;
      language?: EvidenceEnvelope["language"];
    };

/** 저장된 회차 1개 → 근거 봉투. 재료가 모자라면 이유와 함께 ok:false(= 호출자가 「확인 불가」로 표시). */
export function buildBrandRun(
  brand: StoredBrandRow,
  job: StoredJobRow
): RunOutcome {
  const corrected = withRecomputedAuditMetrics(job.result);
  const rows = rowsOf(corrected);
  if (rows.length === 0) {
    return {
      ok: false,
      reason: "source_missing",
      detail: "저장된 답변 행을 찾지 못했습니다.",
    };
  }
  // 언어 미기록 회차는 합치지 않고 확인 불가로 둔다(계약 변경 없이 처리).
  const language = languageKeyOf(questionLanguagesOf(corrected));
  if (!language) {
    return {
      ok: false,
      reason: "not_recorded",
      detail: "이 회차에는 질문 언어가 기록되어 있지 않습니다.",
    };
  }
  if (!isPublishableAuditResult(corrected)) {
    return {
      ok: false,
      reason: "withheld_not_publishable",
      detail: "게시 기준을 채우지 못한 회차라 숫자를 내지 않습니다.",
      language,
    };
  }

  const measuredAt = (job.completedAt ?? job.createdAt).toISOString();
  const summary = summarizeAnswerBuckets(rows, { brandDomain: brand.domain });
  const ai = summary.ai;
  const aiRows = rows.filter(
    (r) => answerGroup(r.engineId) === "ai" && !isDiscoveryAnswer(r)
  );
  const coverage = coverageOf(aiRows);
  const contextVerdict = isRecord(corrected)
    ? corrected.mentionVerdictVersion
    : null;
  const engineIds = [
    ...new Set(
      rows
        .filter((r) => {
          const group = answerGroup(r.engineId);
          return group === "ai" || group === "search";
        })
        .map((r) => r.engineId)
    ),
  ];
  const setKey = engineSetKeyOf(corrected);
  const questionSetKey = savedQuestionSetKeyOf(corrected);

  const observed = {
    as_of: measuredAt,
    status: "known",
    value: {
      buckets: {
        confirmed: ai.confirmed,
        different_entity: ai.differentEntity,
        unknown: ai.unknown,
        engine_error: ai.engineError,
        unverified: ai.unverified,
      },
      collection: {
        attempted: coverage.attempted,
        measured: coverage.measured,
        rate: rate(coverage.measured, coverage.attempted),
        // 사용한 저장 회차 수(최신 1회). 같은 질문의 반복 횟수가 아니다.
        repeat_count: 1,
        suppressed: false,
        suppression_threshold: null,
        unit: "engine",
      },
      denominator: ai.adjudicated,
      exposure_count: ai.confirmed,
      exposure_rate: rate(ai.confirmed, ai.adjudicated),
      group: "ai_brand",
      interval: {
        as_of: measuredAt,
        status: "unavailable",
        reason: "not_configured",
        detail_ko: "신뢰구간 계산이 아직 연결되지 않았습니다.",
      },
    },
  };

  const evidence = {
    comparison: null,
    engine_model: {
      as_of: measuredAt,
      status: "known",
      value: engineIds.map((engine_id) => ({
        call_source: null,
        engine_id,
        engine_set: setKey,
        model_id: {
          as_of: measuredAt,
          status: "unavailable",
          reason: "not_recorded",
          detail_ko: "엔진 모델 버전은 기록되어 있지 않습니다.",
        },
      })),
    },
    index_check: {
      as_of: null,
      status: "unavailable",
      reason: "not_configured",
      detail_ko: "색인 확인 방법이 설정되어 있지 않습니다.",
    },
    language,
    limits: LIMITS_BLOCK,
    measured_at: {
      as_of: measuredAt,
      status: "known",
      value: { first: measuredAt, last: measuredAt },
    },
    method_version: {
      as_of: measuredAt,
      status: "known",
      value: {
        cohort: {
          engine_set_key: setKey,
          language,
          question_set_key: questionSetKey,
          sampling_version: searchSamplingVersionOf(corrected),
          verdict_version:
            typeof contextVerdict === "number" ? contextVerdict : null,
        },
        interval_method: null,
      },
    },
    observed,
    retrieval: {
      as_of: null,
      status: "unavailable",
      reason: "not_recorded",
      detail_ko: "웹 검색 사용 여부는 이 회차에 기록되어 있지 않습니다.",
    },
    schema_version: 1,
    source_ids: {
      as_of: measuredAt,
      status: "known",
      value: {
        kind: "audit_jobs",
        audit_job_ids: [job.id],
        question_set_key: questionSetKey,
        sample_count: 1,
      },
    },
    unmeasured: unmeasuredRowsOf(corrected, rows),
  } as unknown as EvidenceEnvelope;

  return {
    ok: true,
    run: { corrected, evidence, language, measuredAt, rows, summary },
  };
}

type Loaded =
  | { kind: "not_available" }
  | { kind: "no_data" }
  | { brand: StoredBrandRow; job: StoredJobRow; kind: "run" };

/** 허용 목록 → 브랜드 → 최신 완료 회차. 목록 밖/없는 브랜드는 구별되지 않는 같은 결과. */
async function loadLatest(
  ctx: GeoToolContext,
  brandId: string
): Promise<Loaded> {
  if (!ctx.allowlist.has(brandId)) {
    return { kind: "not_available" };
  }
  const brand = await ctx.db.brand.findFirst({
    where: { id: brandId },
    select: { id: true, name: true, domain: true },
  });
  if (!brand) {
    return { kind: "not_available" };
  }
  const job = await ctx.db.auditJob.findFirst({
    where: { brandId, status: "completed" },
    orderBy: { completedAt: "desc" },
    select: { id: true, completedAt: true, createdAt: true, result: true },
  });
  return job ? { kind: "run", brand, job } : { kind: "no_data" };
}

// [도구 입력]

const brandIdField = z
  .string()
  .min(1)
  .max(64)
  .describe("허용 목록에 등록된 브랜드 ID(UUID).");

const anyOutput = z.looseObject({ status: z.string() });

const READONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

// [도구 본문 — 시험이 직접 부를 수 있게 분리]

export async function runSummary(
  ctx: GeoToolContext,
  brandId: string
): Promise<ToolOutcome> {
  const tool: McpReadonlyToolName = "get_brand_measurement_summary";
  const loaded = await loadLatest(ctx, brandId);
  if (loaded.kind === "not_available") {
    return { error: "not_available" as const };
  }
  if (loaded.kind === "no_data") {
    return {
      response: unverifiable(
        tool,
        "source_missing",
        "저장된 완료 측정 결과를 찾지 못했습니다."
      ),
    };
  }
  const built = buildBrandRun(loaded.brand, loaded.job);
  if (!built.ok) {
    return {
      response: unverifiable(tool, built.reason, built.detail, built.language),
    };
  }
  const { run } = built;
  const ai = run.summary.ai;
  const discovery = run.summary.discovery;
  const search = run.summary.search;
  const coverage = coverageOf(
    run.rows.filter(
      (r) => answerGroup(r.engineId) === "ai" && !isDiscoveryAnswer(r)
    )
  );
  const data: SummaryData = {
    brand_id: loaded.brand.id,
    brand_name: loaded.brand.name,
    collection_rate: rate(coverage.measured, coverage.attempted),
    exposure_denominator: ai.adjudicated,
    exposure_rate: rate(ai.confirmed, ai.adjudicated),
    groups: {
      ai_brand: {
        denominator: ai.adjudicated,
        exposure_count: ai.confirmed,
        exposure_rate: rate(ai.confirmed, ai.adjudicated),
      },
      discovery: discovery
        ? {
            denominator: discovery.adjudicated,
            exposure_count: discovery.recommended,
            exposure_rate: rate(discovery.recommended, discovery.adjudicated),
          }
        : null,
      search: search
        ? {
            denominator: search.adjudicated,
            exposure_count: search.confirmed,
            exposure_rate: rate(search.confirmed, search.adjudicated),
          }
        : null,
    },
    measured_at: run.measuredAt,
  };
  const message_ko =
    ai.adjudicated > 0
      ? `저장된 최신 측정 1회(${run.measuredAt.slice(0, 10)}) 기준, 판정이 끝난 AI 답변 ${ai.adjudicated}건 중 ${ai.confirmed}건에서 브랜드가 제대로 인식되었습니다. 표본이 작고 반복은 독립이 아니어서 숫자 하나로 판단할 수 없습니다.`
      : "판정이 끝난 AI 답변이 없어 노출률을 내지 않았습니다(0%가 아니라 계산하지 않은 상태입니다).";
  return {
    response: finalize(tool, summaryDataSchema, {
      message_ko,
      tool,
      status: "ok",
      language: run.language,
      data,
      evidence: run.evidence,
      limits_ko: LIMITS_KO,
      limits_en: LIMITS_EN,
    }),
  };
}

function breakdownGroup(
  g: ReturnType<typeof summarizeAnswerBuckets>["ai"]
): BreakdownData["groups"]["ai_brand"] {
  return {
    adjudicated: g.adjudicated,
    buckets: {
      confirmed: g.confirmed,
      different_entity: g.differentEntity,
      unknown: g.unknown,
      engine_error: g.engineError,
      unverified: g.unverified,
    },
    rates: {
      confirmed: rate(g.confirmed, g.adjudicated),
      different_entity: rate(g.differentEntity, g.adjudicated),
      unknown: rate(g.unknown, g.adjudicated),
    },
    total: g.total,
  };
}

export async function runBreakdown(
  ctx: GeoToolContext,
  brandId: string
): Promise<ToolOutcome> {
  const tool: McpReadonlyToolName = "get_answer_verdict_breakdown";
  const loaded = await loadLatest(ctx, brandId);
  if (loaded.kind === "not_available") {
    return { error: "not_available" as const };
  }
  if (loaded.kind === "no_data") {
    return {
      response: unverifiable(
        tool,
        "source_missing",
        "저장된 완료 측정 결과를 찾지 못했습니다."
      ),
    };
  }
  const built = buildBrandRun(loaded.brand, loaded.job);
  if (!built.ok) {
    return {
      response: unverifiable(tool, built.reason, built.detail, built.language),
    };
  }
  const { run } = built;
  const data: BreakdownData = {
    brand_id: loaded.brand.id,
    groups: {
      ai_brand: breakdownGroup(run.summary.ai),
      search: run.summary.search ? breakdownGroup(run.summary.search) : null,
    },
    measured_at: run.measuredAt,
  };
  const ai = run.summary.ai;
  return {
    response: finalize(tool, breakdownDataSchema, {
      message_ko: `저장된 최신 측정 1회(${run.measuredAt.slice(0, 10)}) 기준 AI 답변 ${ai.total}건의 분류입니다. 비율은 판정이 끝난 ${ai.adjudicated}건만 분모로 하며, 측정 실패와 판정 보류는 건수만 보여 줍니다.`,
      tool,
      status: "ok",
      language: run.language,
      data,
      evidence: run.evidence,
      limits_ko: LIMITS_KO,
      limits_en: LIMITS_EN,
    }),
  };
}

export async function runFacts(ctx: GeoToolContext, url: string) {
  const tool: McpReadonlyToolName = "check_official_facts";
  const out = await checkOfficialFacts(url, ctx.fetchImpl);
  const gone = (detail_ko: string) => ({
    as_of: null,
    status: "unavailable" as const,
    reason: "not_applicable" as const,
    detail_ko,
  });
  const evidence = {
    ...unverifiableEnvelope("not_applicable", "즉석 점검이라 해당 없습니다."),
    measured_at: {
      as_of: out.checked_at,
      status: "known" as const,
      value: { first: out.checked_at, last: out.checked_at },
    },
    method_version: gone("저장된 측정이 아니라 즉석 점검입니다."),
    observed: gone("AI 답변을 측정하지 않았습니다."),
    source_ids: {
      as_of: out.checked_at,
      status: "known" as const,
      value: { kind: "live_fetch" as const, checked_url: out.checked_url },
    },
  };
  const data: FactsData = {
    checked_at: out.checked_at,
    checked_url: out.checked_url,
    items: out.items.map((i) => ({
      key: i.key,
      status: i.status,
      detail: i.detail,
    })),
    limits_ko: out.limits_ko,
    summary_ko: out.summary_ko,
  };
  return finalize(tool, factsDataSchema, {
    message_ko: out.summary_ko,
    tool,
    status: "ok",
    language: evidence.language,
    data,
    evidence,
    limits_ko: LIMITS_KO,
    limits_en: LIMITS_EN,
  });
}

// [등록]

export function registerGeoReadonlyTools(
  server: McpServer,
  ctx: GeoToolContext
): void {
  server.registerTool(
    "get_brand_measurement_summary",
    {
      title: "브랜드 측정 요약 조회",
      description:
        "허용 목록에 있는 브랜드의 저장된 최신 측정 1회에서 AI 답변 노출률, 수집률, 못 잰 사유를 읽어 돌려줍니다. 새 측정을 시작하지 않고 AI 엔진에 질의하지 않습니다. 응답에 근거 봉투(측정 시각, 방식, 못 잰 항목)가 붙고, 값이 없는 칸은 0이 아니라 확인 불가로 표시됩니다. / Returns the exposure rate, collection rate and unmeasured reasons from the latest stored measurement of an allow-listed brand. Starts no measurement and queries no AI engine.",
      inputSchema: z.object({ brand_id: brandIdField }),
      outputSchema: anyOutput,
      annotations: {
        title: "브랜드 측정 요약 조회",
        ...READONLY_ANNOTATIONS,
        openWorldHint: false,
      },
    },
    async ({ brand_id }) => {
      try {
        const out = await runSummary(ctx, brand_id);
        return "error" in out ? fail(out.error) : ok(out.response);
      } catch (error) {
        ctx.log.error("mcp.geo.summary.failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return fail("internal");
      }
    }
  );

  server.registerTool(
    "get_answer_verdict_breakdown",
    {
      title: "답변 분류 건수 조회",
      description:
        "허용 목록에 있는 브랜드의 저장된 최신 측정 1회에서 AI 답변을 5분류(제대로 앎, 다른 회사로 앎, 모름, 측정 실패, 판정 보류)의 건수와 비율로 나누어 돌려줍니다. 비율의 분모는 판정이 끝난 답변이며 분모가 0이면 비율은 null입니다. 새 측정을 시작하지 않습니다. / Returns the five-way verdict counts and rates from the latest stored measurement of an allow-listed brand. Rates use adjudicated answers as the denominator; null when it is zero.",
      inputSchema: z.object({ brand_id: brandIdField }),
      outputSchema: anyOutput,
      annotations: {
        title: "답변 분류 건수 조회",
        ...READONLY_ANNOTATIONS,
        openWorldHint: false,
      },
    },
    async ({ brand_id }) => {
      try {
        const out = await runBreakdown(ctx, brand_id);
        return "error" in out ? fail(out.error) : ok(out.response);
      } catch (error) {
        ctx.log.error("mcp.geo.breakdown.failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return fail("internal");
      }
    }
  );

  server.registerTool(
    "check_official_facts",
    {
      title: "공식 사실·AI 크롤러 점검",
      description:
        "공개된 브랜드 사이트가 AI 검색엔진이 읽기 좋은 상태인지 점검합니다. llms.txt, robots.txt의 AI 크롤러 허용 여부, 구조화 데이터(JSON-LD), sitemap.xml 유무를 확인합니다. 입력한 주소의 공개 페이지를 서버가 직접 읽으며(응답 512KB, 요청당 5초, 리다이렉트 3회, 사설 주소 차단) AI 엔진에는 질의하지 않습니다. / Checks whether a public brand site is AI-search friendly (llms.txt, AI crawler rules in robots.txt, JSON-LD, sitemap).",
      inputSchema: z.object({
        url: z
          .string()
          .min(1)
          .max(2048)
          .describe(
            "점검할 브랜드의 공개 사이트 주소. 예: https://example.co.kr"
          ),
      }),
      outputSchema: anyOutput,
      annotations: {
        title: "공식 사실·AI 크롤러 점검",
        ...READONLY_ANNOTATIONS,
        openWorldHint: true,
      },
    },
    async ({ url }) => {
      try {
        return ok(await runFacts(ctx, url));
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("URL_")) {
          return failUrl(mapUrlError(error));
        }
        ctx.log.error("mcp.geo.facts.failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return fail("internal");
      }
    }
  );
}
