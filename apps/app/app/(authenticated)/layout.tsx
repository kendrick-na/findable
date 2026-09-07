import { isAdmin } from "@repo/auth/admin";
import { planFromPublicMetadata } from "@repo/auth/plan";
import { auth, currentUser } from "@repo/auth/server";
import { SidebarProvider } from "@repo/design-system/components/ui/sidebar";
import { showBetaFeature } from "@repo/feature-flags";
import { secure } from "@repo/security";
import type { ReactNode } from "react";
import { getMyPartnerStatus } from "@/app/actions/partner/query";
import { env } from "@/env";
import { scopedHeaderMetric } from "@/lib/db/scoped";
import { getAppDictionary } from "@/lib/i18n";
import { CreateOrgGate } from "./components/create-org-gate";
import { NotificationsProvider } from "./components/notifications-provider";
import { GlobalSidebar } from "./components/sidebar";

interface AppLayoutProperties {
  readonly children: ReactNode;
}

const AppLayout = async ({ children }: AppLayoutProperties) => {
  if (env.ARCJET_KEY) {
    await secure(["CATEGORY:PREVIEW"]);
  }

  const user = await currentUser();
  const { orgId, redirectToSignIn } = await auth();
  const betaFeature = await showBetaFeature();

  if (!user) {
    return redirectToSignIn();
  }

  // 🔴 org 게이트(2026-07-30 플로우 감사): 신규 가입자는 조직이 0개인 채 도착하는데,
  //   측정·브랜드 등 핵심 화면이 requireOrg()로 throw → 조직 생성 UI가 없으면 제품 진입 자체가 불가.
  //   조직이 없으면 사이드바 대신 조직 생성 온보딩만 보여준다(생성 완료 → "/"로 복귀).
  if (!orgId) {
    return <CreateOrgGate />;
  }

  const plan = planFromPublicMetadata(
    user.publicMetadata as Record<string, unknown> | null | undefined
  );
  const admin = await isAdmin();
  // 파트너 배지 노출 판정(진실=DB status). 승인 파트너만 true.
  const { status: partnerStatus } = await getMyPartnerStatus();
  const isPartner = partnerStatus === "approved";

  // 🔴 모바일 하단 탭바 판정(v4 P0-5) — **측정 0건이면 탭이 전부 비어 있다.**
  //   ⚠️ 세는 코드를 새로 만들지 않는다 — 헤더 지표가 쓰는 헬퍼가 이미
  //   "측정 있으면 값 / 없으면 null" 을 준다(같은 값을 두 벌로 세면 화면끼리 갈린다).
  const hasMeasurement = (await scopedHeaderMetric()) !== null;

  // 🔴 v4 P0-3 다국어 뼈대(세션N-39) — 사전은 **서버에서만** 읽는다.
  //   사이드바·탭바가 둘 다 `"use client"` 라 `cookies()` 를 못 쓴다 →
  //   여기서 읽어 **필요한 문자열만** 내려보낸다(사전 전체를 넘기면 번들에 실린다).
  //   ⚠️ 이 앱은 아직 대부분 하드코딩이다. 여기가 **새 문자열의 정문**이고,
  //     기존 것은 만지는 김에 점진 이관한다(한 번에 64개는 회귀 위험이 크다).
  const t = await getAppDictionary();

  return (
    <NotificationsProvider userId={user.id}>
      <SidebarProvider>
        <GlobalSidebar
          exportLabels={t.exportDialog}
          hasMeasurement={hasMeasurement}
          isAdmin={admin}
          isPartner={isPartner}
          labels={{
            adminAudits: t.sidebar.adminAudits,
            adminContent: t.sidebar.adminContent,
            adminEvidence: t.sidebar.adminEvidence,
            adminMeasure: t.sidebar.adminMeasure,
            adminOps: t.sidebar.adminOps,
            adminOrgs: t.sidebar.adminOrgs,
            adminPartners: t.sidebar.adminPartners,
            alerts: t.sidebar.alerts,
            billing: t.sidebar.billing,
            brandMeasure: t.sidebar.brandMeasure,
            compare: t.sidebar.compare,
            content: t.sidebar.content,
            contentPerformance: t.sidebar.contentPerformance,
            currentPlan: t.sidebar.currentPlan,
            dashboard: t.sidebar.dashboard,
            export: t.sidebar.export,
            groupAccount: t.sidebar.groupAccount,
            groupAct: t.sidebar.groupAct,
            groupAdmin: t.sidebar.groupAdmin,
            groupAnalyze: t.sidebar.groupAnalyze,
            groupInsight: t.sidebar.groupInsight,
            groupMeasure: t.sidebar.groupMeasure,
            history: t.sidebar.history,
            lockedHint: t.sidebar.lockedHint,
            prompts: t.sidebar.prompts,
            publicInsights: t.sidebar.publicInsights,
            siteAudit: t.sidebar.siteAudit,
            sources: t.sidebar.sources,
            support: t.sidebar.support,
            todo: t.sidebar.todo,
          }}
          mobileTabLabels={{
            actions: t.nav.actions,
            history: t.nav.history,
            measure: t.nav.measure,
            more: t.nav.more,
            overview: t.nav.overview,
            primaryScreens: t.nav.primaryScreens,
          }}
          plan={plan}
        >
          {betaFeature && (
            <div className="m-4 rounded-full bg-blue-500 p-1.5 text-center text-sm text-white">
              Beta feature now available
            </div>
          )}
          {children}
        </GlobalSidebar>
      </SidebarProvider>
    </NotificationsProvider>
  );
};

export default AppLayout;
