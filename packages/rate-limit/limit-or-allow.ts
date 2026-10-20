/**
 * 요청 횟수 제한(레이트 리밋) 판정을 "막힘"과 "판정 불가"로 나눈다.
 *
 * 2026-10-20 운영 사고: Upstash Redis 스토어가 비활성으로 보관(Archived)됐는데
 * 환경변수는 남아 있어 `limiter.limit()` 호출 자체가 예외를 던졌다.
 * 그 결과 문의 폼은 원시 오류를 띄우며 전송이 멈췄고, 뉴스레터 구독은 500 이 났다.
 *
 * - 제한 초과(정상 응답 `success: false`) → `limited` (지금처럼 차단)
 * - 호출 자체 실패(네트워크·인증·보관된 스토어 등 예외) → `unavailable`
 * - 라이브러리 내부 타임아웃(`success: true, reason: "timeout"`) → `unavailable`
 *   (예외가 아니라 성공처럼 돌아오므로 따로 잡아야 장애 로그가 남는다)
 *   `unavailable` 은 본 기능을 진행(fail-open)하고, 호출부가 관측 로그 1건을 남긴다.
 *
 * 외부 의존성이 없도록 일부러 별도 파일에 둔다(시험에서 Redis 생성 없이 불러오기 위함).
 */

export interface RateLimiterLike {
  limit: (
    identifier: string
  ) => Promise<{ success: boolean; reason?: string | undefined }>;
}

export type RateLimitDecision =
  | { allowed: true; reason: "ok" }
  | { allowed: false; reason: "limited" }
  | { allowed: true; reason: "unavailable"; error: unknown };

/** 라이브러리 내부 타임아웃을 호출부 로그에 넘기기 위한 표시용 오류. */
export class RateLimitTimeoutError extends Error {
  constructor() {
    super("rate limit timeout");
    this.name = "TimeoutError";
  }
}

const reportSafely = (
  onUnavailable: ((error: unknown) => void) | undefined,
  error: unknown
) => {
  try {
    onUnavailable?.(error);
  } catch {
    // 로그 실패가 본 기능을 막으면 안 된다.
  }
};

export const limitOrAllow = async (
  limiter: RateLimiterLike,
  identifier: string,
  onUnavailable?: (error: unknown) => void
): Promise<RateLimitDecision> => {
  let result: { success: boolean; reason?: string | undefined };
  try {
    result = await limiter.limit(identifier);
  } catch (error) {
    reportSafely(onUnavailable, error);
    return { allowed: true, reason: "unavailable", error };
  }
  if (result.reason === "timeout") {
    const error = new RateLimitTimeoutError();
    reportSafely(onUnavailable, error);
    return { allowed: true, reason: "unavailable", error };
  }
  return result.success
    ? { allowed: true, reason: "ok" }
    : { allowed: false, reason: "limited" };
};

export type RateLimitErrorKind = "auth" | "network" | "timeout" | "unknown";

export interface RateLimitErrorSummary {
  kind: RateLimitErrorKind;
  name: string;
  status: number | null;
}

const SAFE_NAME = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const AUTH_PATTERN =
  /unauthori[sz]ed|forbidden|wrongpass|invalid token|\b40[13]\b/i;
const NETWORK_PATTERN =
  /fetch failed|econnrefused|econnreset|enotfound|eai_again|network|socket/i;
const TIMEOUT_PATTERN = /timeout|timed out|aborterror|etimedout/i;

const readStatus = (error: unknown): number | null => {
  if (error && typeof error === "object") {
    const candidates = [
      (error as { status?: unknown }).status,
      (error as { cause?: { status?: unknown } }).cause?.status,
    ];
    for (const value of candidates) {
      if (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 100 &&
        value <= 599
      ) {
        return value;
      }
    }
  }
  return null;
};

const classify = (
  name: string,
  message: string,
  status: number | null
): RateLimitErrorKind => {
  const text = `${name} ${message}`;
  if (status === 401 || status === 403 || AUTH_PATTERN.test(text)) {
    return "auth";
  }
  if (TIMEOUT_PATTERN.test(text)) {
    return "timeout";
  }
  if (NETWORK_PATTERN.test(text)) {
    return "network";
  }
  return "unknown";
};

/**
 * 로그에 남길 오류 요약. 원문 메시지는 저장하지 않는다
 * (이메일·IP·토큰·Redis 명령 인자가 섞일 수 있어서).
 * 오류 종류 이름·HTTP 상태 코드·고정 분류만 남긴다.
 */
export const describeRateLimitError = (
  error: unknown
): RateLimitErrorSummary => {
  const rawName = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const name = SAFE_NAME.test(rawName) ? rawName : "Unknown";
  const status = readStatus(error);
  return { kind: classify(rawName, message, status), name, status };
};
