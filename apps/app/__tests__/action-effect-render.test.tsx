/**
 * @vitest-environment jsdom
 * 완료 당시 값과 현재 값의 차이는 실행 효과가 아니다. 고객 카드 렌더 계약.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ActionItem,
  ActionList,
} from "../app/(authenticated)/features/analysis/action-list";

vi.mock("@/app/actions/brand/complete-action", () => ({
  toggleActionCompletion: vi.fn(),
  toggleActionCompletionByDomain: vi.fn(),
}));

const completed: ActionItem = {
  completed: true,
  completedSov: 20,
  evidence: "관찰된 문제입니다.",
  how: "수정한 뒤 재측정합니다.",
  kind: "prompt_gap",
  priority: 2,
  target: "example.com/page",
  title: "페이지 점검",
};

describe("완료 카드의 효과 수치 차단", () => {
  afterEach(cleanup);

  it("과거 20→현재 60이어도 완료 후 +40%p 효과를 표시하지 않는다", () => {
    const { container } = render(
      <ActionList
        actions={[completed]}
        currentSov={60}
        target={{ kind: "tracked", brandId: "brand-1" }}
      />
    );
    expect(screen.getByRole("button", { name: "완료됨" })).toBeTruthy();
    expect(container.textContent).not.toContain("%p");
    expect(container.textContent).not.toContain("완료 후");
  });
});
