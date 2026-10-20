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
//   - 신뢰구간은 S1 의 aggregateRepeats(Wilson)를 연결한다. 같은 조건 반복이 최소 횟수 미만이거나 코호트가
//     맞지 않으면 계속 unavailable(insufficient_sample 등)이고 0 으로 내보내지 않는다.
//   - brand_name 의 출처는 허용 목록에 있는 브랜드의 `Brand.name`(표시 이름) 하나뿐이다. 법인명·사업자번호·이메일은
//     select 에도 없고 loadLatest 가 id·name·domain 만 남기고 나머지 칸을 버린다.
//   - check_official_facts 는 허용 목록 브랜드의 등록된 도메인(Brand.domain)만 점검한다(대표 결정 P-1).
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
  EngineModelInfo,
  EvidenceEnvelope,
  Interval,
  Known,
  McpReadonlyToolName,
  ObservedValues,
  RetrievalInfo,
  UnavailableReason,
  UnmeasuredRow,
} from "@repo/audit/proof-types";
import {
  aggregateRepeats,
  type CohortAggregate,
} from "@repo/audit/repeat-aggregate";
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
  /** 같은 조건 반복의 최소 횟수(사전 등록 값). 생략하면 임시값 3. */
  minRepeats?: number;
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
  engineSet?: string | null;
  usage?: {
    chatgptEngineSet?: string;
    engineSet?: string;
    fallback?: string;
    modelId?: string;
    searchUnavailable?: boolean;
    webSearchRequests?: number | null;
  } | null;
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

// [저장된 필드에서만 얻는 사전 등록 칸: 검색 호출 여부·엔진/모델 정보]
// 저장 결과에 있는 값만 쓴다. 없으면 unavailable 이고 값을 만들지 않는다(색인 확인은 저장 경로가 없다).

type RetrievalState = "not_used" | "unknown" | "used";

function retrievalOfRow(row: StoredRow): RetrievalState {
  const n = row.usage?.webSearchRequests;
  if (typeof n === "number" && Number.isFinite(n)) {
    return n > 0 ? "used" : "not_used";
  }
  // 검색을 원했지만 검색 없이 답한 행: 검색을 호출하지 않았다.
  if (row.usage?.searchUnavailable === true) {
    return "not_used";
  }
  return "unknown"; // null·미기재 = 미수집(0 이 아니다)
}

const MAX_SOURCE_URLS = 50;

/** 쿼리·해시·로그인 정보는 버린다(개인정보가 섞일 수 있음). http(s)가 아니거나 읽을 수 없으면 null. */
function safeSourceUrl(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:"
      ? `${u.origin}${u.pathname}`
      : null;
  } catch {
    return null;
  }
}

function sourceUrlsOf(rows: readonly StoredRow[]): string[] {
  const out = new Set<string>();
  for (const row of rows) {
    for (const item of row.citedSources ?? []) {
      const url = safeSourceUrl(item?.url);
      if (url) {
        out.add(url);
      }
    }
  }
  return [...out].slice(0, MAX_SOURCE_URLS);
}

function engineStatesOf(
  rows: readonly StoredRow[]
): Map<string, Set<RetrievalState>> {
  const perEngine = new Map<string, Set<RetrievalState>>();
  for (const row of rows) {
    const group = answerGroup(row.engineId);
    if (group === "ai" || group === "search") {
      const set = perEngine.get(row.engineId) ?? new Set<RetrievalState>();
      set.add(retrievalOfRow(row));
      perEngine.set(row.engineId, set);
    }
  }
  return perEngine;
}

type EngineRetrieval = RetrievalInfo["by_engine"][string];

function engineRetrievalOf(
  states: ReadonlySet<RetrievalState>
): EngineRetrieval {
  const known = [...states].filter((v) => v !== "unknown");
  if (states.size === 1 && known[0] === "used") {
    return { engine_class: "web_search", retrieval: "used" };
  }
  if (states.size === 1 && known[0] === "not_used") {
    return { engine_class: "model_knowledge", retrieval: "not_used" };
  }
  return {
    engine_class: known.length > 1 ? "mixed" : "unknown",
    retrieval: "unknown",
  };
}

function overallRetrievalOf(
  overall: ReadonlySet<RetrievalState>
): RetrievalInfo["retrieval_used"] {
  const known = [...overall].filter((v) => v !== "unknown");
  if (overall.has("unknown") || known.length > 1) {
    return "mixed";
  }
  return known[0] ?? "unknown";
}

function retrievalInfoOf(
  rows: readonly StoredRow[],
  asOf: string
): Known<RetrievalInfo> {
  const perEngine = engineStatesOf(rows);
  const overall = new Set<RetrievalState>();
  const by_engine: RetrievalInfo["by_engine"] = {};
  for (const [engineId, states] of perEngine) {
    by_engine[engineId] = engineRetrievalOf(states);
    for (const v of states) {
      overall.add(v);
    }
  }
  if (overall.size === 0 || (overall.size === 1 && overall.has("unknown"))) {
    return {
      as_of: null,
      status: "unavailable",
      reason: "not_recorded",
      detail_ko: "웹 검색 사용 여부는 이 회차에 기록되어 있지 않습니다.",
    };
  }
  return {
    as_of: asOf,
    status: "known",
    value: {
      by_engine,
      retrieval_used: overallRetrievalOf(overall),
      source_urls: sourceUrlsOf(rows),
    },
  };
}

function callSourceOf(
  gateway: boolean,
  web: boolean
): EngineModelInfo["call_source"] {
  if (gateway) {
    return "api_fallback";
  }
  return web ? "web" : null;
}

function engineModelOf(
  rows: readonly StoredRow[],
  engineIds: readonly string[],
  setKey: string | null,
  asOf: string
): EngineModelInfo[] {
  return engineIds.map((engine_id) => {
    const mine = rows.filter((r) => r.engineId === engine_id);
    const models = new Set(
      mine.map((r) => r.usage?.modelId).filter((m): m is string => !!m)
    );
    const gateway = mine.some((r) => r.usage?.fallback === "gateway");
    const web = mine.some((r) => !!r.usage?.chatgptEngineSet);
    const model_id: EngineModelInfo["model_id"] =
      models.size === 1
        ? { as_of: asOf, status: "known", value: [...models][0] ?? "" }
        : {
            as_of: asOf,
            status: "unavailable",
            reason: "not_recorded",
            detail_ko:
              models.size > 1
                ? "회차 안에서 모델이 여러 개라 하나로 적지 않았습니다."
                : "엔진 모델 버전은 기록되어 있지 않습니다.",
          };
    return {
      call_source: callSourceOf(gateway, web),
      engine_id,
      engine_set:
        mine.map((r) => r.usage?.engineSet ?? r.engineSet).find((v) => !!v) ??
        setKey,
      model_id,
    };
  });
}

// [같은 조건 반복 → 신뢰구간]

/** 사전 등록 문서에 최소 반복 수가 적혀 있지 않다 — 임시값. [확인 필요] 확정되면 GeoToolContext.minRepeats 로 넘긴다. */
const DEFAULT_MIN_REPEATS = 3;
const HISTORY_LIMIT = 30;

type CohortView =
  | {
      cohort: CohortAggregate;
      interval: Known<Interval>;
      observed: Known<ObservedValues>;
    }
  | { cohort: null; interval: Known<Interval> };

function cohortViewOf(
  brand: StoredBrandRow,
  job: StoredJobRow,
  history: readonly StoredJobRow[],
  minRepeats: number,
  asOf: string
): CohortView {
  const jobs = history.some((h) => h.id === job.id)
    ? history
    : [job, ...history];
  const agg = aggregateRepeats(
    jobs.map((h) => ({
      completed_at: h.completedAt ?? h.createdAt,
      job_id: h.id,
      result: withRecomputedAuditMetrics(h.result),
    })),
    {
      brand_domain: brand.domain,
      min_repeats: minRepeats,
      suppression_threshold: null,
    }
  );
  const cohort = agg.cohorts.find((c) => c.job_ids.includes(job.id)) ?? null;
  const gone = (
    reason: "insufficient_sample" | "not_recorded" | "withheld_not_publishable",
    detail_ko: string
  ): CohortView => ({
    cohort: null,
    interval: { as_of: asOf, status: "unavailable", reason, detail_ko },
  });
  if (!cohort) {
    return gone(
      "not_recorded",
      "이 회차를 같은 조건 묶음에 넣지 못해 구간을 내지 않습니다."
    );
  }
  if (!cohort.comparable) {
    return gone(
      "insufficient_sample",
      `같은 조건의 반복이 ${cohort.repeat_count}회뿐이라(최소 ${minRepeats}회 필요) 신뢰구간을 내지 않습니다.`
    );
  }
  const observed = cohort.observed.ai_brand;
  if (observed.status !== "known") {
    return gone(
      "withheld_not_publishable",
      "같은 조건 묶음의 숫자를 낼 수 없어 구간을 내지 않습니다."
    );
  }
  return { cohort, interval: observed.value.interval, observed };
}

export interface BrandRun {
  /** 같은 조건 반복이 충분할 때만 채워진다(아니면 null = 최신 1회 값만 쓴다). */
  cohort: CohortAggregate | null;
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
  job: StoredJobRow,
  history: readonly StoredJobRow[] = [],
  minRepeats: number = DEFAULT_MIN_REPEATS
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

  const view = cohortViewOf(brand, job, history, minRepeats, measuredAt);
  const cohortJobs = view.cohort
    ? history.filter((h) => view.cohort?.used_job_ids.includes(h.id))
    : [];
  const evidenceRows =
    cohortJobs.length > 0
      ? cohortJobs.flatMap((h) => rowsOf(withRecomputedAuditMetrics(h.result)))
      : rows;
  const singleObserved: Known<ObservedValues> = {
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
      interval: view.interval,
    },
  } as Known<ObservedValues>;
  const observed: Known<ObservedValues> = view.cohort
    ? view.observed
    : singleObserved;

  const evidence = {
    comparison: null,
    engine_model: {
      as_of: measuredAt,
      status: "known",
      value: engineModelOf(evidenceRows, engineIds, setKey, measuredAt),
    },
    // 색인 확인은 저장 결과에 기록 경로가 없다 — 값을 만들지 않는다(Search Console 확인은 별도 기록).
    index_check: {
      as_of: null,
      status: "unavailable",
      reason: "not_recorded",
      detail_ko:
        "색인 확인은 저장 결과에 기록되지 않습니다(Search Console 확인은 별도 기록).",
    },
    language,
    limits: LIMITS_BLOCK,
    measured_at: {
      as_of: measuredAt,
      status: "known",
      value: view.cohort
        ? {
            first: view.cohort.first_completed_at,
            last: view.cohort.last_completed_at,
          }
        : { first: measuredAt, last: measuredAt },
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
        interval_method:
          observed.status === "known" &&
          observed.value.interval.status === "known"
            ? observed.value.interval.value.method
            : null,
      },
    },
    observed,
    retrieval: retrievalInfoOf(evidenceRows, measuredAt),
    schema_version: 1,
    source_ids: {
      as_of: measuredAt,
      status: "known",
      value: {
        kind: "audit_jobs",
        audit_job_ids: view.cohort ? view.cohort.used_job_ids : [job.id],
        question_set_key: questionSetKey,
        sample_count: view.cohort ? view.cohort.repeat_count : 1,
      },
    },
    unmeasured: unmeasuredRowsOf(corrected, rows),
  } as unknown as EvidenceEnvelope;

  return {
    ok: true,
    run: {
      cohort: view.cohort,
      corrected,
      evidence,
      language,
      measuredAt,
      rows,
      summary,
    },
  };
}

type Loaded =
  | { kind: "not_available" }
  | { kind: "no_data" }
  | {
      brand: StoredBrandRow;
      history: StoredJobRow[];
      job: StoredJobRow;
      kind: "run";
    };

/** 허용 목록 → 브랜드 → 최신 완료 회차. 목록 밖/없는 브랜드는 구별되지 않는 같은 결과. */
async function loadLatest(
  ctx: GeoToolContext,
  brandId: string
): Promise<Loaded> {
  if (!ctx.allowlist.has(brandId)) {
    return { kind: "not_available" };
  }
  const found = await ctx.db.brand.findFirst({
    where: { id: brandId },
    select: { id: true, name: true, domain: true },
  });
  if (!found) {
    return { kind: "not_available" };
  }
  // 값 출처 한정: 표시 이름은 Brand.name 하나. 그 밖의 칸(법인명·사업자번호·이메일 등)이 행에 섞여 와도 버린다.
  const brand: StoredBrandRow = {
    domain: found.domain,
    id: found.id,
    name: found.name,
  };
  const history = await ctx.db.auditJob.findMany({
    where: { brandId, status: "completed" },
    orderBy: { completedAt: "desc" },
    take: HISTORY_LIMIT,
    select: { id: true, completedAt: true, createdAt: true, result: true },
  });
  const job = history[0];
  return job ? { kind: "run", brand, history, job } : { kind: "no_data" };
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

type GroupRate = {
  denominator: number;
  exposure_count: number;
  exposure_rate: number | null;
} | null;

function cohortGroupRate(
  run: BrandRun,
  group: "ai_brand" | "discovery" | "search"
): GroupRate {
  const k = run.cohort?.observed[group];
  return k?.status === "known"
    ? {
        denominator: k.value.denominator,
        exposure_count: k.value.exposure_count,
        exposure_rate: k.value.exposure_rate,
      }
    : null;
}

function singleGroupRates(
  run: BrandRun
): Record<"ai_brand" | "discovery" | "search", GroupRate> {
  const { ai, discovery, search } = run.summary;
  return {
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
  };
}

/** 같은 조건 반복이 충분하면(run.cohort) 근거 봉투와 같은 묶음 값을, 아니면 최신 1회 값을 쓴다. */
function summaryDataOf(brand: StoredBrandRow, run: BrandRun): SummaryData {
  const single = singleGroupRates(run);
  const cohortAi = cohortGroupRate(run, "ai_brand");
  const groups = run.cohort
    ? {
        ai_brand: cohortAi ?? single.ai_brand,
        discovery: cohortGroupRate(run, "discovery"),
        search: cohortGroupRate(run, "search"),
      }
    : single;
  const cohortObs = run.cohort?.observed.ai_brand;
  const coverage = coverageOf(
    run.rows.filter(
      (r) => answerGroup(r.engineId) === "ai" && !isDiscoveryAnswer(r)
    )
  );
  const aiGroup = groups.ai_brand ?? single.ai_brand;
  return {
    brand_id: brand.id,
    brand_name: brand.name,
    collection_rate:
      cohortObs?.status === "known"
        ? cohortObs.value.collection.rate
        : rate(coverage.measured, coverage.attempted),
    exposure_denominator: aiGroup?.denominator ?? 0,
    exposure_rate: aiGroup?.exposure_rate ?? null,
    groups,
    measured_at: run.cohort ? run.cohort.last_completed_at : run.measuredAt,
  } as SummaryData;
}

const NO_ADJUDICATED_KO =
  "판정이 끝난 AI 답변이 없어 노출률을 내지 않았습니다(0%가 아니라 계산하지 않은 상태입니다).";

function summaryMessageOf(run: BrandRun): string {
  const single = singleGroupRates(run).ai_brand;
  const cohortAi = cohortGroupRate(run, "ai_brand");
  const g = cohortAi ?? single;
  if (!g || g.denominator === 0) {
    return NO_ADJUDICATED_KO;
  }
  if (cohortAi) {
    return `같은 조건으로 저장된 ${run.cohort?.repeat_count}회 측정을 묶어, 판정이 끝난 AI 답변 ${g.denominator}건 중 ${g.exposure_count}건에서 브랜드가 제대로 인식되었습니다. 반복은 독립 표본이 아니어서 신뢰구간은 참고용이며 숫자 하나로 판단할 수 없습니다.`;
  }
  return `저장된 최신 측정 1회(${run.measuredAt.slice(0, 10)}) 기준, 판정이 끝난 AI 답변 ${g.denominator}건 중 ${g.exposure_count}건에서 브랜드가 제대로 인식되었습니다. 표본이 작고 반복은 독립이 아니어서 숫자 하나로 판단할 수 없습니다.`;
}

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
  const built = buildBrandRun(
    loaded.brand,
    loaded.job,
    loaded.history,
    ctx.minRepeats ?? DEFAULT_MIN_REPEATS
  );
  if (!built.ok) {
    return {
      response: unverifiable(tool, built.reason, built.detail, built.language),
    };
  }
  const { run } = built;
  const data = summaryDataOf(loaded.brand, run);
  const message_ko = summaryMessageOf(run);
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

const LEADING_WWW = /^www\./;
const TRAILING_DOT = /\.$/;

function hostOnly(value: string): string | null {
  const text = value.trim();
  if (text === "") {
    return null;
  }
  try {
    const host = new URL(
      text.includes("://") ? text : `https://${text}`
    ).hostname.toLowerCase();
    return host.replace(LEADING_WWW, "").replace(TRAILING_DOT, "") || null;
  } catch {
    return null;
  }
}

/** 허용 목록 브랜드의 등록된 도메인 집합(Brand.domain). 허용 목록이 비면 빈 집합. */
async function registeredDomains(ctx: GeoToolContext): Promise<Set<string>> {
  const domains = new Set<string>();
  for (const id of ctx.allowlist) {
    const brand = await ctx.db.brand.findFirst({
      where: { id },
      select: { id: true, domain: true },
    });
    const host = brand ? hostOnly(brand.domain) : null;
    if (host) {
      domains.add(host);
    }
  }
  return domains;
}

/**
 * 읽기 전용 모드의 공식 정보 점검(대표 결정 P-1): 익명 공개 안 함·자사 허용 목록 한정.
 * 입력 주소의 호스트가 허용 목록 브랜드의 등록된 도메인과 같을 때만 점검하고, 아니면(빈 허용 목록 포함)
 * 허용 목록 밖·없는 브랜드와 같은 not_available 로 거부한다. 사설 주소 차단 등 기존 방어는 점검 안에서 그대로 유지된다.
 */
export async function runFacts(
  ctx: GeoToolContext,
  url: string
): Promise<ToolOutcome> {
  const tool: McpReadonlyToolName = "check_official_facts";
  const requested = hostOnly(url);
  if (requested === null || !(await registeredDomains(ctx)).has(requested)) {
    return { error: "not_available" as const };
  }
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
  const response = finalize(tool, factsDataSchema, {
    message_ko: out.summary_ko,
    tool,
    status: "ok",
    language: evidence.language,
    data,
    evidence,
    limits_ko: LIMITS_KO,
    limits_en: LIMITS_EN,
  });
  return { response };
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
        "허용 목록에 등록된 브랜드의 도메인에 한해, 공개 사이트가 AI 검색엔진이 읽기 좋은 상태인지 점검합니다. 등록되지 않은 주소는 거부합니다. llms.txt, robots.txt의 AI 크롤러 허용 여부, 구조화 데이터(JSON-LD), sitemap.xml 유무를 확인합니다. 입력한 주소의 공개 페이지를 서버가 직접 읽으며(응답 512KB, 요청당 5초, 리다이렉트 3회, 사설 주소 차단) AI 엔진에는 질의하지 않습니다. / Checks whether the registered domain of an allow-listed brand is AI-search friendly (llms.txt, AI crawler rules in robots.txt, JSON-LD, sitemap).",
      inputSchema: z.object({
        url: z
          .string()
          .min(1)
          .max(2048)
          .describe(
            "허용 목록 브랜드의 등록된 사이트 주소. 예: https://example.co.kr"
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
        const out = await runFacts(ctx, url);
        return "error" in out ? fail(out.error) : ok(out.response);
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
