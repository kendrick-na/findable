import { isEngineTimeoutMessage } from "@repo/ai/lib/engines/engine-timeout";
import { answerReason } from "./answer-buckets";
import { isStabilityFlagOn } from "./stability-flags";

/**
 * 고객 화면용 오류 문장(2026-10-18, 안정성 N4) — 내부 오류 원문 대신 **분류된 사전 문장**만 보인다.
 *
 * 왜: 공급자 오류 문구·내부 주소·요청 ID 같은 원문이 고객 화면에 그대로 나갔다
 *   (측정 실패 사유·엔진 칸 오류). 원문은 **로그에 그대로 남기고**(디버깅), 고객 화면만 바꾼다.
 * 규칙
 *  - 플래그 `STABILITY_ERROR_SANITIZE_ENABLED` 꺼짐이면 **입력을 그대로 돌려준다**(기존과 바이트 동일).
 *  - 켜짐이면 결과는 **이미 있는 문장**(`answer-buckets.ts` 의 답변별 사유 라벨)뿐이다.
 *    새 문구를 만들지 않는다 — 맞는 기존 문구가 없는 분류(연결 안 됨·빈 응답)는 가장 가까운
 *    「AI 서비스 응답 오류」로 대체한다(보고서의 '필요한 새 문구 제안' 참고).
 *  - 원문 조각은 어떤 경우에도 결과에 섞이지 않는다(문장을 이어 붙이지 않고 사전 문장 하나만 고른다).
 */

export type PublicErrorKind =
  | "timeout"
  | "rate_limit"
  | "quota"
  | "connection"
  | "empty"
  | "general";

const QUOTA_RE = /quota|exceeded|credit|billing|한도/i;
const RATE_LIMIT_RE = /\b429\b|rate.?limit|too many requests|usage_limit/i;
const TIMEOUT_RE =
  /timeout|timed out|time out|deadline|시간 초과|시간 내|시작되지|ETIMEDOUT|ECONNABORTED/i;
const CONNECTION_RE =
  /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EPIPE|fetch failed|socket|network|getaddrinfo|connection|연결/i;
const EMPTY_RE = /검색 결과 없음|no results|empty|빈 응답/i;

/** 오류 원문을 분류한다. 순서는 `answer-buckets.ts` 의 사유 판정(한도 → 429 → 시간 초과)과 같다. */
export function classifyPublicError(
  raw: string | null | undefined
): PublicErrorKind {
  if (typeof raw !== "string" || raw.length === 0) {
    return "general";
  }
  if (isEngineTimeoutMessage(raw)) {
    return "timeout";
  }
  if (QUOTA_RE.test(raw)) {
    return "quota";
  }
  if (RATE_LIMIT_RE.test(raw)) {
    return "rate_limit";
  }
  if (TIMEOUT_RE.test(raw)) {
    return "timeout";
  }
  if (CONNECTION_RE.test(raw)) {
    return "connection";
  }
  if (EMPTY_RE.test(raw)) {
    return "empty";
  }
  return "general";
}

/**
 * 분류 → `answerReason` 이 같은 분류로 읽는 **내용 없는 표지 문자열**. 사전 문장을 한 곳(answer-buckets)에만
 * 두려고 그 함수를 재사용한다 — 이 표지 문자열은 화면에 나가지 않고 선택용으로만 쓰인다.
 */
const SELECTOR: Record<PublicErrorKind, string> = {
  connection: "error",
  empty: "error",
  general: "error",
  quota: "quota",
  rate_limit: "429",
  timeout: "timeout",
};

export interface PublicErrorOptions {
  env?: Record<string, string | undefined>;
  /** 분류가 「측정 실패 일반」일 때 쓸 기존 사전 문장(예: 작업 단위 안내문 `notCompletedBody`). 없으면 「AI 서비스 응답 오류」. */
  generalFallback?: string;
}

/**
 * 고객 화면에 보일 오류 문장.
 * 꺼짐 → 입력 그대로(null·undefined 포함). 켜짐 → 입력이 비어 있으면 그대로, 아니면 사전 문장.
 */
export function publicErrorMessage<T extends string | null | undefined>(
  raw: T,
  isKo: boolean,
  options: PublicErrorOptions = {}
): T | string {
  if (!isStabilityFlagOn("STABILITY_ERROR_SANITIZE_ENABLED", options.env)) {
    return raw;
  }
  if (typeof raw !== "string" || raw.length === 0) {
    return raw;
  }
  const kind = classifyPublicError(raw);
  if (kind === "general" && options.generalFallback) {
    return options.generalFallback;
  }
  return answerReason(
    { engineId: "public-error", errorMessage: SELECTOR[kind] },
    isKo
  );
}

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/**
 * 공개 측정 결과 안의 오류 원문(`engineResponses[].errorMessage`·`metrics.errors[].message`)을 사전 문장으로 바꾼다.
 * 꺼짐이면 입력 객체를 **그대로** 돌려준다(같은 참조). 켜짐이어도 입력은 건드리지 않고 복사본을 돌려준다.
 * 사전 문장은 화면의 기존 분류 정규식(한도·429·시간 초과)이 그대로 읽는 문구라 화면 로직이 바뀌지 않는다.
 */
export function sanitizeResultErrorsForCustomer<T>(
  result: T,
  isKo: boolean,
  env?: Record<string, string | undefined>
): T {
  if (
    !(
      isStabilityFlagOn("STABILITY_ERROR_SANITIZE_ENABLED", env) &&
      isRow(result)
    )
  ) {
    return result;
  }
  const next: Row = { ...result };
  if (Array.isArray(result.engineResponses)) {
    next.engineResponses = result.engineResponses.map((row) =>
      isRow(row) && hasText(row.errorMessage)
        ? {
            ...row,
            errorMessage: publicErrorMessage(row.errorMessage, isKo, { env }),
          }
        : row
    );
  }
  if (isRow(result.metrics) && Array.isArray(result.metrics.errors)) {
    next.metrics = {
      ...result.metrics,
      errors: result.metrics.errors.map((entry) =>
        isRow(entry) && hasText(entry.message)
          ? {
              ...entry,
              message: publicErrorMessage(entry.message, isKo, { env }),
            }
          : entry
      ),
    };
  }
  return next as T;
}
