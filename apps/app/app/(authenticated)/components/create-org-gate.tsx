import { CreateOrganization } from "@repo/auth/client";

/**
 * 조직 0개 신규 가입자용 온보딩 게이트 (2026-07-30 플로우 감사 🔴1 해소).
 * (authenticated) layout이 orgId 없음을 감지하면 사이드바 대신 이 화면만 렌더.
 * Clerk 표준 컴포넌트 사용(커스텀 조직 생성 흐름 금지 — 로그인 표준화와 동일 원칙).
 *
 * 🔴 **여기가 온보딩의 진짜 진입점이다**(N-44 실측). 신규 가입자는
 *   `가입 → (org 0개) → 이 화면 → 워크스페이스 생성` 을 거쳐 도착하므로,
 *   **조직 생성 직후 목적지**가 첫 여정을 결정한다.
 *   ⚠️ 예전 값은 `"/"`(대시보드) 였다 — 텅 빈 대시보드에 떨어뜨리고
 *   사용자가 `/brand` 를 **스스로 찾아가게** 두는 것이 §7 이 지적한 문제였다.
 *   → `/welcome` 으로 보낸다. 측정 이력이 있으면 그 화면이 알아서 `/` 로 되돌린다
 *     (`hasAnyMeasurement` 게이트) — 여기서 조건 분기를 만들지 않는다.
 */
export const CreateOrgGate = () => (
  <div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-[color:var(--findable-canvas,#08090a)] px-6 py-12">
    <div className="flex max-w-md flex-col gap-3 text-center">
      <p className="font-semibold text-[color:var(--findable-primary,#ff7a4d)] text-sm tracking-wide">
        FINDABLE
      </p>
      <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
        워크스페이스를 만들어 시작하세요
      </h1>
      <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
        측정·브랜드·리포트는 워크스페이스 단위로 저장돼요. 여기에는 회사나 팀
        이름을 적어주세요. 공개할 브랜드명과 도메인은 다음 단계에서 따로
        확인합니다.
      </p>
    </div>
    <CreateOrganization
      afterCreateOrganizationUrl="/welcome"
      skipInvitationScreen
    />
  </div>
);
