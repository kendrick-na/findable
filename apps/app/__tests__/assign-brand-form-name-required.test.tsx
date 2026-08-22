/**
 * 온보딩 1단계 — 브랜드 이름 필수화 회귀 테스트 (2026-08-21 10번 · 👤 결정).
 *
 * 🔴 **막는 사고**: 이름을 비우면 도메인이 그대로 이름이 됐고, 그 값이 첫 측정
 *   프롬프트에 영구 반영됐다 — "sulwhasoo.com 추천해줘" 같은 도메인 문자열 질의가
 *   나갔다(N-49 실측). 이 파일은 그 회귀를 렌더 레벨에서 막는다.
 *
 * 🔬 검증 계약: ①이름 칸이 required ②도메인 blur 시 정적 사전 매칭이면 자동 채움
 *   ③사용자가 이미 고친 이름은 자동 채움이 덮지 않음 ④사전에 없으면 채우지 않음
 *   (LLM 자동추정은 이번 범위 밖 — 👤 "직접 채우게 하자" 결정).
 *
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/actions/brand/assign", () => ({
  assignBrandOwner: vi.fn(),
}));

const suggestBrandNameMock = vi.fn();
vi.mock("@/app/actions/brand/suggest-brand-name", () => ({
  suggestBrandName: (domain: string) => suggestBrandNameMock(domain),
}));

// `inferMarketScope`는 이 테스트의 관심사가 아니다 — 감지 패널 렌더만 막지 않게 최소 반환.
vi.mock("@repo/audit/market-scope", () => ({
  inferMarketScope: () => ({
    scope: "both",
    confidence: "high",
    reason: "테스트 감지",
  }),
}));

import { AssignBrandForm } from "../app/(authenticated)/features/brand/assign-brand-form";

afterEach(() => {
  cleanup();
  suggestBrandNameMock.mockReset();
});

describe("브랜드 이름 칸 — 필수화 + 정적 사전 자동 채움", () => {
  it("이름 칸이 required 다", () => {
    const { getByLabelText } = render(<AssignBrandForm />);
    const nameInput = getByLabelText("뭐라고 부르나요?") as HTMLInputElement;
    expect(nameInput.required).toBe(true);
  });

  it("도메인 blur 시 정적 사전에 있으면 이름을 자동으로 채운다", async () => {
    suggestBrandNameMock.mockResolvedValue("설화수");
    const { getByLabelText } = render(<AssignBrandForm />);
    const domainInput = getByLabelText("도메인") as HTMLInputElement;
    const nameInput = getByLabelText("뭐라고 부르나요?") as HTMLInputElement;

    fireEvent.change(domainInput, { target: { value: "sulwhasoo.com" } });
    fireEvent.blur(domainInput);

    await waitFor(() => expect(nameInput.value).toBe("설화수"));
  });

  it("사전에 없으면 채우지 않는다 (롱테일 브랜드는 직접 입력)", async () => {
    suggestBrandNameMock.mockResolvedValue(null);
    const { getByLabelText } = render(<AssignBrandForm />);
    const domainInput = getByLabelText("도메인") as HTMLInputElement;
    const nameInput = getByLabelText("뭐라고 부르나요?") as HTMLInputElement;

    fireEvent.change(domainInput, { target: { value: "example.com" } });
    fireEvent.blur(domainInput);

    await waitFor(() => expect(suggestBrandNameMock).toHaveBeenCalled());
    expect(nameInput.value).toBe("");
  });

  it("🔴 사용자가 이미 고친 이름은 자동 채움이 덮지 않는다", async () => {
    suggestBrandNameMock.mockResolvedValue("설화수");
    const { getByLabelText } = render(<AssignBrandForm />);
    const domainInput = getByLabelText("도메인") as HTMLInputElement;
    const nameInput = getByLabelText("뭐라고 부르나요?") as HTMLInputElement;

    fireEvent.change(nameInput, { target: { value: "직접입력한이름" } });
    fireEvent.change(domainInput, { target: { value: "sulwhasoo.com" } });
    fireEvent.blur(domainInput);

    // 사전 매칭이 오더라도 이미 손댄 값을 덮지 않는다.
    await new Promise((r) => setTimeout(r, 0));
    expect(nameInput.value).toBe("직접입력한이름");
  });
});
