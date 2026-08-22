/**
 * `/history` 상단 건수 문구 — **순수 함수**.
 *
 * 🔴 S7-4차(2026-08-12) — 왜 함수로 뺐나:
 *   이 판정을 `page.tsx` 안에 삼항으로 두면 **서버 컴포넌트라 테스트가 안 된다**.
 *   게다가 라이브 QA 계정은 측정 **0건**이라 "잘림" 경로는 눈으로도 영원히 확인이
 *   안 된다(배포 후 실제로 0건 경로만 보였다). → 규칙을 여기 두고 테스트로 고정한다.
 *
 * 막는 사고: `take: 50` 인데 총 건수도 상한도 화면에 없어서, 51번째 측정부터는
 *   **오래된 기록이 말없이 잘렸다**. 고객은 기록이 사라진 줄 안다(NN/g 1).
 */
export function historyCountLabel(
  totalCount: number,
  pageSize: number
): string {
  if (totalCount <= 0) {
    // 0건에 "0번 측정했어요"는 잡음이다 — 빈 상태 카드가 이미 안내한다.
    return "지금까지 측정한 결과를 모아뒀어요.";
  }
  const base = `지금까지 ${totalCount}번 측정했어요.`;
  if (totalCount > pageSize) {
    return `${base} 최근 ${pageSize}건만 보여드려요.`;
  }
  return base;
}
