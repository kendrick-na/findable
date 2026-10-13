/**
 * 경쟁사 후보 사후 제안 (G4a · 2026-10-14) — 제안일 뿐, 기본 미선택, 눌러서 담고 저장해야 반영.
 *
 * @vitest-environment jsdom
 */
import koDict from "@repo/internationalization/dictionaries/ko.json";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandProfileEditor } from "../app/(authenticated)/features/brand/brand-profile-editor";

afterEach(cleanup);

const setup = (competitors: string[] = []) => {
  const onSave = vi.fn().mockResolvedValue({ ok: true });
  const screen = render(
    <BrandProfileEditor
      brandId="b1"
      businessNumber={null}
      candidates={[
        { name: "라운드랩", mentions: 4 },
        { name: "토리든", mentions: 2 },
      ]}
      competitors={competitors}
      entityVariants={[]}
      industry="beauty"
      legalName={null}
      marketScope="korea"
      name="프란츠"
      noCompetitors={false}
      onSave={onSave}
      suggestedBusinessNumber={null}
      t={koDict.app.onboarding}
    />
  );
  return { onSave, screen };
};

describe("경쟁사 후보 칩", () => {
  it("후보는 보이지만 아무것도 자동으로 담기지 않는다", () => {
    const { onSave, screen } = setup();
    expect(screen.getByText("+라운드랩")).toBeTruthy();
    expect(screen.getByText("+토리든")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("눌러야 목록에 담기고, 저장해야 서버로 간다", async () => {
    const { onSave, screen } = setup();
    fireEvent.click(screen.getByText("+라운드랩"));
    expect(screen.queryByText("+라운드랩")).toBeNull(); // 담긴 후보는 칩에서 빠진다
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      competitors: ["라운드랩"],
      noCompetitors: false,
    });
  });

  it("이미 등록한 경쟁사는 후보로 다시 보이지 않는다", () => {
    const { screen } = setup(["라운드랩"]);
    expect(screen.queryByText("+라운드랩")).toBeNull();
    expect(screen.getByText("+토리든")).toBeTruthy();
  });
});
