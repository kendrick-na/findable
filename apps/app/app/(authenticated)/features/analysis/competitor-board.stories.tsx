import type { Meta, StoryObj } from "@storybook/react";
import { CompetitorBoard } from "./competitor-board";

/**
 * 「경쟁사 비교」 — 2026-08-22 지표 혼동 수정.
 *
 * 🔴 이 스토리가 **눈으로 확인할 것**: 왼쪽 순번(등장률 기준)과 오른쪽
 *   "평균 등장 순위"(등장했을 때 순번의 평균)가 서로 다른 계산이라는 게
 *   라벨과 뜻풀이 details로 구분되어 보이는가. 실측 사례(👤 보고) —
 *   1위 아디다스 13%(평균 1.7위) vs 3위 나이키 8%(평균 1위)에서
 *   "1위인데 왜 평균이 더 나쁘지?"로 혼동됐던 화면.
 */
const meta = {
  component: CompetitorBoard,
  parameters: { layout: "padded" },
  title: "대시보드/경쟁사 비교",
} satisfies Meta<typeof CompetitorBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 👤 보고 사례 재현 — 등장률 순위와 평균 등장 순위가 갈리는 경우. */
export const 등장률과_평균순위가_갈리는_경우: Story = {
  args: {
    data: {
      brandName: "우리브랜드",
      measuredAt: new Date("2026-08-21T00:00:00.000Z"),
      responsesParsed: 42,
      landscape: {
        brandFound: true,
        brandInRanking: true,
        discriminative: true,
        sampleSize: 42,
        ranking: [
          {
            name: "아디다스",
            mentions: 13,
            shareOfVoice: 13,
            averageRank: 1.7,
          },
          {
            name: "우리브랜드",
            mentions: 10,
            shareOfVoice: 10,
            averageRank: 2.1,
          },
          { name: "나이키", mentions: 8, shareOfVoice: 8, averageRank: 1 },
          { name: "뉴발란스", mentions: 6, shareOfVoice: 6, averageRank: 3.2 },
        ],
      },
    },
  },
};

/** 순위표에 없지만 본문엔 언급된 경우(경고 문구 분기 확인용). */
export const 순위표_밖_언급: Story = {
  args: {
    data: {
      brandName: "우리브랜드",
      measuredAt: new Date("2026-08-21T00:00:00.000Z"),
      responsesParsed: 20,
      landscape: {
        brandFound: true,
        brandInRanking: false,
        discriminative: true,
        sampleSize: 20,
        ranking: [
          {
            name: "아디다스",
            mentions: 13,
            shareOfVoice: 13,
            averageRank: 1.7,
          },
          { name: "나이키", mentions: 8, shareOfVoice: 8, averageRank: 1 },
        ],
      },
    },
  },
};
