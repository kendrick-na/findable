/**
 * 「아직 어떤 브랜드도 안 나온」 질문 참고 표시(2026-10-14) — 점수·삭제는 건드리지 않는다.
 *
 * @vitest-environment jsdom
 */
import koDict from "@repo/internationalization/dictionaries/ko.json";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { PromptList } from "../app/(authenticated)/prompts/prompt-list";
import {
  MIN_ANSWERS_FOR_ZERO_SIGNAL,
  zeroSignalPromptTexts,
} from "../lib/brand/zero-signal";

afterEach(cleanup);

const list = "추천:\n1. 라운드랩 - 크림\n2. 토리든 - 세럼\n3. 아누아 - 토너\n";
const plain =
  "GEO는 AI 답변에서의 노출을 다루는 개념입니다. SEO와는 대상이 다릅니다.";
const row = (
  promptText: string,
  excerpt: string,
  extra: Record<string, unknown> = {}
) => ({
  engineId: "chatgpt",
  excerpt,
  promptKind: "discovery",
  promptText,
  ...extra,
});
const brand = { name: "프란츠" };

describe("zeroSignalPromptTexts", () => {
  it("모든 AI 답변에 브랜드가 한 곳도 안 나온 이름 없는 질문만 가린다", () => {
    const result = {
      engineResponses: [
        row("SEO 랑 뭐가 달라?", plain),
        row("SEO 랑 뭐가 달라?", plain, { engineId: "claude" }),
        row("크림 추천해줘", list),
        row("크림 추천해줘", list, { engineId: "claude" }),
      ],
    };
    expect([...zeroSignalPromptTexts(result, brand)]).toEqual([
      "SEO 랑 뭐가 달라?",
    ]);
  });

  it(`판단할 AI 답변이 ${MIN_ANSWERS_FOR_ZERO_SIGNAL}개 미만이면 단정하지 않는다(표본 부족)`, () => {
    expect(
      zeroSignalPromptTexts({ engineResponses: [row("질문", plain)] }, brand)
        .size
    ).toBe(0);
  });

  it("브랜드 질문·검색 엔진·실패·스텁 답변은 보지 않는다", () => {
    const result = {
      engineResponses: [
        row("프란츠 후기 어때?", plain, { promptKind: "brand" }),
        row("프란츠 후기 어때?", plain, {
          promptKind: "brand",
          engineId: "claude",
        }),
        row("질문 A", plain, { engineId: "naver" }),
        row("질문 A", plain, { engineId: "daum" }),
        row("질문 B", plain, { errorMessage: "429" }),
        row("질문 B", plain, { isStub: true }),
      ],
    };
    expect(zeroSignalPromptTexts(result, brand).size).toBe(0);
  });

  it("우리 브랜드가 답변에 나오면 참고용이 아니다", () => {
    const text = `${plain} 프란츠도 대표적입니다.`;
    const result = {
      engineResponses: [
        row("질문", text),
        row("질문", text, { engineId: "claude" }),
      ],
    };
    expect(zeroSignalPromptTexts(result, brand).size).toBe(0);
  });

  it("모양이 이상한 결과는 빈 집합(던지지 않는다)", () => {
    for (const bad of [
      null,
      undefined,
      "x",
      [],
      {},
      { engineResponses: "x" },
    ]) {
      expect(zeroSignalPromptTexts(bad, brand).size).toBe(0);
    }
  });
});

describe("PromptList 참고 표시", () => {
  const base = {
    id: "p1",
    language: "ko",
    category: null,
    measuredCount: 3,
    text: "SEO 랑 뭐가 달라?",
  };

  it("zeroSignal 이면 참고용 안내가 보인다", () => {
    const s = render(
      <PromptList
        prompts={[{ ...base, zeroSignal: true }]}
        t={koDict.app.promptList}
      />
    );
    s.getByText(/참고용 · 최근 측정에서 아직 어떤 브랜드도/);
  });

  it("아니면 안내가 없다", () => {
    const s = render(<PromptList prompts={[base]} t={koDict.app.promptList} />);
    expect(s.queryByText(/참고용/)).toBeNull();
  });
});
