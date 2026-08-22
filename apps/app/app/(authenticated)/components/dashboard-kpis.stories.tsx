import type { Meta, StoryObj } from "@storybook/react";
import type { DashboardData } from "../lib/dashboard-data";
import { DashboardKpis } from "./dashboard-kpis";

/*
 * 히어로 3장 — **눈확인 부채 G-1·G-2 를 배포 없이 보는 자리**.
 *
 * 세션N-34 가 감성 정직화를 고쳤는데(커밋 `e8337b0`·`3cd65a7`) **아무도 눈으로 못 봤다**
 * — 로컬에서 대시보드 로그인이 안 돼서다. 그 부채를 여기서 갚는다.
 *
 * ⚠️ 숫자는 **실측값**이다(지어내지 않는다). 브랜드 3개 전량 긍정 비중 12~15%.
 */

const base: DashboardData = {
  averageMentionListSize: 5,
  averageMentionPosition: 2.3,
  // 순위 평균의 모집단(N-48). 실측 비율을 따른다 — 등장 대비 약 19% 만 순위가 나온다.
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

const meta = {
  title: "dashboard/DashboardKpis",
  component: DashboardKpis,
  parameters: { layout: "padded" },
  args: { data: base, paid: false },
} satisfies Meta<typeof DashboardKpis>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * 🔴 **G-1 이 고친 바로 그 경우.** 긍정 5/34 = **15%**.
 * 예전엔 `positive > 0` 하나로 갈려서 **「우호적」** 이라 말했다 —
 * 실제로는 85%가 중립인데 화면이 상태를 **좋게 반올림**하고 있었다.
 * 지금은 **「중립적」** 이어야 한다.
 */
export const 감성_긍정소수: Story = {};

/** 긍정이 3할을 넘으면 「우호적」. 경계 위쪽 확인용. */
export const 감성_우호적: Story = {
  args: {
    data: {
      ...base,
      sentiment: { negative: 0, neutral: 20, positive: 14, total: 34 },
    },
  },
};

/** 부정이 3할 이상이면 「부정 많음」. 라벨이 겁주지 않는지 함께 본다(§9 안티패닉). */
export const 감성_부정많음: Story = {
  args: {
    data: {
      ...base,
      sentiment: { negative: 12, neutral: 20, positive: 2, total: 34 },
    },
  },
};

/**
 * 측정은 됐는데 감성 분류가 **전부 null** 인 경우(total 0).
 * ⚠️ 실측상 negative 는 전 데이터셋 **0건**이다(분류기 한계) —
 * "부정 0 = 문제 없음" 으로 읽히면 못 잰 걸 좋은 소식으로 파는 것이다.
 */
export const 감성_없음: Story = {
  args: { data: { ...base, sentiment: null } },
};

/** 측정 직후 값이 아직 없는 상태 — 카드가 "—" 로 안전하게 표기되는지. */
export const 값없음: Story = {
  args: {
    data: {
      ...base,
      averageMentionPosition: null,
      averageMentionListSize: null,
      latestSov: null,
      sentiment: null,
      sovDeltaPoints: null,
      previousMentionPosition: null,
    },
  },
};

/**
 * 🔴 **측정은 돌았는데 볼 수 있는 결과가 하나도 없는 경우**(N-43 이 고친 모순).
 *
 * `값없음` 과 데이터는 같지만 이 스토리의 초점은 **회색 한 줄**이다.
 * 예전에는 카드가 "측정하면 …보여드려요"(측정 전) 인데 아래 줄은 **"측정 34회"** 라고
 * 말해 한 화면이 서로 모순됐다. `totalCount` 는 전체 job 수인데 카드 값은
 * `completed` + `sov` + 브랜드명 일치를 통과해야 생기기 때문이다.
 * 지금은 그 줄이 **"아직 볼 수 있는 결과가 없어요…"** 를 덧붙여 사실을 말해야 한다.
 */
export const 측정했지만_결과없음: Story = {
  args: {
    data: {
      ...base,
      averageMentionListSize: null,
      averageMentionPosition: null,
      coverage: null,
      latestSov: null,
      previousMentionPosition: null,
      sentiment: null,
      sovDeltaPoints: null,
    },
  },
};

/**
 * 측정 **0회**(막 가입한 조직) — 위와 데이터 모양은 비슷하지만
 * "결과를 읽지 못했다" 고 말하면 **거짓말**이다. 그 줄이 붙지 않아야 한다.
 */
export const 측정0회_신규조직: Story = {
  args: {
    data: {
      ...base,
      averageMentionListSize: null,
      averageMentionPosition: null,
      coverage: null,
      latestMeasuredAt: null,
      latestSov: null,
      previousMentionPosition: null,
      sentiment: null,
      sovDeltaPoints: null,
      totalCount: 0,
    },
  },
};

/** 유료(Growth 이상) — 잠긴 카드가 풀린 모습. */
export const 유료: Story = { args: { paid: true } };

/*
 * ⛔ 「긴 브랜드명」 스토리를 만들었다가 **지웠다**.
 *   스크린샷이 앞 스토리와 **픽셀 단위로 같아서** 확인해보니
 *   `DashboardKpis` 는 `latestBrandName` 을 **한 번도 읽지 않는다**(grep 0건).
 *   즉 아무것도 검사하지 않으면서 "긴 이름도 괜찮다" 는 **거짓 안심**을 주는 스토리였다.
 *   → 브랜드명 오버플로는 그 값을 실제로 렌더하는 컴포넌트(header·brand-switcher)에서 볼 것.
 */
