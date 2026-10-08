/**
 * 진단 결과의 **소유자 판별** — 서버측 단일 진실 (2026-08-12 세션N-26).
 *
 * 왜 만들었나: `/api/audit/[jobId]` 가 **소유 검사 없이** `emailMasked` 를 항상 줬다.
 *   화면쪽 방어(`?shared=1`)는 `window.location` 을 읽는 **클라이언트 전용**이라
 *   ①소유자가 주소창 URL 을 그대로 복사해 보내면 표식이 없어 제3자에게 보이고
 *   ②API 를 직접 부르면 방어가 **아예 없다**.
 *   → 정석대로 **서버가 판정**하고, 소유자가 아니면 필드를 **응답에 넣지 않는다**.
 *
 * 🔴 **필드를 비우는 것이지 가리는 것이 아니다.** 마스킹된 값이라도 서버가 보내면
 *   네트워크 탭에 남는다. *"화면에서 안 보이게"* 는 방어가 아니다.
 *
 * ⚠️ 판정 규칙은 **앱 대시보드와 같은 것**을 쓴다(`(authenticated)/page.tsx` ·
 *   `history/page.tsx` 의 `identifiers` = 로그인 이메일 ∪ `org:{orgId}` ∪ FK).
 *   두 벌이 되면 *"대시보드엔 내 측정인데 결과 페이지는 남이라고 한다"* 가 된다.
 *
 * ⚠️ 순수 함수 — 의존성 0(테스트로 고정하기 위해. `apps/web` 에는 테스트 러너가 없다).
 */

/** 소유 판정에 필요한 job 측 정보(딱 이 두 개면 된다). */
export interface AuditJobOwner {
  /** 진단 신청 이메일. 무료 진단은 이것이 유일한 소유 단서다. */
  email: string;
  /** 조직 측정이면 FK. 무료 진단은 null. */
  organizationId?: string | null;
}

/** 요청자가 누구인지(비로그인이면 둘 다 없음). */
export interface AuditViewer {
  /** 로그인 이메일. 없으면 비로그인. */
  email?: string | null;
  /** 활성 조직 id. 없으면 개인. */
  orgId?: string | null;
}

/** 조직 측정을 이메일로 표기하던 레거시 프리픽스(FK backfill 이전 행). */
const ORG_EMAIL_PREFIX = "org:";

/**
 * 이메일 비교 정규화 — 대소문자·주변 공백 차이로 **소유자를 남으로 판정하면 안 된다.**
 *
 * ⚠️ 여기서 하지 않는 것: gmail 의 `.`·`+alias` 정규화. 그건 제공자마다 규칙이 달라서
 *   일반화하면 **남의 진단을 내 것으로 판정**할 수 있다(과잉 매칭이 과소 매칭보다 위험).
 */
const normalizeEmail = (value: string): string => value.trim().toLowerCase();

/*
 * 이 요청자가 이 진단의 **소유자인가**.
 *
 * 판정:
 *   1. job 에 `organizationId`가 있으면 활성 조직 id가 그 FK와 같을 때만 소유자
 *   2. 조직 FK가 없는 무료 진단은 로그인 이메일 == 진단 신청 이메일이면 소유자
 *   3. 조직 FK가 없는 레거시 행은 활성 조직 id가 `org:{orgId}`와 같으면 소유자
 *
 * 🔴 **비로그인은 항상 false.** jobId 는 링크만 있으면 누구나 열 수 있으므로
 *   (그게 이 라우트의 설계다 — 무료 진단은 로그인 없이 결과를 본다),
 *   *"링크를 안다"* 를 소유 증거로 쓰면 검사 자체가 무의미해진다.
 */
export function isAuditOwner(job: AuditJobOwner, viewer: AuditViewer): boolean {
  // 조직 FK는 개인 이메일보다 강한 테넌트 경계다. 조직이 다른데 이메일만 같다고
  // 통과시키면, 향후 backfill 또는 비정상 행에서 다른 활성 조직의 결과가 노출된다.
  if (job.organizationId) {
    return Boolean(viewer.orgId && job.organizationId === viewer.orgId);
  }

  const viewerEmail = viewer.email ? normalizeEmail(viewer.email) : null;
  if (viewerEmail && normalizeEmail(job.email) === viewerEmail) {
    return true;
  }
  if (!viewer.orgId) {
    return false;
  }
  return normalizeEmail(job.email) === `${ORG_EMAIL_PREFIX}${viewer.orgId}`;
}
