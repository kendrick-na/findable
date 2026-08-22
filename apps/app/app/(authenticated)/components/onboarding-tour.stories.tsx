import type { Meta, StoryObj } from "@storybook/react";
import type { DashboardData } from "../lib/dashboard-data";
import { DashboardKpis } from "./dashboard-kpis";
import { OnboardingTour } from "./onboarding-tour";

/**
 * 대시보드 첫 진입 가이드 투어 눈확인용 — 2026-08-21(11번).
 *
 * ⚠️ 이 화면은 로그인 세션이 필요해 로컬 dev 서버로 직접 못 본다(기존 함정: 로컬은
 *   `pk_test`라 프로덕션 QA 계정 로그인 불가). Storybook으로 스포트라이트 위치·
 *   카드 배치·"N단계/4단계" 진행을 눈확인한다.
 *
 * ⚠️ 숫자는 `dashboard-kpis.stories.tsx`의 실측값(`base`)을 그대로 재사용한다
 *   (같은 값 2벌 두지 않기 — 여긴 투어가 실제 카드 위에 올바르게 뜨는지가 관심사).
 */

const REAL_DATA: DashboardData = {
  averageMentionListSize: 5,
  averageMentionPosition: 2.3,
  positionSampleCount: 18,
  brandOptions: [],
  coverage: null,
  latestBrandDomain: "themedicube.co.kr",
  latestBrandId: "brand_demo",
  latestBrandName: "메디큐브",
  latestMeasuredAt: new Date("2026-08-16T09:00:00Z"),
  latestSov: 62,
  previousMentionPosition: 3.1,
  previousSentiment: null,
  promptScores: [],
  sentiment: { negative: 0, neutral: 29, positive: 5, total: 34 },
  sovDeltaPoints: 4,
  totalCount: 34,
  trend: [],
};

/** 실제 대시보드 레이아웃을 흉내낸다 — `id="tour-kpis"` 등 앵커만 있으면 투어가 찾는다. */
const DashboardShell = () => (
  <div className="flex max-w-3xl flex-col gap-6 p-6">
    <div id="tour-kpis">
      <DashboardKpis data={REAL_DATA} paid={false} />
    </div>
    <div
      className="findable-card flex h-24 items-center justify-center text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm"
      id="tour-actions"
    >
      (NextActionsCard 자리)
    </div>
    <div
      className="findable-card flex h-24 items-center justify-center text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm"
      id="tour-trend"
    >
      (SovTrendChart 자리)
    </div>
    <div
      className="findable-card flex h-24 items-center justify-center text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm"
      id="tour-truth-mirror"
    >
      (TruthMirrorSection 자리)
    </div>
    <OnboardingTour />
  </div>
);

const meta = {
  title: "dashboard/OnboardingTour",
  component: DashboardShell,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DashboardShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 첫 진입 — localStorage에 아직 아무것도 없으므로 1단계부터 자동으로 뜬다. */
export const 첫진입: Story = {};
