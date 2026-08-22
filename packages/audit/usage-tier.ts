// 사용량 티어 판정 — audit 게이트와 심층분석(crew) 게이트가 공유 (원가전략 2026-07-27).
//   - admin(FINDABLE_ADMIN_EMAILS): 무제한.
//   - 승인 파트너(FINDABLE_PARTNER_EMAILS): audit 하루 1회, 심층분석 허용.
//   - 일반 리드: audit 이메일+도메인 24h, 심층분석 차단(유료 유도).

export type UsageTier = "admin" | "partner" | "lead";

function parseEmailList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function resolveTier(email: string): UsageTier {
  const emailLower = email.toLowerCase();
  if (parseEmailList(process.env.FINDABLE_ADMIN_EMAILS).includes(emailLower)) {
    return "admin";
  }
  if (
    parseEmailList(process.env.FINDABLE_PARTNER_EMAILS).includes(emailLower)
  ) {
    return "partner";
  }
  return "lead";
}

// 심층분석(CrewAI) 이용 자격 — admin·파트너·org 측정은 **무조건** 통과.
// CrewAI는 Letsur haiku로 호출돼 크레딧을 소모하므로 무제한 개방은 하지 않는다.
//
// ⚠️ **이름과 달리 결제 게이트가 아니다.** `isPaid(plan)` 을 참조하지 않고
//   `org:`(로그인 워크스페이스)·admin·partner 만 본다 → 실질은 **로그인 게이트**다.
//   free 플랜이어도 가입만 하면 통과한다. 이 사실을 모르고 화면에 *"유료 플랜"* 이라
//   쓰면 거짓 표기가 된다(세션N-25 에서 실제로 그 상태였다).
export function canRunDeepAnalysis(email: string): boolean {
  // org 측정(AuditJob.email = "org:{orgId}")은 로그인 워크스페이스에서 인증·rate-limit
  // 뒤에서만 생성된다 → 심층분석 허용. (2026-07-30: 이 처리가 없어 로그인 사용자의
  // org 측정이 전부 "일반 리드"로 판정돼 소유자 본인도 게이트에 막혔다.)
  if (email.startsWith("org:")) {
    return true;
  }
  const tier = resolveTier(email);
  return tier === "admin" || tier === "partner";
}

/**
 * 비로그인 리드에게 허용하는 **평생 무료 crew 횟수**.
 *
 * 🔴 왜 "하루 N회"가 아니라 **평생 1회**인가 — 이건 원가 방어가 아니라 **미끼**다.
 *   목적이 *"가치를 한 번 맛보게 하고 가입으로 잇는 것"* 이므로, 매일 리셋되면
 *   가입할 이유 자체가 사라진다(무료가 "반복 확인할 이유"까지 줘버리는 Docker형 실패 —
 *   📕`UIUX_대개선_기획서:117~136`). 반복 이유는 유료 축(시간·비교·알림)에 남긴다.
 */
export const FREE_LEAD_CREW_QUOTA = 1;

/**
 * 이 리드가 무료 crew 체험분을 **아직 안 썼는지** 판정한다.
 *
 * ⚠️ 자격(`canRunDeepAnalysis`)과 분리한 이유: 자격은 **순수 판정**(env·문자열)이라
 *   테스트가 쉽고 어디서든 부를 수 있는데, 소진 여부는 **DB 조회**가 필요하다.
 *   둘을 한 함수로 합치면 순수 판정까지 async·DB 의존이 되어 재사용이 어려워진다.
 *
 * @param usedCount 같은 이메일로 이미 **실행된**(= `crewStartedAt` 이 있는) crew 건수.
 *   🔴 실패분도 포함해서 세야 한다 — 실패해도 **크레딧은 이미 나갔다**.
 *   조회는 호출부가 한다(이 패키지는 DB 를 직접 잡지 않는다).
 */
export function hasFreeCrewQuotaLeft(usedCount: number): boolean {
  return usedCount < FREE_LEAD_CREW_QUOTA;
}
