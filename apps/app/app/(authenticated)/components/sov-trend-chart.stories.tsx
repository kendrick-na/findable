import { Button } from "@repo/design-system/components/ui/button";
import type { Meta, StoryObj } from "@storybook/react";
import { SovTrendChart } from "./sov-trend-chart";

/**
 * 실제 `StartTrackingButton` 은 서버 액션(→Prisma·러너)을 타서 브라우저 번들에
 * 담기지 않는다. 스토리는 **모양**을 보는 것이므로 같은 자리·같은 라벨의 버튼을 쓴다.
 */
const MockButton = () => <Button size="sm">측정 시작</Button>;

/**
 * 「시간에 따른 변화」 — 2026-08-17 세션N-37.
 *
 * 🔴 **이 스토리가 있는 이유**: 빈 상태(측정 1회)를 **로그인 계정으로는 볼 수 없다.**
 *   검증 계정(설화수)이 오늘 2회차가 되면서 그래프가 그려져 빈 화면이 안 나온다.
 *   그런데 고쳐야 했던 건 바로 그 **빈 화면**이었다 —
 *   *"두 번째 측정을 하면 그려드려요"* 라고 말하면서 **버튼을 안 줬다.**
 *
 * ⚠️ 세 스토리가 **서로 다른 것을 검사한다**(픽셀이 같은 장식 스토리를 만들지 않는다):
 *   ① 빈 상태 + 버튼  ② 빈 상태인데 도메인이 없어 버튼을 **숨기는** 경우  ③ 그려진 그래프
 */
const meta = {
  component: SovTrendChart,
  parameters: { layout: "padded" },
  title: "대시보드/시간에 따른 변화",
} satisfies Meta<typeof SovTrendChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 🔴 핵심 — 측정 1회. **재측정 버튼이 보여야 한다.** */
export const 빈상태_버튼있음: Story = {
  args: {
    brandId: "brand_demo",
    emptyAction: <MockButton />,
    trend: [
      {
        label: "2026.08.14",
        position: 2.7,
        positiveRate: 14,
        sov: 95,
        timestamp: new Date("2026-08-14").getTime(),
      },
    ],
  },
};

/**
 * 도메인을 모르는 경우(구 AuditJob 폴백) — **버튼이 없어야 한다.**
 * 못 누르는 버튼을 그리면 그게 거짓말이다.
 */
export const 빈상태_버튼없음: Story = {
  args: {
    brandId: null,
    trend: [
      {
        label: "2026.08.14",
        position: null,
        positiveRate: null,
        sov: 95,
        timestamp: new Date("2026-08-14").getTime(),
      },
    ],
  },
};

/** 2회차 이상 — 실제 그래프. 버튼 자리가 아니다. */
export const 그래프: Story = {
  args: {
    brandId: "brand_demo",
    trend: [
      {
        label: "2026.08.14",
        position: 2.7,
        positiveRate: 14,
        sov: 95,
        timestamp: new Date("2026-08-14").getTime(),
      },
      {
        label: "2026.08.17",
        position: 1,
        positiveRate: 27,
        sov: 95,
        timestamp: new Date("2026-08-17").getTime(),
      },
    ],
  },
};

/**
 * 🔴 **기간 필터가 실제로 동작하는 형태**(2026-08-18 세션N-41).
 *
 * `nike.com` 실측 그대로다 — completed 측정 **6회 · Jul 30~Aug 17 ·
 * SoV 0→97→97→94→97→94**(프로덕션 DB 조회).
 * 이 형태에서만 필터가 의미를 갖는다: **7일=4점 · 30일=6점**.
 *
 * ⚠️ 위 `그래프` 스토리(2점)는 필터 버튼이 **안 나온다** — 어떤 기간도 2점 이상을
 *   못 만들어 `rangeOptions` 가 선택지를 1개로 줄이기 때문이다(장식 컨트롤 방지).
 *   즉 이 스토리는 앞 스토리와 **다른 것을 검사한다**(픽셀 같은 장식 스토리 금지 규율).
 */
export const 기간필터: Story = {
  args: {
    brandId: "brand_demo",
    trend: [
      {
        label: "2026.07.30",
        position: null,
        positiveRate: null,
        sov: 0,
        timestamp: new Date("2026-07-30").getTime(),
      },
      {
        label: "2026.07.30",
        position: 2.4,
        positiveRate: 12,
        sov: 97,
        timestamp: new Date("2026-07-30T12:00:00").getTime(),
      },
      {
        label: "2026.08.11",
        position: 2.1,
        positiveRate: 18,
        sov: 97,
        timestamp: new Date("2026-08-11").getTime(),
      },
      {
        label: "2026.08.13",
        position: 1.9,
        positiveRate: 21,
        sov: 94,
        timestamp: new Date("2026-08-13").getTime(),
      },
      {
        label: "2026.08.15",
        position: 1.6,
        positiveRate: 24,
        sov: 97,
        timestamp: new Date("2026-08-15").getTime(),
      },
      {
        label: "2026.08.17",
        position: 1.4,
        positiveRate: 27,
        sov: 94,
        timestamp: new Date("2026-08-17").getTime(),
      },
    ],
  },
};
