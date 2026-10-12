import koDict from "@repo/internationalization/dictionaries/ko.json";
/**
 * 추적 질문 「직접 추가」 — 2026-08-22 신설.
 *
 * 🔬 검증 계약: ①idle 상태에 "직접 추가" 버튼이 AI 제안 버튼과 나란히 있다
 *   ②눌러야 입력창이 뜬다(안 눌렀으면 없음) ③3자 미만이면 저장 액션을 호출하지
 *   않는다(서버까지 보내지 않고 클라이언트에서 막음) ④정상 텍스트면
 *   saveApprovedPromptsAction에 topic:"custom"으로 넘긴다.
 *
 * @vitest-environment jsdom
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const saveApprovedPromptsActionMock = vi.fn();
const suggestPromptsActionMock = vi.fn();
vi.mock("@/app/actions/brand/suggest-prompts", () => ({
  suggestPromptsAction: (input: unknown) => suggestPromptsActionMock(input),
  saveApprovedPromptsAction: (input: unknown) =>
    saveApprovedPromptsActionMock(input),
}));

import { PromptWizard } from "../app/(authenticated)/features/brand/prompt-wizard";

afterEach(() => {
  cleanup();
  saveApprovedPromptsActionMock.mockReset();
  suggestPromptsActionMock.mockReset();
});

describe("추적 질문 직접 추가", () => {
  it("idle 상태에 AI 제안 버튼과 직접 추가 버튼이 나란히 있다", () => {
    render(
      <PromptWizard
        brandId="brand-1"
        pickerLabels={koDict.app.questionPicker}
        t={koDict.app.promptWizard}
      />
    );
    // getByRole은 못 찾으면 throw한다 — 통과 자체가 존재 검증이다.
    screen.getByRole("button", { name: "AI 추적 질문 제안받기" });
    screen.getByRole("button", { name: "직접 추가" });
    // 아직 안 눌렀으면 입력창은 없다.
    expect(screen.queryByPlaceholderText("예: 우리 브랜드 어때?")).toBeNull();
  });

  it("직접 추가를 누르면 입력창이 뜬다", () => {
    render(
      <PromptWizard
        brandId="brand-1"
        pickerLabels={koDict.app.questionPicker}
        t={koDict.app.promptWizard}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "직접 추가" }));
    screen.getByPlaceholderText("예: 우리 브랜드 어때?");
  });

  it("3자 미만이면 서버 액션을 호출하지 않는다", () => {
    render(
      <PromptWizard
        brandId="brand-1"
        pickerLabels={koDict.app.questionPicker}
        t={koDict.app.promptWizard}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "직접 추가" }));
    fireEvent.change(screen.getByPlaceholderText("예: 우리 브랜드 어때?"), {
      target: { value: "ab" },
    });
    fireEvent.click(screen.getByRole("button", { name: "추가하기" }));
    expect(saveApprovedPromptsActionMock).not.toHaveBeenCalled();
  });

  it("정상 텍스트면 topic:custom·category:brand로 저장 액션을 호출한다", async () => {
    saveApprovedPromptsActionMock.mockResolvedValue({ ok: true, saved: 1 });
    render(
      <PromptWizard
        brandId="brand-1"
        pickerLabels={koDict.app.questionPicker}
        t={koDict.app.promptWizard}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "직접 추가" }));
    fireEvent.change(screen.getByPlaceholderText("예: 우리 브랜드 어때?"), {
      target: { value: "우리 브랜드 어때?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "추가하기" }));

    await waitFor(() => {
      expect(saveApprovedPromptsActionMock).toHaveBeenCalledWith({
        brandId: "brand-1",
        prompts: [
          {
            text: "우리 브랜드 어때?",
            language: "ko",
            category: "brand",
            topic: "custom",
          },
        ],
      });
    });
  });

  it("한글이 없으면 language:en으로 넘긴다", async () => {
    saveApprovedPromptsActionMock.mockResolvedValue({ ok: true, saved: 1 });
    render(
      <PromptWizard
        brandId="brand-1"
        pickerLabels={koDict.app.questionPicker}
        t={koDict.app.promptWizard}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "직접 추가" }));
    fireEvent.change(screen.getByPlaceholderText("예: 우리 브랜드 어때?"), {
      target: { value: "Is our brand good?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "추가하기" }));

    await waitFor(() => {
      expect(saveApprovedPromptsActionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompts: [expect.objectContaining({ language: "en" })],
        })
      );
    });
  });
});

describe("AI 제안 승인 — 사람이 고른 것만 저장한다 (2026-10-13)", () => {
  const prompt = (
    type: string,
    text: string,
    category: "brand" | "competitor" = "competitor"
  ) => ({ category, language: "ko", text, topic: "recommendation", type });
  const suggestions = {
    competitors: [],
    prompts: [
      prompt("category", "민감성 피부 크림 추천해줘"),
      prompt("category", "수분 크림 뭐가 좋아?"),
      prompt("concern", "환절기에 피부가 당기면 어떻게 해?"),
      prompt("brand", "프란츠 후기 어때?", "brand"),
    ],
  };

  const open = async (remaining = 3) => {
    suggestPromptsActionMock.mockResolvedValue({
      ok: true,
      remaining,
      suggestions,
    });
    render(
      <PromptWizard
        brandId="brand-1"
        pickerLabels={koDict.app.questionPicker}
        t={koDict.app.promptWizard}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "AI 추적 질문 제안받기" })
    );
    await screen.findByText("추천 구성으로 담기");
  };

  it("제안을 받아도 아무것도 선택돼 있지 않다(기본 미선택)", async () => {
    await open();
    expect(screen.getByText("0개 선택 · 최대 3개")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: /선택한 질문 저장/,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("[추천 구성으로 담기]는 플랜 남은 칸 안에서 유형을 번갈아 고른다", async () => {
    await open(3);
    fireEvent.click(screen.getByRole("button", { name: "추천 구성으로 담기" }));
    expect(screen.getByText("3개 선택 · 최대 3개")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /선택한 질문 저장/ }));
    await waitFor(() =>
      expect(saveApprovedPromptsActionMock).toHaveBeenCalled()
    );
    const saved = saveApprovedPromptsActionMock.mock.calls[0]?.[0].prompts;
    expect(saved).toHaveLength(3);
    // 구매 → 고민 → 브랜드 이해 순으로 번갈아(구매 2개째는 상한 때문에 빠진다)
    expect(saved.map((p: { type: string }) => p.type).sort()).toEqual(
      ["brand", "category", "concern"].sort()
    );
  });

  it("문구를 고쳐서 담으면 고친 문구로 저장한다", async () => {
    saveApprovedPromptsActionMock.mockResolvedValue({ ok: true, saved: 1 });
    await open(5);
    const inputs = screen.getAllByLabelText("질문 문구 수정");
    fireEvent.change(inputs[0] as HTMLElement, {
      target: { value: "  민감성 피부 보습 크림 추천해줘  " },
    });
    fireEvent.click(screen.getAllByRole("checkbox")[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: /선택한 질문 저장/ }));
    await waitFor(() =>
      expect(saveApprovedPromptsActionMock).toHaveBeenCalled()
    );
    expect(saveApprovedPromptsActionMock.mock.calls[0]?.[0].prompts).toEqual([
      expect.objectContaining({ text: "민감성 피부 보습 크림 추천해줘" }),
    ]);
  });

  it("남은 칸을 넘겨 담을 수 없다", async () => {
    await open(1);
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0] as HTMLElement);
    expect(
      (boxes[1] as HTMLInputElement).getAttribute("data-disabled")
    ).not.toBeNull();
  });
});
