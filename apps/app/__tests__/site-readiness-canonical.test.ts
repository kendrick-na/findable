import { describe, expect, test } from "vitest";

import { evaluateCrawledPage } from "@/lib/site-readiness/page-evaluate";

function evaluateCanonical(pageUrl: string, canonicalUrl: string) {
  return evaluateCrawledPage({
    finalUrl: pageUrl,
    html: `<html><head><link rel="canonical" href="${canonicalUrl}"></head><body><h1>Home</h1></body></html>`,
    responseBytes: 100,
    statusCode: 200,
    totalResponseMs: 100,
    ttfbMs: 50,
    url: pageUrl,
  }).canonicalMatches;
}

describe("localized homepage canonical", () => {
  test("accepts a root homepage that declares its English locale page", () => {
    expect(
      evaluateCanonical(
        "https://www.findable.co.kr/",
        "https://www.findable.co.kr/en"
      )
    ).toBe(true);
  });

  test("still catches canonical declarations pointing at another page", () => {
    expect(
      evaluateCanonical(
        "https://www.findable.co.kr/en/insights",
        "https://www.findable.co.kr/en"
      )
    ).toBe(false);
  });

  test("still catches cross-domain canonical declarations", () => {
    expect(
      evaluateCanonical(
        "https://www.findable.co.kr/",
        "https://other.example/en"
      )
    ).toBe(false);
  });
});
