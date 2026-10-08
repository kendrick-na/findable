/**
 * 엔진 개별 상한(60초 등)으로 끊긴 호출의 문구와 판별 — **한 곳**(2026-10-07).
 *
 * 응답 행에는 오류 객체가 아니라 문구만 남는다(checkpoint·result JSON). 그래서
 * 「늦어서 끊김(반영 예정)」과 「다른 오류(429·미연결)」를 문구로 가른다.
 * 문구를 만드는 곳(EngineTimeoutError)과 읽는 곳이 이 파일을 함께 쓴다.
 */

/**
 * 늦은 엔진 다시 묻기(2026-10-07 · 관제탑 설계 B)의 1회 호출 상한.
 *   첫 측정의 60초 상한에 걸린 칸만, 새 함수 호출(270초 예산)에서 **한 번** 다시 묻는다.
 *   운영 관측 최장: ChatGPT 185초 · Claude 161초 → 200초면 둘 다 15초 이상 여유가 있다.
 *   새 호출 시작(≈5초) + 200초 = 205초 → 판정·완료 저장에 270초 마감까지 ≥35초가 남는다
 *   (새 질문 시작 상한과 같은 35초 여유). 시작 조건은 @repo/audit 의 late-cells 가 지킨다.
 */
export const LATE_CELL_REASK_TIMEOUT_MS = 200_000;

const ENGINE_TIMEOUT_MESSAGE_RE = /^Engine \S+ timed out after \d+ms$/;

export const engineTimeoutMessage = (
  engineId: string,
  timeoutMs: number
): string => `Engine ${engineId} timed out after ${timeoutMs}ms`;

/** 이 오류 문구가 「엔진 개별 상한으로 끊긴 호출」인가. */
export function isEngineTimeoutMessage(
  message: string | null | undefined
): boolean {
  return typeof message === "string" && ENGINE_TIMEOUT_MESSAGE_RE.test(message);
}
