import { generateObject } from "ai";
import { afterEach, expect, it, vi } from "vitest";

import { verifyMention } from "./mention-verdict";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(generateObject).mockReset();
});

// toss.im as production read it on 2026-10-05: slogan homepage, empty footer.
const tossSite = {
  businessNumber: null,
  description: "금융부터 일상까지 마침내 토스 하나로.",
  finalUrl: "https://toss.im/",
  h1: null,
  legalName: null,
  siteName: "토스",
  title: "토스",
};
const answer = {
  brandName: "토스",
  brandDomain: "toss.im",
  stringMatched: true,
  text: "토스는 비바리퍼블리카가 운영하는 간편송금 서비스입니다. 운영사는 비바리퍼블리카입니다.",
};

it("confirms a toss answer anchored only by the customer-entered legal name", async () => {
  vi.stubEnv("LETSUR_API_KEY", "test-key");
  vi.mocked(generateObject).mockResolvedValue({
    object: { quality: "confirmed" },
  } as never);

  // Empty footer: the slogan homepage alone cannot back the judge's confirmed.
  expect(
    await verifyMention({ ...answer, officialSite: tossSite })
  ).toMatchObject({ counted: false, quality: "unknown_brand" });

  // packages/audit mergeCustomerIdentity output for legalName "㈜비바리퍼블리카":
  // the suffix stays verbatim and the existing anchor strips it.
  expect(
    await verifyMention({
      ...answer,
      officialSite: { ...tossSite, legalName: "㈜비바리퍼블리카" },
    })
  ).toMatchObject({ counted: true, quality: "confirmed" });
});
