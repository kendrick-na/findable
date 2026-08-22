/**
 * 관리자 진단 목록의 건수 안내 문구 — 순수 함수.
 *
 * 왜 서버 컴포넌트 밖으로 뺐나: `historyCountLabel` 과 같은 이유다.
 * 서버 컴포넌트 안에 두면 테스트가 안 되고, **"51번째부터 말없이 잘리는"** 경로는
 * 데이터가 적은 개발 환경에서 눈으로 확인할 수 없다 → 테스트로 고정한다.
 */
export function adminAuditsCountLabel(
  totalCount: number,
  pageSize: number
): string {
  if (totalCount <= 0) {
    return "아직 생성된 진단이 없어요.";
  }
  const base = `전체 ${totalCount}건.`;
  if (totalCount > pageSize) {
    return `${base} 최근 ${pageSize}건만 보여드려요.`;
  }
  return base;
}
