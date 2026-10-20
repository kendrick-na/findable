/**
 * 요청 횟수 제한(레이트 리밋) 판정을 "막힘"과 "판정 불가"로 나눈다.
 *
 * 2026-10-20 운영 사고: Upstash Redis 스토어가 비활성으로 보관(Archived)됐는데
 * 환경변수는 남아 있어 `limiter.limit()` 호출 자체가 예외를 던졌다.
 * 그 결과 문의 폼은 원시 오류를 띄우며 전송이 멈췄고, 뉴스레터 구독은 500 이 났다.
 *
 * - 제한 초과(정상 응답 `success: false`) → `limited` (지금처럼 차단)
 * - 호출 자체 실패(네트워크·인증·보관된 스토어 등 예외) → `unavailable`
 *   (본 기능은 진행 = fail-open, 호출부가 관측 로그 1건을 남긴다)
 *
 * 외부 의존성이 없도록 일부러 별도 파일에 둔다(시험에서 Redis 생성 없이 불러오기 위함).
 */

export interface RateLimiterLike {
  limit: (identifier: string) => Promise<{ success: boolean }>;
}

export type RateLimitDecision =
  | { allowed: true; reason: "ok" }
  | { allowed: false; reason: "limited" }
  | { allowed: true; reason: "unavailable"; error: unknown };

export const limitOrAllow = async (
  limiter: RateLimiterLike,
  identifier: string,
  onUnavailable?: (error: unknown) => void
): Promise<RateLimitDecision> => {
  let success: boolean;
  try {
    ({ success } = await limiter.limit(identifier));
  } catch (error) {
    try {
      onUnavailable?.(error);
    } catch {
      // 로그 실패가 본 기능을 막으면 안 된다.
    }
    return { allowed: true, reason: "unavailable", error };
  }
  return success
    ? { allowed: true, reason: "ok" }
    : { allowed: false, reason: "limited" };
};

/** 로그에 남길 짧은 오류 설명. 키·토큰이 섞이지 않도록 이름과 앞부분 메시지만 쓴다. */
export const describeRateLimitError = (error: unknown): string => {
  const raw =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .slice(0, 200);
};
