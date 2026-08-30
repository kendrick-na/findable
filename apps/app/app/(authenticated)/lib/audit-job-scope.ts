/**
 * 인증 앱의 AuditJob 소유 범위.
 * 조직이 선택된 동안 개인 이메일 무료진단을 섞지 않는다. 조직 측정은 정식 FK와
 * FK 도입 전 `org:{id}` 이메일 표기를 함께 읽고, 조직이 없을 때만 개인 이메일로 폴백한다.
 */
export const auditJobScope = (
  email: string | null,
  organizationId: string | null | undefined
) => {
  if (organizationId) {
    return {
      OR: [{ organizationId }, { email: `org:${organizationId}` }],
    };
  }
  return email ? { email } : null;
};
