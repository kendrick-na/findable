import koDict from "@repo/internationalization/dictionaries/ko.json";
/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const assignBrandOwnerMock = vi.fn();
vi.mock("@/app/actions/brand/assign", () => ({
  assignBrandOwner: (input: unknown) => assignBrandOwnerMock(input),
}));
const suggestBrandNameMock = vi.fn();
vi.mock("@/app/actions/brand/suggest-brand-identity", () => ({
  suggestBrandIdentity: (domain: string) => suggestBrandNameMock(domain),
}));
vi.mock("@repo/audit/market-scope", () => ({
  inferMarketScope: ({ domain }: { domain: string }) => ({
    scope: domain.endsWith(".kr") ? "korea" : "both",
    confidence: "low",
    reason: "도메인을 기준으로 제안했어요.",
  }),
}));

import { AssignBrandForm } from "../app/(authenticated)/features/brand/assign-brand-form";

afterEach(() => {
  cleanup();
  suggestBrandNameMock.mockReset();
  assignBrandOwnerMock.mockReset();
});

describe.each([
  "management",
  "onboarding",
] as const)("%s 브랜드 확인", (mode) => {
  it("시장·업종을 확인하기 전에는 측정을 시작하지 못한다", async () => {
    suggestBrandNameMock.mockResolvedValue({ name: "설화수", industry: null });
    const screen = render(
      <AssignBrandForm mode={mode} t={koDict.app.brandForm} />
    );
    const domain = screen.getByLabelText("도메인") as HTMLInputElement;
    fireEvent.change(domain, { target: { value: "sulwhasoo.com" } });
    fireEvent.blur(domain);
    await waitFor(() =>
      expect(
        (screen.getByLabelText("뭐라고 부르나요?") as HTMLInputElement).value
      ).toBe("설화수")
    );
    const submit = screen.getByRole("button", {
      name: "확인하고 측정 시작",
    }) as HTMLButtonElement;
    expect(screen.getByText(/제안이 없거나 맞지 않다면 직접/)).toBeTruthy();
    expect(submit.disabled).toBe(true);
  });

  it("확인 후 도메인을 바꾸면 기존 확인을 취소한다", async () => {
    suggestBrandNameMock.mockResolvedValue({ name: "설화수", industry: null });
    const screen = render(
      <AssignBrandForm
        initialDomain="sulwhasoo.com"
        mode={mode}
        t={koDict.app.brandForm}
      />
    );
    const domain = screen.getByLabelText("도메인") as HTMLInputElement;
    await waitFor(() =>
      expect(
        (screen.getByLabelText("뭐라고 부르나요?") as HTMLInputElement).value
      ).toBe("설화수")
    );
    const confirmation = screen.getByRole("checkbox", {
      name: /브랜드명·타깃 시장·업종을 확인했어요/,
    }) as HTMLInputElement;
    fireEvent.click(confirmation);
    fireEvent.change(domain, { target: { value: "another.kr" } });
    expect(confirmation.checked).toBe(false);
  });

  it("업종을 고르고 세 값을 확인하면 측정 버튼이 활성화된다", async () => {
    suggestBrandNameMock.mockResolvedValue({ name: "설화수", industry: null });
    const screen = render(
      <AssignBrandForm
        initialDomain="sulwhasoo.com"
        mode={mode}
        t={koDict.app.brandForm}
      />
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("뭐라고 부르나요?") as HTMLInputElement).value
      ).toBe("설화수")
    );
    const submit = screen.getByRole("button", {
      name: "확인하고 측정 시작",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "업종" }), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("option", { name: "뷰티·화장품" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /브랜드명·타깃 시장·업종을 확인했어요/,
      })
    );
    expect(submit.disabled).toBe(false);
  });

  it("확인된 업종 제안도 자동 제출하지 않고 사용자 확인을 기다린다", async () => {
    suggestBrandNameMock.mockResolvedValue({
      name: "설화수",
      industry: "beauty",
    });
    const screen = render(
      <AssignBrandForm
        initialDomain="sulwhasoo.com"
        mode={mode}
        t={koDict.app.brandForm}
      />
    );
    const industry = screen.getByRole("combobox", { name: "업종" });
    await waitFor(() => expect(industry.textContent).toContain("뷰티·화장품"));
    const submit = screen.getByRole("button", {
      name: "확인하고 측정 시작",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /브랜드명·타깃 시장·업종을 확인했어요/,
      })
    );
    expect(submit.disabled).toBe(false);
  });

  it("확정된 세 값만 등록 액션에 넘긴다", async () => {
    suggestBrandNameMock.mockResolvedValue({
      name: "설화수",
      industry: "beauty",
    });
    assignBrandOwnerMock.mockResolvedValue({ error: "검증용 중단" });
    const screen = render(
      <AssignBrandForm
        initialDomain="sulwhasoo.com"
        mode={mode}
        t={koDict.app.brandForm}
      />
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("뭐라고 부르나요?") as HTMLInputElement).value
      ).toBe("설화수")
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /브랜드명·타깃 시장·업종을 확인했어요/,
      })
    );
    fireEvent.submit(screen.container.querySelector("form") as HTMLFormElement);
    await waitFor(() =>
      expect(assignBrandOwnerMock).toHaveBeenCalledWith({
        name: "설화수",
        domain: "sulwhasoo.com",
        industry: "beauty",
        marketScope: "both",
        source: mode === "onboarding" ? "onboarding" : "brand_create",
      })
    );
  });

  it("이전 도메인의 늦은 제안으로 현재 도메인의 이름·업종을 덮지 않는다", async () => {
    let resolveFirst!: (value: { name: string; industry: string }) => void;
    suggestBrandNameMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce({ name: "현재브랜드", industry: "education" });
    const screen = render(
      <AssignBrandForm mode={mode} t={koDict.app.brandForm} />
    );
    const domain = screen.getByLabelText("도메인") as HTMLInputElement;
    fireEvent.change(domain, { target: { value: "old.example" } });
    fireEvent.blur(domain);
    await waitFor(() => expect(suggestBrandNameMock).toHaveBeenCalledTimes(1));
    fireEvent.change(domain, { target: { value: "current.kr" } });
    fireEvent.blur(domain);
    await waitFor(() =>
      expect(
        (screen.getByLabelText("뭐라고 부르나요?") as HTMLInputElement).value
      ).toBe("현재브랜드")
    );
    resolveFirst({ name: "오래된브랜드", industry: "beauty" });
    await waitFor(() =>
      expect(
        (screen.getByLabelText("뭐라고 부르나요?") as HTMLInputElement).value
      ).toBe("현재브랜드")
    );
    expect(
      screen.getByRole("combobox", { name: "업종" }).textContent
    ).toContain("교육");
  });
});
