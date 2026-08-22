import type { Meta, StoryObj } from "@storybook/react";
import { SentimentSection } from "./sentiment-section";

/**
 * 「평가」(감성) — v4 착수순서 **3번**. 2026-08-17 세션N-38 화면 검증.
 *
 * 🔬 **v4 가 이 탭에 건 경고를 실측으로 확인했다**:
 * > v4 §3 결함3: *"`sentiment` 는 언급된 행에서만 생성 → 저인지도 브랜드는 대부분 null.
 * >   탭→**카드 축소 검토**"*
 *
 * **DB 실측(Tracking 239행, 2026-08-17)**: `neutral` 68% · `positive` 19% · `null` **13%**
 * → 🔴 **"대부분 null" 은 아니었다**(13%). 탭을 접을 근거는 없다.
 * → ⚠️ 대신 진짜 문제는 **`negative` 가 전 데이터셋 0건**이라는 것이다.
 *   분류기가 키워드 휴리스틱이라 부정을 거의 못 잡는다.
 *   **"부정 0 = 좋음" 으로 읽히면 못 잰 걸 좋은 소식으로 파는 것**이 된다.
 *
 * 🔴 이 스토리가 **눈으로 확인할 것**:
 *   ① 부정 0건이 성과처럼 보이지 않는가(못 잰 것 vs 좋은 것)
 *   ② 측정 0건일 때 빈 화면이 아니라 설명이 나오는가
 *   ③ 질문별·AI별 분해가 실제로 그려지는가(v4 §탭5 「🆕 추가」 항목)
 *
 * 숫자는 **브랜드별 실측 그대로**다(지어내지 않는다).
 */
const meta = {
  component: SentimentSection,
  parameters: { layout: "padded" },
  title: "대시보드/평가(감성)",
} satisfies Meta<typeof SentimentSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 나이키 실측: 66행 중 긍정 9 · 중립 54 · 부정 0 · null 3. */
const NIKE = { positive: 9, neutral: 54, negative: 0, total: 63 };

/** ⭐ 기본 — 실측 분포. 부정 0건이 어떻게 보이는지가 핵심. */
export const 실측_나이키: Story = {
  args: {
    summary: NIKE,
    byPrompt: [
      {
        label: "나이키 러닝화 추천받을 수 있을까?",
        summary: { positive: 3, neutral: 11, negative: 0, total: 14 },
      },
      {
        label: "스포츠화 브랜드 추천 5개 알려줄래?",
        summary: { positive: 2, neutral: 12, negative: 0, total: 14 },
      },
      {
        label: "나이키 신발 어떤 모델이 가장 편해?",
        summary: { positive: 4, neutral: 10, negative: 0, total: 14 },
      },
    ],
    byEngine: [
      {
        label: "ChatGPT",
        summary: { positive: 2, neutral: 11, negative: 0, total: 13 },
      },
      {
        label: "네이버",
        summary: { positive: 3, neutral: 7, negative: 0, total: 10 },
      },
      {
        label: "다음",
        summary: { positive: 1, neutral: 5, negative: 0, total: 6 },
      },
      {
        label: "HyperCLOVA X",
        summary: { positive: 3, neutral: 8, negative: 0, total: 11 },
      },
    ],
  },
};

/**
 * 🔴 측정 0건 — v4 §탭5 가 *"0건 상태 **필수**"* 라고 못박은 자리.
 * 빈 화면이면 저인지도 브랜드가 처음 보는 화면이 공백이 된다.
 */
export const 측정_0건: Story = {
  args: { summary: null, byPrompt: [], byEngine: [] },
};

/**
 * 분해는 없고 요약만 있는 경우(측정 1회차 등).
 * 질문별·AI별 목록이 비어도 상단 분포는 서야 한다.
 */
export const 요약만: Story = {
  args: { summary: NIKE, byPrompt: [], byEngine: [] },
};
