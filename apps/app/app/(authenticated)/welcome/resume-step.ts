/**
 * '설정 이어가기'(`/welcome?brand=`)가 시작할 단계 — **비어 있는 첫 단계**(2026-10-13).
 *
 * 예전엔 항상 2단계부터 시작해, 이미 저장한 경쟁사·'없음' 표식을 AI 후보로 덮어쓸 수 있었다.
 * 비어 있는 항목 코드는 서버 준비도 규칙(`getBrandSetupReadiness`) 한 곳에서 온다 — 여기서 규칙을 다시 만들지 않는다.
 *
 * 단계: 2 지역·언어 · 3 별칭 · 4 경쟁사 · 5 질문 · 6 확인·측정.
 */
export function firstOpenStep(missing: readonly string[]): number {
  if (
    missing.some(
      (code) =>
        code === "name" || code === "industry" || code === "market_scope"
    )
  ) {
    return 2;
  }
  if (missing.includes("alias")) {
    return 3;
  }
  if (missing.includes("competitors")) {
    return 4;
  }
  if (missing.includes("discovery_prompt")) {
    return 5;
  }
  return 6;
}
