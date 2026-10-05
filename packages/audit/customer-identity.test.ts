import { describe, expect, it } from "vitest";
import {
  mergeCustomerIdentity,
  normalizeCustomerBusinessNumber,
  normalizeCustomerLegalName,
  type OfficialSiteIdentity,
} from "./official-site-identity";

// toss.im as production read it on 2026-10-05: slogan homepage, empty footer.
const tossSite: OfficialSiteIdentity = {
  businessNumber: null,
  description: "금융부터 일상까지 마침내 토스 하나로.",
  finalUrl: "https://toss.im/",
  h1: null,
  legalName: null,
  siteName: "토스",
  title: "토스",
};

describe("customer-entered official identity", () => {
  it("normalizes customer input and keeps company suffixes verbatim", () => {
    expect(normalizeCustomerLegalName("  ㈜비바리퍼블리카 ")).toBe(
      "㈜비바리퍼블리카"
    );
    expect(normalizeCustomerLegalName("주식회사 비바리퍼블리카")).toBe(
      "주식회사 비바리퍼블리카"
    );
    expect(normalizeCustomerLegalName("가")).toBeNull();
    expect(normalizeCustomerLegalName("가".repeat(61))).toBeNull();
    expect(normalizeCustomerBusinessNumber("1208800767")).toBe("120-88-00767");
    expect(normalizeCustomerBusinessNumber("120 88 00767")).toBe(
      "120-88-00767"
    );
    expect(normalizeCustomerBusinessNumber("12-34")).toBeNull();
  });

  it("prefers customer input over the footer, field by field", () => {
    const footer = {
      ...tossSite,
      legalName: "푸터상호(주)",
      businessNumber: "111-11-11111",
    };
    expect(
      mergeCustomerIdentity(footer, { legalName: "비바리퍼블리카" })
    ).toEqual({ ...footer, legalName: "비바리퍼블리카" });
    expect(
      mergeCustomerIdentity(footer, { businessNumber: "1208800767" })
    ).toEqual({ ...footer, businessNumber: "120-88-00767" });
    // Invalid customer values never erase a footer value.
    expect(
      mergeCustomerIdentity(footer, { legalName: " ", businessNumber: "x" })
    ).toBe(footer);
  });

  it("returns the site unchanged when both sources are missing", () => {
    expect(mergeCustomerIdentity(tossSite, undefined)).toBe(tossSite);
    expect(
      mergeCustomerIdentity(tossSite, { legalName: null, businessNumber: null })
    ).toBe(tossSite);
  });
});
