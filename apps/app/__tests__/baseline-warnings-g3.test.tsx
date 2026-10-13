import koDict from "@repo/internationalization/dictionaries/ko.json";
/**
 * 「다음 측정부터 새 기준선」 경고 (2026-10-14 · G3).
 *
 * 🔴 계약: 질문을 고치거나 지우거나 더하기 **전에**, 그리고 저장된 타깃 시장을 바꾸기 **전에** 그 결과를 알린다.
 *   질문 세트 지문(+qs:)·시장(+m:)이 비교 키에 들어가므로 바꾸면 직전 대비·추세 비교가 막힌다.
 *
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/actions/brand/suggest-prompts", () => ({
  saveApprovedPromptsAction: vi.fn(),
  suggestPromptsAction: vi.fn(),
}));

import { BrandProfileEditor } from "../app/(authenticated)/features/brand/brand-profile-editor";
import { PromptList } from "../app/(authenticated)/prompts/prompt-list";

afterEach(() => cleanup());

const BASELINE_KO = koDict.app.promptList.baselineChange;
const t = koDict.app.promptList;
const item = {
  category: "recommendation",
  id: "p1",
  language: "ko",
  measuredCount: 4,
  text: "수분 크림 추천해줘",
};

describe("문구", () => {
  it("ko·en 모두 있고, 다음 측정부터 새 기준선이라는 사실을 말한다", () => {
    expect(BASELINE_KO).toContain("새 기준선");
    expect(koDict.app.onboarding.editorMarketBaseline).toContain("새 기준선");
    expect(koDict.app.promptWizard.baselineChange).toContain("새 기준선");
  });
});

describe("질문 목록 — 고치기·지우기 전에 알린다", () => {
  const list = () =>
    render(
      <PromptList
        onDelete={() => Promise.resolve({ ok: true, deletedTrackings: 0 })}
        onEdit={() => Promise.resolve({ ok: true })}
        prompts={[item]}
        t={t}
      />
    );

  it("고치는 중에 새 기준선 경고가 보인다", () => {
    list();
    expect(screen.queryByText(BASELINE_KO)).toBeNull();
    fireEvent.click(
      screen.getByLabelText(t.editLabel.replace("{text}", item.text))
    );
    expect(screen.getByText(BASELINE_KO)).toBeTruthy();
  });

  it("지우기 확인 문구에 이력 소실과 새 기준선이 함께 보인다", () => {
    list();
    fireEvent.click(
      screen.getByLabelText(t.deleteLabel.replace("{text}", item.text))
    );
    const confirm = screen.getByText(/측정 기록 4건도 함께 사라져요/);
    expect(confirm.textContent).toContain(BASELINE_KO);
  });
});

describe("프로필 편집기 — 저장된 시장을 바꾸면 알린다", () => {
  const editor = () =>
    render(
      <BrandProfileEditor
        brandId="b1"
        businessNumber={null}
        competitors={[]}
        entityVariants={[]}
        industry="beauty"
        legalName={null}
        marketScope="korea"
        name="프란츠"
        noCompetitors={false}
        onSave={() => Promise.resolve({ ok: true })}
        suggestedBusinessNumber={null}
        t={koDict.app.onboarding as Record<string, string>}
      />
    );
  const marketNote = koDict.app.onboarding.editorMarketBaseline;

  it("시장을 바꾸면 경고가 뜨고, 원래대로 돌리면 사라진다", () => {
    editor();
    const select = screen
      .getAllByRole("combobox")
      .find((el) =>
        Array.from((el as HTMLSelectElement).options).some(
          (o) => o.value === "global"
        )
      ) as HTMLSelectElement;
    expect(screen.queryByText(marketNote)).toBeNull();
    fireEvent.change(select, { target: { value: "global" } });
    expect(screen.getByText(marketNote)).toBeTruthy();
    fireEvent.change(select, { target: { value: "korea" } });
    expect(screen.queryByText(marketNote)).toBeNull();
  });
});

describe("마법사 — 저장 전에 알린다", () => {
  it("소스에 검토·직접 추가 양쪽의 경고가 있다", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(
        process.cwd(),
        "app/(authenticated)/features/brand/prompt-wizard.tsx"
      ),
      "utf8"
    );
    expect(src.match(/t\.baselineChange/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
