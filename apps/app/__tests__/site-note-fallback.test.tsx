/**
 * "한 줄 소개" 입력 칸 화면(2026-10-14).
 *
 * @vitest-environment jsdom
 */
import koDict from "@repo/internationalization/dictionaries/ko.json";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteNoteBox } from "../app/(authenticated)/features/brand/site-note-box";

afterEach(cleanup);

describe("화면: SiteNoteBox", () => {
  const labels = {
    hint: koDict.app.onboarding.siteNoteHint,
    placeholder: koDict.app.onboarding.siteNotePlaceholder,
    submit: koDict.app.onboarding.siteNoteSubmit,
    title: koDict.app.onboarding.siteNoteTitle,
  };

  it("너무 짧으면 제출할 수 없고, 5자 이상이면 제출 값을 부모에 넘긴다", async () => {
    const onSubmit = vi.fn();
    const screen = render(
      <SiteNoteBox
        busy={false}
        labels={labels}
        onChange={vi.fn()}
        onSubmit={onSubmit}
        value="짧음"
      />
    );
    const button = screen.getByRole("button", {
      name: labels.submit,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    cleanup();
    const ok = render(
      <SiteNoteBox
        busy={false}
        labels={labels}
        onChange={vi.fn()}
        onSubmit={onSubmit}
        value="금융 앱이에요"
      />
    );
    fireEvent.click(ok.getByRole("button", { name: labels.submit }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});
