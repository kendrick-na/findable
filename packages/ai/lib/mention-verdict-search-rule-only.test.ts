// 네이버·다음 검색 API 결과는 어떤 AI 에도 넣지 않는다(2026-10-07 대표 결정 · 검색 약관).
import { generateObject } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { letsurModelWithFallback } from "./letsur-fallback";
import { verifyMentions, verifySearchRowByRules } from "./mention-verdict";
import {
  isVerdictV3ShadowEnabled,
  verifyMentionV3,
} from "./mention-verdict-v3";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./letsur-fallback", () => ({
  HELPER_GATEWAY_MODEL_ID: "test/model",
  letsurModelWithFallback: vi.fn(() => ({ modelId: "letsur-test" })),
}));
vi.mock("./mention-verdict-v3", () => ({
  isVerdictV3ShadowEnabled: vi.fn(() => true),
  verifyMentionV3: vi.fn(() =>
    Promise.resolve({ counted: true, quality: "confirmed", via: "llm" })
  ),
}));

const brand = {
  brandName: "인디고차일드",
  brandDomain: "indigochild.kr",
  officialSite: {
    title: "인디고차일드 | AI 에이전시",
    description: "AI 도입 컨설팅과 GEO 진단",
    legalName: "주식회사 나현에이아이랩",
    businessNumber: "123-45-67890",
  },
};

const searchRow = (
  engineId: string,
  rawResponse: string,
  urls: string[] = []
) => ({
  engineId,
  brandMentioned: true,
  errorMessage: null,
  rawResponse,
  citedSources: urls.map((url) => ({ url, domain: new URL(url).hostname })),
});

afterEach(() => {
  vi.mocked(generateObject).mockReset();
  vi.mocked(letsurModelWithFallback).mockClear();
  vi.mocked(verifyMentionV3).mockClear();
  vi.mocked(isVerdictV3ShadowEnabled).mockReturnValue(true);
});

describe("search rows (naver/daum) are judged by rules only", () => {
  it("never calls the LLM judge, LETSUR/gateway or the v3 shadow for naver/daum rows", async () => {
    const rows = [
      searchRow(
        "naver",
        "[1] 인디고차일드 후기\n좋아요\n출처: https://blog.example.com/a"
      ),
      searchRow(
        "daum",
        "[1] 인디고차일드 소개\n출처: https://cafe.example.com/b"
      ),
      searchRow(
        "naver",
        "[1] 인디고차일드 공식\n출처: https://www.indigochild.kr/",
        ["https://www.indigochild.kr/"]
      ),
      searchRow("daum", "검색 결과에 브랜드 이름 없음"),
    ];

    const out = await verifyMentions(rows, brand);

    expect(generateObject).toHaveBeenCalledTimes(0);
    expect(letsurModelWithFallback).toHaveBeenCalledTimes(0);
    expect(verifyMentionV3).toHaveBeenCalledTimes(0);
    expect(out.some((r) => "verdictV3" in r)).toBe(false);
    expect(out.every((r) => r.verdictVia === "rules_search_terms")).toBe(true);
    expect(out.map((r) => r.mentionQuality)).toEqual([
      "unverified",
      "unverified",
      "confirmed",
      "absent",
    ]);
    expect(out[0]?.verdictReason).toBe("search_rule_inconclusive");
    expect(out[0]?.brandMentioned).toBe(false);
    expect(out[2]?.brandMentioned).toBe(true);
  });

  it("confirms a row whose result link is the official domain (or a subdomain)", () => {
    const verdict = verifySearchRowByRules({
      ...brand,
      text: "[1] 인디고차일드 블로그\n출처: https://blog.indigochild.kr/post/1",
      citedDomains: ["blog.indigochild.kr"],
      stringMatched: true,
    });
    expect(verdict).toEqual({
      counted: true,
      quality: "confirmed",
      via: "rules_search_terms",
    });
  });

  it("confirms on the registered legal name or business number anchor", () => {
    for (const text of [
      "[1] 인디고차일드 — 나현에이아이랩 운영\n출처: https://news.example.com/1",
      "[1] 인디고차일드 사업자 123-45-67890\n출처: https://news.example.com/2",
    ]) {
      expect(
        verifySearchRowByRules({ ...brand, text, stringMatched: true }).quality
      ).toBe("confirmed");
    }
  });

  it("keeps an ambiguous row (name only, no anchor) as the rule outcome: unverified, not invented", () => {
    const verdict = verifySearchRowByRules({
      ...brand,
      text: "[1] 인디고차일드 영어학원 원생 모집\n출처: https://blog.example.com/x",
      citedDomains: ["blog.example.com"],
      stringMatched: true,
    });
    expect(verdict).toEqual({
      counted: false,
      quality: "unverified",
      via: "rules_search_terms",
      reason: "search_rule_inconclusive",
    });
  });

  it("keeps the existing conflicting-domain rule (different_entity)", () => {
    const verdict = verifySearchRowByRules({
      brandName: "Findable",
      brandDomain: "findable.co.kr",
      text: "[1] Findable app\n출처: https://findableapp.com/",
      citedDomains: ["findableapp.com"],
      stringMatched: true,
    });
    expect(verdict.quality).toBe("different_entity");
    expect(verdict.counted).toBe(false);
  });

  it("leaves AI engine rows on the existing LLM path (judge + shadow still run)", async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: { quality: "unknown_brand" },
    } as never);
    const out = await verifyMentions(
      [
        {
          engineId: "chatgpt",
          brandMentioned: true,
          errorMessage: null,
          rawResponse: "인디고차일드는 잘 모르겠습니다.",
          citedSources: [],
        },
      ],
      brand
    );
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(verifyMentionV3).toHaveBeenCalledTimes(1);
    expect(out[0]?.verdictVia).toBe("llm");
    expect(out[0]?.mentionQuality).toBe("unknown_brand");
  });
});
