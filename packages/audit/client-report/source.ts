// 영업 리포트의 **사실 원본**(ReportSource@1) — 측정 1회차(AuditJob)를 불변 JSON 으로 고정한다.
//
// 🔴 왜 필요한가 (2026-09-30 감사 `04_리포트연동_아키텍처감사_20260930.md`):
//   v4/v12 PDF 는 공개 API 응답을 손으로 저장한 로컬 파일을 읽었고, 사람 판별(labels)은
//   **배열 순서**로만 답변과 맞췄다. 원본이 바뀌거나 순서가 한 칸 밀리면 조용히 다른 답변의
//   판별이 붙는다. → 원본 전체의 해시(resultSha256)와 답변별 고유 키(answerKey)로 고정한다.
//
// 규칙
// - 순수 함수다(DB·네트워크 없음). 라우트가 AuditJob 행을 읽어 넘긴다.
// - 옛 측정(원문 rawResponse·질문 원문 promptText 가 없는 회차)은 **거부**한다 —
//   판별을 원문으로 다시 확인할 수 없으면 발행 근거가 될 수 없다(TechDD 2026-09-14 회차).
// - 원문 전체를 담으므로 **관리자 전용**이다. 고객에게 이 JSON 을 보내지 않는다.

import { createHash } from "node:crypto";
import { ENGINE_NAMES, type EngineId } from "./compute";

export const REPORT_SOURCE_CONTRACT = "findable.report-source@1";

/** 영업 비교 분모 기본값 — v12: AI 4곳 × 브랜드명 질문. 일반 검색(naver·daum)·일부 문항 엔진 제외. */
export const DEFAULT_COMPARE_ENGINES: readonly EngineId[] = [
  "chatgpt",
  "claude",
  "perplexity",
  "gemini",
];

export interface ReportSourceAnswer {
  /** sha1(`engineId|promptText|repeat`) — 같은 엔진·같은 질문의 n번째 답변. */
  answerKey: string;
  citedSources: { domain: string; title?: string; url: string }[];
  engineId: EngineId;
  error: string | null;
  /** 원래 engineResponses 배열 위치(추적용). 매칭에는 쓰지 않는다. */
  index: number;
  promptKind: string;
  promptLang: string | null;
  promptText: string;
  rawResponse: string;
  repeat: number;
}

export interface ReportSource {
  answers: ReportSourceAnswer[];
  contract: typeof REPORT_SOURCE_CONTRACT;
  identity: { identityGrounded: boolean | null; officialSite: unknown };
  /**
   * 누가·언제 만든 원본인가. 앱 관리자 내보내기는 `app-export`. 렌더러는 이 값이 없거나
   * `snapshot-fixture` 면 승인본을 만들지 않는다(리포트 세션 계약).
   */
  provenance: {
    exportedAt: string | null;
    exportedBy: string | null;
    kind: "app-export";
  };
  /**
   * 측정 준비도 기록(2026-10-12) — 결과의 measurementContext 에서 그대로 옮긴다. 없으면(기록 이전 회차)
   * `setup` 자체가 없다 — 판단할 수 없으므로 발행 게이트는 거부하지 않는다.
   */
  /**
   * 「N개 중 M개 측정」 기록(영업 20문항 회차, 2026-10-14) — 결과의 measurementContext.questionPlan 을 그대로 옮긴다.
   * 리포트가 "20개 중 18개"처럼 개수를 표기하는 근거다. 잘렸으면(`truncated`) 발행 게이트가 거부한다.
   * 기록이 없는 회차(대시보드·옛 회차)는 이 필드가 없다.
   */
  questionPlan?: {
    approved: number | null;
    asked: number;
    limit: number;
    planned: number;
    truncated: boolean;
    truncatedReason: string | null;
  };
  run: {
    auditJobId: string;
    brandName: string | null;
    completedAt: string;
    createdAt: string;
    domain: string;
    /** answers 배열(이 원본 그대로)을 키 정렬한 JSON 의 SHA-256 — result 없이 재계산 가능. */
    answersSha256: string;
    /** AuditJob.result 를 키 정렬한 JSON 의 SHA-256. 원본이 한 글자라도 바뀌면 달라진다. */
    resultSha256: string;
    verdictVersion: number;
  };
  setup?: {
    brandNameCheck: string | null;
    readiness: {
      level: string;
      missingRecommended: string[];
      missingRequired: string[];
      skippedSetup: boolean;
    } | null;
  };
  /** 기본 분모 제안 — 확정은 사람이 ReportReview 에서 한다. */
  suggestedDenominator: { engines: EngineId[]; promptKinds: string[] };
}

export type SourceError =
  | "not_completed"
  | "no_result"
  | "no_completed_at"
  | "no_verdict_version"
  | "no_answers"
  | "legacy_missing_raw"
  | "legacy_missing_prompt";

export interface AuditJobRow {
  completedAt: Date | string | null;
  createdAt: Date | string;
  domain: string;
  id: string;
  result: unknown;
  status: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** 키를 정렬한 JSON — 같은 값이면 저장 순서와 무관하게 같은 문자열. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function resultSha256(result: unknown): string {
  return createHash("sha256").update(canonicalJson(result)).digest("hex");
}

export function answerKeyOf(
  engineId: string,
  promptText: string,
  repeat: number
): string {
  return createHash("sha1")
    .update(`${engineId}|${promptText.trim()}|${repeat}`)
    .digest("hex");
}

const iso = (d: Date | string) => new Date(d).toISOString();

const isEngineId = (v: unknown): v is EngineId =>
  typeof v === "string" && Object.hasOwn(ENGINE_NAMES, v);

function sourcesOf(value: unknown): ReportSourceAnswer["citedSources"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((s) => {
    if (!isRecord(s)) {
      return [];
    }
    const url = typeof s.url === "string" ? s.url : "";
    const domain = typeof s.domain === "string" ? s.domain : "";
    if (!(url || domain)) {
      return [];
    }
    return [
      {
        url,
        domain,
        ...(typeof s.title === "string" ? { title: s.title } : {}),
      },
    ];
  });
}

/** 실패 행 표시 — 원문이 비어 있어도 되는 유일한 경우(판별은 보통 none). */
function answerError(raw: Record<string, unknown>): string | null {
  if (typeof raw.errorMessage === "string" && raw.errorMessage) {
    return raw.errorMessage;
  }
  return raw.isStub === true ? "stub" : null;
}

/**
 * AuditJob 한 행 → ReportSource. 불완전하면 `errors` 를 돌려주고 원본을 만들지 않는다.
 * `errors` 는 모두 모아 준다(한 번에 무엇을 고쳐야/재측정해야 하는지 보이게).
 */
export function buildReportSource(
  job: AuditJobRow
): { ok: true; source: ReportSource } | { ok: false; errors: SourceError[] } {
  const errors = new Set<SourceError>();
  if (job.status !== "completed") {
    errors.add("not_completed");
  }
  if (!job.completedAt) {
    errors.add("no_completed_at");
  }
  const result = job.result;
  if (!(isRecord(result) && Array.isArray(result.engineResponses))) {
    errors.add("no_result");
    return { ok: false, errors: [...errors] };
  }
  const verdictVersion = result.mentionVerdictVersion;
  if (typeof verdictVersion !== "number") {
    errors.add("no_verdict_version");
  }

  const seen = new Map<string, number>();
  const answers: ReportSourceAnswer[] = [];
  result.engineResponses.forEach((raw, index) => {
    if (!(isRecord(raw) && isEngineId(raw.engineId))) {
      return; // naver-briefing 등 리포트 비교 대상이 아닌 행
    }
    const promptText =
      typeof raw.promptText === "string" ? raw.promptText.trim() : "";
    const rawResponse =
      typeof raw.rawResponse === "string" ? raw.rawResponse : "";
    const error = answerError(raw);
    if (!promptText) {
      errors.add("legacy_missing_prompt");
    }
    if (!(rawResponse || error)) {
      errors.add("legacy_missing_raw");
    }
    const slot = `${raw.engineId}|${promptText}`;
    const repeat = (seen.get(slot) ?? 0) + 1;
    seen.set(slot, repeat);
    answers.push({
      answerKey: answerKeyOf(raw.engineId, promptText, repeat),
      engineId: raw.engineId,
      promptText,
      promptLang: typeof raw.promptLang === "string" ? raw.promptLang : null,
      promptKind: typeof raw.promptKind === "string" ? raw.promptKind : "brand",
      repeat,
      index,
      rawResponse,
      citedSources: sourcesOf(raw.citedSources),
      error,
    });
  });
  if (answers.length === 0) {
    errors.add("no_answers");
  }
  if (errors.size > 0 || typeof verdictVersion !== "number") {
    return { ok: false, errors: [...errors] };
  }

  const answersSha256 = createHash("sha256")
    .update(canonicalJson(answers))
    .digest("hex");
  const context = isRecord(result.measurementContext)
    ? result.measurementContext
    : {};
  const present = new Set(answers.map((a) => a.engineId));
  return {
    ok: true,
    source: {
      contract: REPORT_SOURCE_CONTRACT,
      provenance: { kind: "app-export", exportedAt: null, exportedBy: null },
      run: {
        auditJobId: job.id,
        createdAt: iso(job.createdAt),
        completedAt: iso(job.completedAt as Date | string),
        domain: job.domain,
        brandName:
          typeof result.brandName === "string" ? result.brandName : null,
        verdictVersion,
        resultSha256: resultSha256(result),
        answersSha256,
      },
      identity: {
        officialSite: context.officialSiteIdentity ?? null,
        identityGrounded:
          typeof context.identityGrounded === "boolean"
            ? context.identityGrounded
            : null,
      },
      ...setupOf(context),
      ...questionPlanOf(context),
      answers,
      suggestedDenominator: {
        engines: DEFAULT_COMPARE_ENGINES.filter((e) => present.has(e)),
        promptKinds: ["brand"],
      },
    },
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/** 결과에 준비도 기록이나 이름 확인 결과가 하나라도 있을 때만 `setup` 을 만든다. */
function setupOf(
  context: Record<string, unknown>
): Pick<ReportSource, "setup"> {
  const readiness = isRecord(context.setupReadiness)
    ? context.setupReadiness
    : null;
  const nameCheck = isRecord(context.brandNameCheck)
    ? context.brandNameCheck
    : null;
  if (!(readiness || nameCheck)) {
    return {};
  }
  return {
    setup: {
      brandNameCheck:
        typeof nameCheck?.status === "string" ? nameCheck.status : null,
      readiness:
        readiness && typeof readiness.level === "string"
          ? {
              level: readiness.level,
              missingRecommended: stringArray(readiness.missingRecommended),
              missingRequired: stringArray(readiness.missingRequired),
              skippedSetup: readiness.skippedSetup === true,
            }
          : null,
    },
  };
}

const integerOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;

/** 결과에 `questionPlan` 이 있고 모양이 맞을 때만 옮긴다(모르는 모양이면 만들지 않는다). */
function questionPlanOf(
  context: Record<string, unknown>
): Pick<ReportSource, "questionPlan"> {
  const plan = isRecord(context.questionPlan) ? context.questionPlan : null;
  const asked = integerOrNull(plan?.asked);
  const planned = integerOrNull(plan?.planned);
  const limit = integerOrNull(plan?.limit);
  if (
    !plan ||
    asked === null ||
    planned === null ||
    limit === null ||
    typeof plan.truncated !== "boolean"
  ) {
    return {};
  }
  return {
    questionPlan: {
      approved: integerOrNull(plan.approved),
      asked,
      limit,
      planned,
      truncated: plan.truncated,
      truncatedReason:
        typeof plan.truncatedReason === "string" ? plan.truncatedReason : null,
    },
  };
}
