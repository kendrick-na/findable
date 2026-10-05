import { describe, expect, it } from "vitest";
import {
  isClientReportLocaleNeutralPath,
  isClientReportPagePath,
} from "../lib/client-report-path";

const token = "a".repeat(43);

describe("client report paths in the proxy", () => {
  it("keeps the PDF download out of locale prefixing (prod 404 on 2026-10-05)", () => {
    expect(isClientReportLocaleNeutralPath(`/r/${token}/pdf`)).toBe(true);
    expect(isClientReportLocaleNeutralPath(`/r/${token}`)).toBe(true);
  });

  it("still sends the PDF download through bot protection", () => {
    expect(isClientReportPagePath(`/r/${token}/pdf`)).toBe(false);
    expect(isClientReportPagePath(`/r/${token}`)).toBe(true);
  });

  it("does not exempt other paths under /r", () => {
    expect(isClientReportLocaleNeutralPath(`/r/${token}/other`)).toBe(false);
    expect(isClientReportLocaleNeutralPath("/r/")).toBe(false);
    expect(isClientReportLocaleNeutralPath(`/ko/r/${token}/pdf`)).toBe(false);
  });
});
