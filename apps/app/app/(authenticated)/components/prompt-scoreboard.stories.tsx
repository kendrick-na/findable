import type { Meta, StoryObj } from "@storybook/react";
import { PromptScoreboard } from "./prompt-scoreboard";

/**
 * 「밀리는 질문」(질문별 성적표) — v4 §4-b **탭2**. 2026-08-17 세션N-39.
 *
 * 🔴 **왜 이 스토리를 만들었나**: v4 가 *"현재 `null` 반환 → **빈 상태 신설 필요**"* 라고
 *   짚은 자리가 그대로 남아 있었다. 0건이면 섹션이 **통째로 사라져서**
 *   사용자는 *"원래 없는 기능인가?"* 로 읽는다.
 *
 * 🔬 **DB 실측(2026-08-17 · 진짜 DB Tracking 239행)**:
 *   · 7/7 브랜드가 질문 보유 → **오늘 빈 상태 발생 0건**
 *   · `promptId` null **0행** · `prompt.text` 없음 **0행** (버려지는 행 없음)
 *   → 즉 지금은 안 나는 화면이다. 그런데도 만든 이유:
 *     이 표는 **최신 1회분만** 보는데(`dashboard-data.ts:661`) 그 회차에 질문이
 *     안 붙으면 `foldPromptScores` 가 전부 버린다 = **N-36 의 「조용한 증발」과 같은 형상**.
 *     그때 섹션이 사라져 3주간 아무도 못 봤다. **0건에도 자리를 지켜야 빨리 드러난다.**
 *
 * 🔴 이 스토리가 **눈으로 확인할 것**:
 *   ① 0건일 때 빈 화면이 아니라 **이유 + 다음 순서**가 나오는가
 *   ② 약한 질문이 **위**로 오는가(정렬 목적: "어디서 지고 있나")
 *   ③ 못한 질문에 **빨강을 쓰지 않는가**(§9-2 GSC 안티패닉)
 *   ④ 순위 없는 질문이 `0` 이 아니라 `—` 인가(0은 "1등"이라는 정반대 신호)
 *
 * 숫자는 **실측 그대로**다(나이키 5질문 · 66행). 지어내지 않는다.
 */
const meta = {
  component: PromptScoreboard,
  parameters: { layout: "padded" },
  title: "대시보드/밀리는 질문",
} satisfies Meta<typeof PromptScoreboard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 🔴 이번에 신설한 것 — 예전엔 여기서 화면이 **사라졌다**. */
export const 측정은있는데질문이없음: Story = {
  args: { scores: [] },
};

/** 실측 형상(나이키) — 약한 질문이 위로. */
export const 실데이터: Story = {
  args: {
    scores: [
      { text: "러닝화 추천", hit: 1, total: 7, position: null },
      { text: "나이키 어때", hit: 3, total: 7, position: 3.5 },
      { text: "스포츠 브랜드 추천", hit: 4, total: 7, position: 2.7 },
      { text: "나이키 후기", hit: 6, total: 7, position: 1.8 },
      { text: "나이키 장단점", hit: 7, total: 7, position: 1 },
    ],
  },
};

/** 순위가 전부 없는 경우 — `—` 로 나와야 한다(0으로 깔면 거짓 신호). */
export const 순위없음: Story = {
  args: {
    scores: [
      { text: "카테고리 추천 5개", hit: 0, total: 7, position: null },
      { text: "브랜드 비교", hit: 1, total: 7, position: null },
    ],
  },
};
