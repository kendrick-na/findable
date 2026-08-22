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
vi.mock("@/app/actions/brand/suggest-prompts", () => ({
  suggestPromptsAction: vi.fn(),
  saveApprovedPromptsAction: (input: unknown) =>
    saveApprovedPromptsActionMock(input),
}));

import { PromptWizard } from "../app/(authenticated)/features/brand/prompt-wizard";

afterEach(() => {
  cleanup();
  saveApprovedPromptsActionMock.mockReset();
});

describe("추적 질문 직접 추가", () => {
  it("idle 상태에 AI 제안 버튼과 직접 추가 버튼이 나란히 있다", () => {
    render(<PromptWizard brandId="brand-1" />);
    // getByRole은 못 찾으면 throw한다 — 통과 자체가 존재 검증이다.
    screen.getByRole("button", { name: "AI 추적 질문 제안받기" });
    screen.getByRole("button", { name: "직접 추가" });
    // 아직 안 눌렀으면 입력창은 없다.
    expect(screen.queryByPlaceholderText("예: 우리 브랜드 어때?")).toBeNull();
  });

  it("직접 추가를 누르면 입력창이 뜬다", () => {
    render(<PromptWizard brandId="brand-1" />);
    fireEvent.click(screen.getByRole("button", { name: "직접 추가" }));
    screen.getByPlaceholderText("예: 우리 브랜드 어때?");
  });

  it("3자 미만이면 서버 액션을 호출하지 않는다", () => {
    render(<PromptWizard brandId="brand-1" />);
    fireEvent.click(screen.getByRole("button", { name: "직접 추가" }));
    fireEvent.change(screen.getByPlaceholderText("예: 우리 브랜드 어때?"), {
      target: { value: "ab" },
    });
    fireEvent.click(screen.getByRole("button", { name: "추가하기" }));
    expect(saveApprovedPromptsActionMock).not.toHaveBeenCalled();
  });

  it("정상 텍스트면 topic:custom·category:brand로 저장 액션을 호출한다", async () => {
    saveApprovedPromptsActionMock.mockResolvedValue({ ok: true, saved: 1 });
    render(<PromptWizard brandId="brand-1" />);
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
    render(<PromptWizard brandId="brand-1" />);
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
