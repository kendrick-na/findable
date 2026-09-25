import { generateObject } from "ai";
import { afterEach, expect, it, vi } from "vitest";
import { __internal, verifyMention } from "./mention-verdict";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(generateObject).mockReset();
});

it("does not mistake an official subdomain for a namesake", () => {
  expect(
    __internal.isOfficialDomain("product.example.com", "example.com")
  ).toBe(true);
  expect(__internal.isOfficialDomain("com", "example.com")).toBe(false);
  expect(
    __internal.mentionsOfficialDomain(
      "https://example.com.evil.test",
      "example.com"
    )
  ).toBe(false);
  expect(__internal.isOfficialDomain("co.uk", "product.example.co.uk")).toBe(
    false
  );
  expect(__internal.isOfficialDomain("github.io", "customer.github.io")).toBe(
    false
  );
  expect(
    __internal.isOfficialDomain("other.github.io", "customer.github.io")
  ).toBe(false);
});

it("rejects a namesake company supported only by its own domain", async () => {
  expect(
    await verifyMention({
      brandName: "TechDD",
      brandDomain: "dd.knowverse.net",
      stringMatched: true,
      text: "TechDD offers 2–3 week due diligence and board advisory services.",
      citedDomains: ["techdd.co.uk", "www.linkedin.com"],
      officialSite: { title: "TechDD", description: "폐쇄망 정량 기술실사" },
    })
  ).toMatchObject({ counted: false, quality: "different_entity" });
  expect(generateObject).not.toHaveBeenCalled();
});

it("sends mixed official/namesake sources to the verifier instead of vetoing a correct answer", async () => {
  vi.stubEnv("LETSUR_API_KEY", "test-key");
  vi.mocked(generateObject).mockResolvedValue({
    object: { quality: "confirmed" },
  } as never);
  expect(
    await verifyMention({
      brandName: "TechDD",
      brandDomain: "dd.knowverse.net",
      stringMatched: true,
      officialSite: { title: "TechDD", description: "정량 기술 실사" },
      citedDomains: ["knowverse.net", "techdd.co.uk"],
      text: "노우버스(KNOWVERSE)의 TechDD는 AI 기술실사와 TechScan을 제공합니다.",
    })
  ).toMatchObject({ counted: true, quality: "confirmed", via: "llm" });
  expect(generateObject).toHaveBeenCalledOnce();
});

it("cannot turn absence of identity evidence into a verified negative", async () => {
  vi.stubEnv("LETSUR_API_KEY", "test-key");
  vi.mocked(generateObject).mockResolvedValue({
    object: { quality: "confirmed" },
  } as never);
  expect(
    await verifyMention({
      brandName: "TechDD",
      brandDomain: "dd.knowverse.net",
      stringMatched: true,
      officialSite: { title: "TechDD", description: "정량 기술 실사" },
      text: "TechDD는 클라우드 인프라 구축과 시스템 통합 서비스를 제공합니다.",
    })
  ).toMatchObject({ counted: false, quality: "unverified" });
});

it("does not use an incidental official search candidate to validate a foreign namesake", async () => {
  vi.stubEnv("LETSUR_API_KEY", "test-key");
  vi.mocked(generateObject).mockResolvedValue({
    object: { quality: "confirmed" },
  } as never);
  expect(
    await verifyMention({
      brandName: "TechDD",
      brandDomain: "dd.knowverse.net",
      stringMatched: true,
      officialSite: { title: "TechDD", description: "정량 기술 실사" },
      citedDomains: ["techdd.co.uk", "dd.knowverse.net"],
      text: "TechDD offers independent technology due diligence, board-level advisory and reports in 2–3 weeks.[1]",
    })
  ).toMatchObject({ counted: false, quality: "unverified" });
});
