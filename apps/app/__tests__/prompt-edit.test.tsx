/**
 * 추적 질문 수정(RICE#8) — 2026-08-22 신설.
 *
 * 🔬 검증 계약: ①연필 버튼을 누르면 텍스트가 입력창으로 바뀐다 ②3자 미만이면
 *   저장 버튼이 비활성 상태다(서버까지 보내지 않고 클라이언트에서 막음)
 *   ③저장하면 onEdit에 promptId·text를 넘긴다(id 유지 = 시계열 보존의 전제)
 *   ④Escape·취소 버튼으로 편집을 취소할 수 있다 ⑤onEdit이 없으면 연필 버튼이 없다.
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

import { PromptList } from "../app/(authenticated)/prompts/prompt-list";

afterEach(() => {
  cleanup();
});

const PROMPT = {
  id: "prompt-1",
  text: "우리 브랜드 어때?",
  language: "ko",
  category: null,
  measuredCount: 5,
};

describe("추적 질문 수정", () => {
  it("연필 버튼을 누르면 텍스트가 입력창으로 바뀐다", () => {
    render(<PromptList onEdit={vi.fn()} prompts={[PROMPT]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "우리 브랜드 어때? 수정" })
    );
    // getByDisplayValue는 못 찾으면 throw한다 — 통과 자체가 존재 검증이다.
    screen.getByDisplayValue("우리 브랜드 어때?");
  });

  it("3자 미만이면 저장 버튼이 비활성 상태다", () => {
    render(<PromptList onEdit={vi.fn()} prompts={[PROMPT]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "우리 브랜드 어때? 수정" })
    );
    fireEvent.change(screen.getByDisplayValue("우리 브랜드 어때?"), {
      target: { value: "ab" },
    });
    const saveButton = screen.getByRole("button", {
      name: "수정 저장",
    }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it("저장하면 onEdit에 promptId·text를 넘긴다(id 유지)", async () => {
    const onEdit = vi.fn().mockResolvedValue({ ok: true });
    render(<PromptList onEdit={onEdit} prompts={[PROMPT]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "우리 브랜드 어때? 수정" })
    );
    fireEvent.change(screen.getByDisplayValue("우리 브랜드 어때?"), {
      target: { value: "우리 브랜드 진짜 어때?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));

    await waitFor(() => {
      expect(onEdit).toHaveBeenCalledWith({
        promptId: "prompt-1",
        text: "우리 브랜드 진짜 어때?",
      });
    });
  });

  it("측정 기록이 있으면 보존 안내 문구가 뜬다", () => {
    render(<PromptList onEdit={vi.fn()} prompts={[PROMPT]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "우리 브랜드 어때? 수정" })
    );
    screen.getByText(/측정 기록 5건은 그대로 남아요/);
  });

  it("취소 버튼을 누르면 편집이 닫힌다", () => {
    render(<PromptList onEdit={vi.fn()} prompts={[PROMPT]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "우리 브랜드 어때? 수정" })
    );
    fireEvent.click(screen.getByRole("button", { name: "수정 취소" }));
    expect(screen.queryByDisplayValue("우리 브랜드 어때?")).toBeNull();
  });

  it("Escape를 누르면 편집이 닫힌다", () => {
    render(<PromptList onEdit={vi.fn()} prompts={[PROMPT]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "우리 브랜드 어때? 수정" })
    );
    fireEvent.keyDown(screen.getByDisplayValue("우리 브랜드 어때?"), {
      key: "Escape",
    });
    expect(screen.queryByDisplayValue("우리 브랜드 어때?")).toBeNull();
  });

  it("onEdit이 없으면 연필 버튼이 없다", () => {
    render(<PromptList prompts={[PROMPT]} />);
    expect(
      screen.queryByRole("button", { name: "우리 브랜드 어때? 수정" })
    ).toBeNull();
  });
});
