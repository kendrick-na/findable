import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  aioCitesDomain,
  aioCost,
  aioMentionsBrand,
  BRIGHTDATA_REQUEST_ENDPOINT,
  buildGoogleAioSearchUrl,
  fetchGoogleAio,
  parseGoogleAiOverview,
} from "./google-aio-adapter";

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
const SHOWN = fixture("google-aio-shown.json");
const NOT_SHOWN = fixture("google-aio-not-shown.json");
const ENV = { BRIGHTDATA_API_KEY: "test-key", BRIGHTDATA_SERP_ZONE: "zone1" };

const okFetch = (body: string, status = 200) =>
  vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

describe("buildGoogleAioSearchUrl", () => {
  it("puts q first and sets market, AI overview and JSON parameters", () => {
    const kr = new URL(buildGoogleAioSearchUrl("PDRN 앰플 추천", "KR"));
    expect(kr.host).toBe("www.google.co.kr");
    expect([...kr.searchParams.keys()][0]).toBe("q");
    expect(kr.searchParams.get("q")).toBe("PDRN 앰플 추천");
    expect(kr.searchParams.get("gl")).toBe("kr");
    expect(kr.searchParams.get("hl")).toBe("ko");
    expect(kr.searchParams.get("brd_ai_overview")).toBe("2");
    expect(kr.searchParams.get("brd_json")).toBe("1");
    const us = new URL(buildGoogleAioSearchUrl("best EGF serum", "US"));
    expect(us.host).toBe("www.google.com");
    expect(us.searchParams.get("gl")).toBe("us");
    expect(us.searchParams.get("hl")).toBe("en");
  });
});

describe("parseGoogleAiOverview", () => {
  it("flattens paragraphs and nested lists and dedupes citations", () => {
    const parsed = parseGoogleAiOverview(JSON.parse(SHOWN));
    expect(parsed.present).toBe(true);
    expect(parsed.text).toContain("PDRN 앰플은");
    expect(parsed.text).toContain("많이 언급되는 제품");
    expect(parsed.text).toContain("프란츠 PDRN 앰플");
    expect(parsed.citations.map((c) => c.domain)).toEqual([
      "franzskincare.com",
      "blog.example.com",
      "m.other-brand.kr",
    ]);
    expect(parsed.citations[0]).toMatchObject({
      url: "https://www.franzskincare.com/product/pdrn",
      title: "프란츠 PDRN 앰플",
      source: "franzskincare.com",
    });
  });

  it("reports not present when the SERP has no ai_overview", () => {
    expect(parseGoogleAiOverview(JSON.parse(NOT_SHOWN))).toEqual({
      present: false,
      text: "",
      citations: [],
    });
    expect(parseGoogleAiOverview(null).present).toBe(false);
    expect(parseGoogleAiOverview({ ai_overview: { texts: [] } }).present).toBe(
      false
    );
  });
});

describe("rule-based judgements (no LLM)", () => {
  it("detects brand names and aliases in the overview text", () => {
    const { text } = parseGoogleAiOverview(JSON.parse(SHOWN));
    expect(aioMentionsBrand(text, ["프란츠", "Franz"])).toBe(true);
    expect(aioMentionsBrand(text, ["노우버스", "Knowverse"])).toBe(false);
    expect(aioMentionsBrand("", ["프란츠"])).toBe(false);
  });

  it("matches the official domain and its subdomains only", () => {
    const { citations } = parseGoogleAiOverview(JSON.parse(SHOWN));
    expect(aioCitesDomain(citations, "https://www.franzskincare.com/")).toBe(
      true
    );
    expect(aioCitesDomain(citations, "example.com")).toBe(true);
    expect(aioCitesDomain(citations, "knowverse.net")).toBe(false);
    expect(aioCitesDomain(citations, "skincare.com")).toBe(false);
  });
});

describe("aioCost", () => {
  it("charges 1 credit per successful request; free tier bills 0", () => {
    expect(aioCost(true, "free_tier")).toEqual({
      credits: 1,
      basis: "free_tier",
      listPriceKrw: 2.07,
      billedKrw: 0,
    });
    expect(aioCost(true, "paid").billedKrw).toBe(2.07);
    expect(aioCost(false, "paid")).toMatchObject({ credits: 0, billedKrw: 0 });
  });
});

describe("fetchGoogleAio", () => {
  it("posts the documented request shape and classifies shown", async () => {
    const fetchImpl = okFetch(SHOWN);
    const res = await fetchGoogleAio({
      query: "PDRN 앰플 추천",
      market: "KR",
      env: ENV,
      fetchImpl,
    });
    expect(res.status).toBe("shown");
    expect(res.citations).toHaveLength(3);
    expect(res.textLength).toBeGreaterThan(0);
    expect(res.cost).toMatchObject({ credits: 1, basis: "free_tier" });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe(BRIGHTDATA_REQUEST_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key"
    );
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ zone: "zone1", format: "raw" });
    expect(body.url).toContain("brd_ai_overview=2");
  });

  it("classifies not_shown (still billed: delivery succeeded)", async () => {
    const res = await fetchGoogleAio({
      query: "fractional CTO service",
      market: "US",
      env: ENV,
      fetchImpl: okFetch(NOT_SHOWN),
    });
    expect(res.status).toBe("not_shown");
    expect(res.cost.credits).toBe(1);
  });

  it("unwraps a JSON envelope whose body is a JSON string", async () => {
    const res = await fetchGoogleAio({
      query: "q",
      market: "KR",
      env: ENV,
      fetchImpl: okFetch(JSON.stringify({ status_code: 200, body: SHOWN })),
    });
    expect(res.status).toBe("shown");
  });

  it("never throws: missing config, HTTP errors, bad JSON, network, timeout", async () => {
    const missing = await fetchGoogleAio({ query: "q", market: "KR", env: {} });
    expect(missing).toMatchObject({
      status: "failed",
      failure: { kind: "not_configured" },
      cost: { credits: 0 },
    });

    const auth = await fetchGoogleAio({
      query: "q",
      market: "KR",
      env: ENV,
      fetchImpl: okFetch("secret details", 401),
    });
    expect(auth.failure).toEqual({ kind: "http_auth", httpStatus: 401 });
    expect(JSON.stringify(auth)).not.toContain("secret details");
    expect(auth.cost.credits).toBe(0);

    const limited = await fetchGoogleAio({
      query: "q",
      market: "KR",
      env: ENV,
      fetchImpl: okFetch("", 429),
    });
    expect(limited.failure?.kind).toBe("http_rate_limit");

    const bad = await fetchGoogleAio({
      query: "q",
      market: "KR",
      env: ENV,
      fetchImpl: okFetch("<html>"),
    });
    expect(bad).toMatchObject({
      status: "failed",
      failure: { kind: "parse" },
      cost: { credits: 1 },
    });

    const network = await fetchGoogleAio({
      query: "q",
      market: "KR",
      env: ENV,
      fetchImpl: vi.fn(() =>
        Promise.reject(new TypeError("fetch failed"))
      ) as unknown as typeof fetch,
    });
    expect(network.failure?.kind).toBe("network");

    const hanging = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    ) as unknown as typeof fetch;
    const timedOut = await fetchGoogleAio({
      query: "q",
      market: "KR",
      env: ENV,
      fetchImpl: hanging,
      timeoutMs: 5,
    });
    expect(timedOut.failure?.kind).toBe("timeout");
    expect(timedOut.cost.credits).toBe(0);
  });
});
