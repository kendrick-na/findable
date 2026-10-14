/**
 * 질문 고르기 화면의 [미리 돌려 보기] (2026-10-14) — 기능이 켜진 곳에서만 보이고, 결과 배지를 보여 준다.
 *
 * @vitest-environment jsdom
 */
import koDict from "@repo/internationalization/dictionaries/ko.json";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionPicker } from "../app/(authenticated)/features/brand/question-picker";

afterEach(cleanup);

const prompts = [
  {
    text: "크림 추천해줘",
    language: "ko" as const,
    category: "competitor" as const,
    topic: "best_in_category" as const,
    type: "category" as const,
  },
  {
    text: "토너 뭐가 좋아?",
    language: "ko" as const,
    category: "competitor" as const,
    topic: "best_in_category" as const,
    type: "category" as const,
  },
];
const labels = koDict.app.questionPicker;

const setup = (
  extra: Record<string, unknown> = {},
  selected = new Set([0, 1])
) =>
  render(
    <QuestionPicker
      labels={labels}
      max={5}
      onEdit={vi.fn()}
      onSelectedChange={vi.fn()}
      prompts={prompts}
      selected={selected}
      {...extra}
    />
  );

describe("QuestionPicker 미리 돌려 보기", () => {
  it("onPreview 가 없으면(기능 꺼짐) 버튼도 안내도 없다", () => {
    const s = setup();
    expect(s.queryByRole("button", { name: labels.preview })).toBeNull();
    expect(s.queryByText(/이번 1번 기준/)).toBeNull();
  });

  it("onPreview 가 있으면 버튼과 '이번 1번 기준·저장 안 함' 안내가 보이고, 누르면 호출한다", () => {
    const onPreview = vi.fn();
    const s = setup({ onPreview });
    s.getByText(/이번 1번 기준/);
    fireEvent.click(s.getByRole("button", { name: labels.preview }));
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it("고른 질문이 없으면 버튼이 비활성", () => {
    const s = setup({ onPreview: vi.fn() }, new Set());
    expect(
      (s.getByRole("button", { name: labels.preview }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("결과 배지: 나열 수·안 나옴·우리 브랜드·확인 실패", () => {
    const s = setup({
      onPreview: vi.fn(),
      signals: {
        "크림 추천해줘": { brandsListed: 4, ours: false },
        "토너 뭐가 좋아?": { brandsListed: 0, ours: false },
      },
    });
    s.getByText("브랜드 4개 나열");
    s.getByText("브랜드가 안 나와요");
    cleanup();
    const t = setup({
      onPreview: vi.fn(),
      signals: {
        "크림 추천해줘": { brandsListed: 3, ours: true },
        "토너 뭐가 좋아?": { brandsListed: 0, ours: false, error: true },
      },
    });
    t.getByText("우리 브랜드 나옴");
    t.getByText("확인하지 못했어요");
  });
});
