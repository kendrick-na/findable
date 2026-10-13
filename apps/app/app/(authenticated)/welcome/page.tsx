import { loadBrandSetupReadiness } from "@repo/audit/brand-setup";
import { competitorSettingOf } from "@repo/audit/setup-readiness";
import { planCapabilities } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { currentUser } from "@repo/auth/server";
import { database } from "@repo/database";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  requireOrg,
  scopedBrandById,
  scopedBrands,
  scopedLatestSiteReadinessRun,
} from "@/lib/db/scoped";
import { getAppDictionary } from "@/lib/i18n";
import { hasCompletedSetup } from "@/lib/onboarding";
import { suggestCompetitorsUnlessPreview } from "@/lib/preview/ai-guards";
import type { SiteReadinessRunStatus } from "@/lib/site-readiness/types";
import { AssignBrandForm } from "../features/brand/assign-brand-form";
import { getPrimaryEmail } from "../lib/user";
import { firstOpenStep } from "./resume-step";
import { WelcomeFlowServer } from "./welcome-flow-server";
import { WelcomeIntro } from "./welcome-intro";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = (await getAppDictionary()).onboarding;
  return { title: t.metaTitle, description: t.metaDescription };
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
/** 쿼리 `step`(2~6). 없거나 이상하면 2단계부터. */
const clampStep = (value?: string): number => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? Math.min(6, Math.max(2, n)) : 2;
};

/** 비어 있는 설정 항목 코드(필수+권장) — 서버 준비도 규칙 한 곳. 읽기 실패면 빈 목록(= 2단계부터). */
const missingSetupCodes = async (brandId: string): Promise<string[]> => {
  const loaded = await loadBrandSetupReadiness(brandId);
  return loaded
    ? [
        ...loaded.readiness.missingRequired,
        ...loaded.readiness.missingRecommended,
      ]
    : ["name"];
};

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const WelcomePage = async ({
  searchParams,
}: {
  // Next.js 16 — searchParams 는 Promise(대시보드·measuring 관례와 동일).
  searchParams: Promise<{ brand?: string; step?: string }>;
}) => {
  const { brand: brandParam, step: stepParam } = await searchParams;
  // 🔴 `?brand=<id>` = '브랜드 추가' 뒤 설정 이어가기(2026-10-13) — 첫 온보딩과 **같은 순서**를 쓰되,
  //   이미 온보딩을 마친 조직의 단계·완료는 건드리지 않는다. 다른 org 의 id 는 찾지 못한다(scopedBrandById).
  if (brandParam) {
    const target = await scopedBrandById(brandParam);
    if (!target) {
      redirect("/brand");
    }
    // 🔴 `step` 가 없으면 **비어 있는 첫 단계**부터 — 항상 2단계부터 시작하면 이미 저장한
    //   경쟁사·'없음'을 다시 거쳐 AI 후보로 덮어쓰게 된다(2026-10-13).
    const step = stepParam
      ? clampStep(stepParam)
      : firstOpenStep(await missingSetupCodes(target.id));
    return await renderSetup(target, { persistStep: false, step });
  }
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
    const dict = await getAppDictionary();
    const priorAudit = email
      ? await database.auditJob.findFirst({
          orderBy: { createdAt: "desc" },
          select: { domain: true },
          where: { email, status: "completed" },
        })
      : null;
    return (
      <WelcomeIntro t={dict.onboarding}>
        <AssignBrandForm
          initialDomain={priorAudit?.domain}
          mode="onboarding"
          nextHref="/welcome"
          t={dict.brandForm}
        />
      </WelcomeIntro>
    );
  }

  const organization = await database.organization.findUnique({
    select: { onboardingStep: true },
    where: { id: orgId },
  });
  return await renderSetup(brand, {
    persistStep: true,
    step: organization?.onboardingStep ?? 2,
  });
};

type SetupBrand = NonNullable<Awaited<ReturnType<typeof scopedBrandById>>>;

/** 2~6단계 — 등록이 끝났으니 지역·별칭·경쟁사·질문을 받고, 마지막에 측정을 시작한다. */
const renderSetup = async (
  brand: SetupBrand,
  opts: { persistStep: boolean; step: number }
) => {
  // 1단계에서 예약된 기술 진단은 가입 흐름과 분리돼 백그라운드에서 돈다.
  // 마지막 단계가 추측으로 "완료"라고 말하지 않도록 실제 상태를 내려보낸다.
  const readinessRun = await scopedLatestSiteReadinessRun(brand.id);

  // 경쟁사 추천(§7). LLM 1회 호출로 후보를 만든다(측정 전이라 저장된 답변 재파싱은 못 쓴다).
  //   ⚠️ 후보만 만든다 — 기본 선택은 화면(welcome-flow.tsx)이 결정한다.
  //   저장된 경쟁사가 있거나 '없음'을 저장했으면 후보가 필요 없다 — 호출 자체를 하지 않는다(원가·덮어쓰기 방지).
  const storedCompetitors = stringList(brand.competitors);
  const noneSaved = competitorSettingOf(brand.competitors).kind === "none";
  const suggestedCompetitors =
    opts.step < 5 && storedCompetitors.length === 0 && !noneSaved
      ? await suggestCompetitorsUnlessPreview({
          brandName: brand.name,
          domain: brand.domain,
          industry: brand.industry,
        })
      : [];

  // 플랜의 추적 질문 상한 — 5단계가 한도에 닿은 사람에게 AI 제안 대신 안내를 보이게 한다(원가 보호).
  const promptLimit = planCapabilities(await getCurrentPlan()).promptLimit;
  const questionLimit = Number.isFinite(promptLimit) ? promptLimit : null;
  const savedQuestionCount = await database.prompt.count({
    where: { brandId: brand.id, isAutoGenerated: true },
  });

  return (
    <WelcomeFlowServer
      brandDomain={brand.domain}
      brandId={brand.id}
      brandIndustry={brand.industry}
      brandName={brand.name}
      initialCompetitors={stringList(brand.competitors)}
      initialNoCompetitors={noneSaved}
      initialQuestionCount={savedQuestionCount}
      initialScope={brand.marketScope ?? undefined}
      initialStep={opts.step}
      initialVariants={stringList(brand.entityVariants)}
      persistStep={opts.persistStep}
      questionLimit={questionLimit}
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
