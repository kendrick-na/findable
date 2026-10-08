import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDaumMentions } from "./kakao-search";
import {
  brandRelevance,
  fetchNaverMentions,
  naverOpenApiCredentials,
  parseTrend,
  plainText,
  questionTitles,
} from "./naver-openapi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("naver open api — parsing", () => {
  it("prefers the production key names and falls back to NAVER_OPENAPI_*", () => {
    expect(
      naverOpenApiCredentials({
        NAVER_CLIENT_ID: "a",
        NAVER_CLIENT_SECRET: "b",
        NAVER_OPENAPI_CLIENT_ID: "x",
        NAVER_OPENAPI_CLIENT_SECRET: "y",
      })
    ).toEqual({ clientId: "a", clientSecret: "b" });
    expect(
      naverOpenApiCredentials({
        NAVER_OPENAPI_CLIENT_ID: "x",
        NAVER_OPENAPI_CLIENT_SECRET: "y",
      })
    ).toEqual({ clientId: "x", clientSecret: "y" });
    expect(naverOpenApiCredentials({})).toBeNull();
  });

  it("strips highlight tags and entities", () => {
    expect(plainText("<b>프란츠</b> 앰플 &amp; 크림 &quot;후기&quot;")).toBe(
      '프란츠 앰플 & 크림 "후기"'
    );
  });

  // 2026-10-06 실측: 「프란츠 앰플」 블로그 상위 20건 중 실제 프란츠 언급은 16건.
  it("measures how many sampled posts really mention the brand", () => {
    const items = [
      { title: "<b>프란츠</b> PDRN 앰플 후기", description: "" },
      { title: "아이다 <b>앰플</b> 맛집", description: "선배 후기" },
      { title: "여행템", description: "FRANZ skincare 앰플 소분" },
      { title: "레몬청 클렌저", description: "앰플" },
    ];
    expect(brandRelevance(items, ["프란츠", "Franz"])).toBe(0.5);
    expect(brandRelevance([], ["프란츠"])).toBeNull();
  });

  it("keeps only question-shaped kin titles, deduplicated", () => {
    expect(
      questionTitles([
        { title: "<b>pdrn 앰플</b> 추천해주세요." },
        { title: "pdrn앰플 추천해주세요." },
        { title: "메디큐브 연어 핑크 앰플 라운드랩 비타 나이아신 앰플" },
        { title: "폭염 대비, 진정·보습 성분 화장품 추천하시나요?" },
      ])
    ).toEqual([
      "pdrn 앰플 추천해주세요.",
      "폭염 대비, 진정·보습 성분 화장품 추천하시나요?",
    ]);
  });

  it("parses datalab series and drops malformed points", () => {
    expect(
      parseTrend({
        results: [
          {
            title: "프란츠",
            data: [
              { period: "2026-04-01", ratio: 29.1 },
              { period: "2026-05-01" },
            ],
          },
          { title: 3, data: [] },
        ],
      })
    ).toEqual([
      { title: "프란츠", points: [{ period: "2026-04-01", ratio: 29.1 }] },
    ]);
    expect(parseTrend(null)).toEqual([]);
  });
});

describe("naver / daum mentions — network", () => {
  it("returns null without keys instead of failing", async () => {
    expect(
      await fetchNaverMentions("프란츠", ["프란츠"], { credentials: null })
    ).toBeNull();
    vi.stubEnv("KAKAO_REST_API_KEY", "");
    expect(await fetchDaumMentions("프란츠", ["프란츠"])).toBeNull();
    vi.unstubAllEnvs();
  });

  it("keeps working channels when one channel fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.includes("/kin.json")
            ? new Response("denied", { status: 401 })
            : Response.json({
                total: 100,
                items: [{ title: "<b>프란츠</b> 후기", description: "" }],
              })
        )
      )
    );
    const result = await fetchNaverMentions("프란츠 앰플", ["프란츠"], {
      credentials: { clientId: "id", clientSecret: "secret" },
    });
    expect(result).toEqual({
      query: "프란츠 앰플",
      totals: { blog: 100, cafe: 100, kin: null, news: 100 },
      relevance: 1,
    });
  });

  it("reads daum total_count per channel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            meta: { total_count: 9 },
            documents: [{ title: "프란츠 앰플", contents: "" }],
          })
        )
      )
    );
    expect(
      await fetchDaumMentions("프란츠 앰플", ["프란츠"], { apiKey: "k" })
    ).toEqual({
      query: "프란츠 앰플",
      totals: { web: 9, blog: 9, cafe: 9 },
      relevance: 1,
    });
  });
});
