import { suggestCompetitors } from "@repo/ai/lib/competitor-suggest";
import { currentUser } from "@repo/auth/server";
import { database } from "@repo/database";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  requireOrg,
  scopedBrands,
  scopedLatestSiteReadinessRun,
} from "@/lib/db/scoped";
import { getAppDictionary } from "@/lib/i18n";
import { hasCompletedSetup } from "@/lib/onboarding";
import type { SiteReadinessRunStatus } from "@/lib/site-readiness/types";
import { AssignBrandForm } from "../features/brand/assign-brand-form";
import { getPrimaryEmail } from "../lib/user";
import { WelcomeFlowServer } from "./welcome-flow-server";
import { WelcomeIntro } from "./welcome-intro";

export const metadata: Metadata = {
  title: "시작하기 · Findable",
  description: "도메인 하나만 넣으면 AI가 우리를 뭐라고 말하는지 알려드려요.",
};

/**
 * 첫 사용자 여정(온보딩) — 📕 설계 = `재설계안_v4` §7-B/C · 👤 2026-08-19 승인.
 *
 * 🔴 **게이트가 이 화면의 절반이다.** 측정 이력이 있으면 **들어오지 못한다**:
 *   ① 기존 고객이 온보딩에 갇히지 않게(제품을 이미 아는 사람에게 튜토리얼은 방해다)
 *   ② 전자상거래법 **「반복간섭」**(v4 §7-D-4) — 매번 띄우면 규제 대상이다
 *   ⚠️ 판정은 `hasAnyMeasurement()` **하나로만** 한다. 이 저장소엔 "측정이 있나"를
 *     답하는 코드가 이미 둘이었고(대시보드·레이아웃) **서로 답이 다르다**.
 *     여기서 세 번째를 만들면 화면끼리 갈린다(📕N-43 「측정 34회」 사고와 같은 뿌리).
 *
 * ⚠️ org 는 이 화면에 **도달한 시점에 이미 보장**된다 — `(authenticated)/layout.tsx` 가
 *   `orgId` 없으면 `CreateOrgGate` 를 대신 렌더한다(2026-07-30 플로우 감사).
 *
 * 🔴 **1단계 폼을 복제하지 않는다**(§7-D-3). 브랜드가 없으면 기존 `AssignBrandForm` 을
 *   그대로 렌더한다 — 그 폼이 등록 + 측정 시작 + `/brand/measuring` 이동까지 이미 한다.
 *   ⚠️ 그래서 `/welcome` 과 `/brand` 는 **같은 폼**을 쓴다(화면 2개가 갈리지 않는다).
 */
/** 1단계 폼이 실어 보내는 측정 결말. 없으면 `started`(정상 경로). */
type MeasurementOutcome = "failed" | "rate_limited" | "started";

const toOutcome = (value?: string): MeasurementOutcome =>
  value === "rate_limited" || value === "failed" ? value : "started";

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const WelcomePage = async ({
  searchParams,
}: {
  // Next.js 16 — searchParams 는 Promise(대시보드·measuring 관례와 동일).
  searchParams: Promise<{ measurement?: string }>;
}) => {
  // 측정을 해본 조직은 온보딩 대상이 아니다 → 대시보드로.
  if (await hasCompletedSetup()) {
    redirect("/");
  }
  const orgId = await requireOrg();
  const brands = await scopedBrands();
  const brand = brands.at(0);

  // 1단계 — 브랜드가 아직 없다. 기존 폼을 그대로 쓴다(새 폼을 만들지 않는다).
  if (!brand) {
    // 무료 공개 진단에서 가입한 사람은 같은 도메인을 다시 입력하지 않는다.
    const user = await currentUser();
    const email = user ? getPrimaryEmail(user) : null;
    const priorAudit = email
      ? await database.auditJob.findFirst({
          orderBy: { createdAt: "desc" },
          select: { domain: true },
          where: { email, status: "completed" },
        })
      : null;
    return (
      <WelcomeIntro t={(await getAppDictionary()).onboarding}>
        <AssignBrandForm
          initialDomain={priorAudit?.domain}
          mode="onboarding"
          nextHref="/welcome"
        />
      </WelcomeIntro>
    );
  }

  const organization = await database.organization.findUnique({
    select: { onboardingStep: true },
    where: { id: orgId },
  });
  // 1단계에서 예약된 기술 진단은 가입 흐름과 분리돼 백그라운드에서 돈다.
  // 마지막 단계가 추측으로 "완료"라고 말하지 않도록 실제 상태를 내려보낸다.
  const readinessRun = await scopedLatestSiteReadinessRun(brand.id);

  // 2~4단계 — 등록이 끝났으니 별칭·경쟁사를 받는다.
  // 🔴 측정이 실제로 돌고 있는지 — 마지막 단계가 이 값으로 **말을 바꾼다**.
  //   이게 없으면 한도 초과·실패인데도 *"측정은 이미 시작됐어요"* 라고 거짓말한다.
  const { measurement } = await searchParams;

  // 🔴 2026-08-21 — 경쟁사 추천(§7). `suggestedCompetitors` 는 화면 뼈대만 있고
  //   실제로 채워 넘긴 적이 없었다(prop 자체가 빠져 있었다). LLM 1회 호출로 채운다
  //   — 측정 전이라 `extractCompetitorLandscape`(저장된 AI 답변 재파싱, 원가 0)를
  //   못 쓴다. 상세=`packages/audit/competitor-suggest.ts` 주석.
  //   ⚠️ 후보만 만든다 — 기본 선택은 화면(welcome-flow.tsx)이 결정한다.
  const suggestedCompetitors =
    (organization?.onboardingStep ?? 2) < 5
      ? await suggestCompetitors({
          brandName: brand.name,
          domain: brand.domain,
          industry: brand.industry,
        })
      : [];

  return (
    <WelcomeFlowServer
      brandDomain={brand.domain}
      brandId={brand.id}
      brandIndustry={brand.industry}
      brandName={brand.name}
      initialCompetitors={stringList(brand.competitors)}
      initialScope={brand.marketScope ?? undefined}
      initialStep={organization?.onboardingStep ?? 2}
      initialVariants={stringList(brand.entityVariants)}
      measurement={toOutcome(measurement)}
      readiness={
        readinessRun
          ? {
              id: readinessRun.id,
              report: readinessRun.report,
              status: readinessRun.status as SiteReadinessRunStatus,
            }
          : undefined
      }
      suggestedCompetitors={suggestedCompetitors}
    />
  );
};

export default WelcomePage;
