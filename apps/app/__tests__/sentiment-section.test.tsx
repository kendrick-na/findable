/**
 * 감성 섹션 회귀 테스트 (2026-08-16 세션N-34 · G-2).
 *
 * 🔴 **고친 결함**: 「좋게 말하나?」 카드가 `/sources` 로 링크했는데
 *   그 화면엔 **감성이 한 줄도 없다**(`grep sentiment` → 0건).
 *   무료로 보여준 숫자를 눌렀더니 **딴 주제(출처 링크)의 결제 벽**이 떴다.
 *
 * ⭐ **경쟁사 4곳 실측으로 「독립 화면 신설」을 기각했다**:
 *   Peec(3대 지표 한 줄) · Profound(탭) · Otterly(등장률과 한 덩어리) · Scrunch(타일)
 *   → **감성만의 화면을 만든 곳은 0곳.** 우리는 무료 화면(`/actions`)의 섹션으로 붙였다.
 *
 * 🔴 **중립이 주인공**(실측 브랜드 3개 전량 85%+ 중립). 검사하는 계약:
 *   ①0건과 0%를 구분하는가 ②부정 0을 성과로 팔지 않는가 ③분모를 항상 밝히는가
 *
 * @vitest-environment jsdom
 */

import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SentimentSection } from "../app/(authenticated)/features/analysis/sentiment-section";

afterEach(cleanup);

/** 실측 그대로: 나이키 긍5·중28·부0 (중립 85%). */
const REAL = { positive: 5, neutral: 28, negative: 0, total: 33 };

describe("감성 섹션 — 0건과 0%를 구분한다", () => {
  it("🔴 판정할 답변이 없으면 `0%` 를 그리지 않는다", () => {
    const { container } = render(
      <SentimentSection byEngine={[]} byPrompt={[]} summary={null} />
    );
    const el = within(container);
    expect(el.getByText(/판정할 답변이 없어요/)).toBeTruthy();
    // 못 잰 것을 "0점"이라 부르지 않는다(apple.com 사고 유형).
    expect(container.textContent).not.toMatch(/0%/);
  });

  it("0건이면 밋밋함을 지적하지 않는다 — 근거가 없다", () => {
    const { container } = render(
      <SentimentSection byEngine={[]} byPrompt={[]} summary={null} />
    );
    expect(container.textContent).not.toMatch(/밋밋/);
  });
});

describe("감성 섹션 — 중립이 주인공", () => {
  it("중립 비중을 주 숫자로 말한다 (실측 85%)", () => {
    const { container } = render(
      <SentimentSection byEngine={[]} byPrompt={[]} summary={REAL} />
    );
    const el = within(container);
    expect(el.getByText("85%")).toBeTruthy();
    expect(el.getByText(/밋밋한 서술/)).toBeTruthy();
  });

  it("🔴 분모를 항상 함께 밝힌다", () => {
    const { container } = render(
      <SentimentSection byEngine={[]} byPrompt={[]} summary={REAL} />
    );
    // 긍정·중립·부정 + 총계가 전부 보여야 "나머지는 부정인가?" 오독을 막는다.
    expect(container.textContent).toMatch(/긍정 5/);
    expect(container.textContent).toMatch(/보통 28/);
    expect(container.textContent).toMatch(/부정 0/);
    expect(container.textContent).toMatch(/총 33건/);
  });

  it("🔴 부정 0건을 성과로 팔지 않는다", () => {
    const { container } = render(
      <SentimentSection byEngine={[]} byPrompt={[]} summary={REAL} />
    );
    // 분류기가 못 잡는 것이지 "문제 없음"이 아니다 — 그 한계를 화면이 밝혀야 한다.
    expect(container.textContent).toMatch(
      /부정 0건을.*문제 없음.*읽지 마세요/s
    );
  });

  it("긍정이 지배적이면 밋밋하다고 하지 않는다", () => {
    const positive = { positive: 20, neutral: 10, negative: 0, total: 30 };
    const { container } = render(
      <SentimentSection byEngine={[]} byPrompt={[]} summary={positive} />
    );
    expect(container.textContent).not.toMatch(/고를 이유를 못 주는/);
  });

  it("부정이 있으면 밋밋함 대신 그걸 말한다", () => {
    const negative = { positive: 2, neutral: 20, negative: 5, total: 27 };
    const { container } = render(
      <SentimentSection byEngine={[]} byPrompt={[]} summary={negative} />
    );
    // 부정이 실재하면 "밋밋" 프레임은 틀린 진단이 된다.
    expect(container.textContent).not.toMatch(/고를 이유를 못 주는/);
    // 그리고 "부정 0" 각주도 뜨면 안 된다.
    expect(container.textContent).not.toMatch(/문제 없음.*읽지 마세요/s);
  });
});

describe("감성 섹션 — 분해 목록", () => {
  it("질문별·AI별 분해를 분모와 함께 보여준다", () => {
    const { container } = render(
      <SentimentSection
        byEngine={[
          {
            label: "다음",
            summary: { positive: 0, neutral: 6, negative: 0, total: 6 },
          },
        ]}
        byPrompt={[
          {
            label: "나이키 러닝화 추천받을 수 있을까?",
            summary: { positive: 1, neutral: 6, negative: 0, total: 7 },
          },
        ]}
        summary={REAL}
      />
    );
    const el = within(container);
    expect(el.getByText("질문별")).toBeTruthy();
    expect(el.getByText("AI별")).toBeTruthy();
    expect(el.getByText(/나이키 러닝화 추천/)).toBeTruthy();
    expect(el.getByText("다음")).toBeTruthy();
  });

  it("분해가 비면 그 목록을 통째로 그리지 않는다 (빈 제목 금지)", () => {
    const { container } = render(
      <SentimentSection byEngine={[]} byPrompt={[]} summary={REAL} />
    );
    expect(container.textContent).not.toMatch(/질문별/);
    expect(container.textContent).not.toMatch(/AI별/);
  });
});
