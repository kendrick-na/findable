import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditCost,
  UI_VENDOR_USD_PER_RECORD,
  USD_TO_KRW,
  uiVendorShadowCostOf,
} from "./cost";
import type { EngineQuery, EngineResponse, UiVendorShadow } from "./types";
import {
  isUiVendorShadowAllowed,
  isUiVendorShadowEnabled,
  parseVendorRecord,
  runUiVendorCandidate,
  startUiVendorShadow,
  uiVendorCountry,
} from "./ui-vendor-v1";

vi.mock("@repo/observability/log", () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const okRecord = {
  answer_text: "라네즈는 대표적인 한국 화장품입니다.",
  citations: [
    {
      url: "https://www.laneige.com/kr/ko/",
      title: "라네즈",
      domain: "laneige.com",
      cited: true,
      position: 1,
    },
    { url: "https://www.laneige.com/kr/ko/", title: "dup" },
    { url: "not a url" },
    { title: "no url" },
  ],
  model: "Flash-Lite",
  web_search_triggered: true,
  country: "KR",
};

const query = (engineId: "chatgpt" | "gemini" = "chatgpt"): EngineQuery => ({
  engineId,
  language: "ko",
  prompt: "추천해줘",
  brandName: "라네즈",
  brandDomain: "laneige.com",
});

const jsonRes = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("parseVendorRecord", () => {
  it("parses a sync object record", () => {
    const p = parseVendorRecord(okRecord);
    expect(p.kind).toBe("ok");
    if (p.kind === "ok") {
      expect(p.model).toBe("Flash-Lite");
      expect(p.webSearchTriggered).toBe(true);
      expect(p.sources).toHaveLength(3); // url 없는 항목만 제외, 중복·잘못된 URL 은 mapProviderSources 가 거른다
    }
  });

  it("parses an array body (snapshot) and null model", () => {
    const p = parseVendorRecord([{ ...okRecord, model: null }]);
    expect(p).toMatchObject({ kind: "ok", model: null });
  });

  it("blocked error record", () => {
    expect(
      parseVendorRecord({
        error: "Auth wall: sign-up prompt detected",
        error_code: "blocked",
      })
    ).toEqual({ kind: "error", code: "blocked" });
  });

  it("empty answer / missing answer", () => {
    expect(parseVendorRecord({ answer_text: "   " })).toEqual({
      kind: "empty",
    });
    expect(parseVendorRecord({ citations: [] })).toEqual({ kind: "empty" });
  });

  it("malformed inputs never throw", () => {
    for (const bad of [
      null,
      undefined,
      "x",
      3,
      [],
      [null],
      { answer_text: 5 },
    ]) {
      expect(parseVendorRecord(bad).kind).toBe("malformed");
    }
  });
});

describe("runUiVendorCandidate", () => {
  beforeEach(() => {
    vi.stubEnv("BRIGHTDATA_API_KEY", "test-key-not-real");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("not configured -> no fetch", async () => {
    vi.stubEnv("BRIGHTDATA_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await runUiVendorCandidate("chatgpt-ui-vendor-v1", query());
    expect(out.error).toBe("[ui-vendor:not_configured]");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("200 sync: sends the documented body and parses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(200, [okRecord]));
    vi.stubGlobal("fetch", fetchMock);
    const out = await runUiVendorCandidate("chatgpt-ui-vendor-v1", query());
    expect(out.error).toBeNull();
    expect(out.model).toBe("Flash-Lite");
    expect(out.response.brandMentioned).toBe(true);
    expect(out.response.citedSources.map((s) => s.domain)).toEqual([
      "www.laneige.com",
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("dataset_id=gd_m7aof0k82r803d5bjm");
    expect(url).toContain("notify=false&include_errors=true");
    expect(JSON.parse(String(init.body))).toEqual({
      input: [
        {
          url: "https://chatgpt.com/",
          prompt: "추천해줘",
          country: "KR",
          web_search: true,
          additional_prompt: "",
        },
      ],
    });
  });

  it("gemini uses its dataset and no extra fields; en -> US", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(200, okRecord));
    vi.stubGlobal("fetch", fetchMock);
    await runUiVendorCandidate("gemini-ui-vendor-v1", {
      ...query("gemini"),
      language: "en",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("dataset_id=gd_mbz66arm2mf9cu856y");
    expect(JSON.parse(String(init.body)).input[0]).toEqual({
      url: "https://gemini.google.com/",
      prompt: "추천해줘",
      country: "US",
    });
    expect(uiVendorCountry({ language: "ko" })).toBe("KR");
  });

  it("202 -> poll running -> ready -> snapshot", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(202, { snapshot_id: "s_1" }))
      .mockResolvedValueOnce(jsonRes(200, { status: "running" }))
      .mockResolvedValueOnce(jsonRes(200, { status: "ready" }))
      .mockResolvedValueOnce(jsonRes(200, [okRecord]));
    vi.stubGlobal("fetch", fetchMock);
    const out = await runUiVendorCandidate(
      "gemini-ui-vendor-v1",
      query("gemini"),
      {
        pollMs: 1,
      }
    );
    expect(out.error).toBeNull();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[1]).toContain("/progress/s_1");
    expect(urls[3]).toContain("/snapshot/s_1?format=json");
  });

  it("202 -> progress failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonRes(202, { snapshot_id: "s_1" }))
        .mockResolvedValueOnce(jsonRes(200, { status: "failed" }))
    );
    const out = await runUiVendorCandidate("chatgpt-ui-vendor-v1", query(), {
      pollMs: 1,
    });
    expect(out.error).toBe("[ui-vendor:vendor_failed]");
  });

  it("202 never ready -> timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            url.includes("/scrape")
              ? jsonRes(202, { snapshot_id: "s_1" })
              : jsonRes(200, { status: "running" })
          )
        )
    );
    const out = await runUiVendorCandidate("chatgpt-ui-vendor-v1", query(), {
      pollMs: 5,
      timeoutMs: 30,
    });
    expect(out.error).toBe("[ui-vendor:timeout]");
  });

  it("blocked / empty / malformed / http error / network", async () => {
    const cases: [() => Promise<Response>, string][] = [
      [
        () =>
          Promise.resolve(
            jsonRes(200, [{ error: "Auth wall", error_code: "blocked" }])
          ),
        "[ui-vendor:blocked]",
      ],
      [
        () => Promise.resolve(jsonRes(200, [{ answer_text: "" }])),
        "[ui-vendor:empty_answer]",
      ],
      [() => Promise.resolve(jsonRes(200, "oops")), "[ui-vendor:malformed]"],
      [() => Promise.resolve(jsonRes(500, {})), "[ui-vendor:http_500]"],
      [() => Promise.reject(new TypeError("boom")), "[ui-vendor:network]"],
    ];
    for (const [impl, expected] of cases) {
      const fetchMock = vi.fn().mockImplementation(impl);
      vi.stubGlobal("fetch", fetchMock);
      const out = await runUiVendorCandidate("chatgpt-ui-vendor-v1", query());
      expect(out.error).toBe(expected);
      expect(fetchMock).toHaveBeenCalledTimes(1); // 재시도 없음
    }
  });

  it("parent abort -> aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("x", "AbortError"))
    );
    const out = await runUiVendorCandidate("chatgpt-ui-vendor-v1", {
      ...query(),
      signal: ac.signal,
    });
    expect(out.error).toBe("[ui-vendor:aborted]");
  });
});

describe("flags and allowlist", () => {
  it("defaults off, empty list denies everyone", () => {
    expect(isUiVendorShadowEnabled({})).toBe(false);
    expect(isUiVendorShadowEnabled({ UI_VENDOR_SHADOW: "true" })).toBe(true);
    expect(isUiVendorShadowAllowed("a.com", {})).toBe(false);
    expect(
      isUiVendorShadowAllowed("www.A.com", {
        UI_VENDOR_SHADOW_BRANDS: "a.com b.com",
      })
    ).toBe(true);
    expect(
      isUiVendorShadowAllowed(undefined, { UI_VENDOR_SHADOW_BRANDS: "a.com" })
    ).toBe(false);
  });
});

describe("startUiVendorShadow handle", () => {
  afterEach(() => vi.unstubAllEnvs());
  const main = (): EngineResponse => ({
    brandMentioned: true,
    citedSources: [],
    durationMs: 1,
    engineId: "chatgpt",
    errorMessage: null,
    isStub: false,
    mentionListSize: null,
    mentionPosition: null,
    rawResponse: "a",
    sentiment: null,
    shareOfVoice: null,
  });

  it("ok outcome carries model label, web search flag, billed record", async () => {
    const response: EngineResponse = {
      ...main(),
      rawResponse: "답",
      brandMentioned: false,
    };
    const handle = startUiVendorShadow(
      { language: "ko", prompt: "p", brandName: "라네즈" },
      "chatgpt-ui-vendor-v1",
      () =>
        Promise.resolve({
          response,
          durationMs: 3,
          error: null,
          model: "Flash-Lite",
          webSearchTriggered: false,
        })
    );
    const shadow = await handle.finish(main());
    expect(shadow).toMatchObject({
      outcome: "ok",
      recordBilled: true,
      vendorModel: "Flash-Lite",
      webSearchTriggered: false,
      comparison: { mentionAgreement: false },
    });
  });

  it("grace 0 and slow vendor -> skipped_budget, not billed", async () => {
    const handle = startUiVendorShadow(
      { language: "ko", prompt: "p" },
      "gemini-ui-vendor-v1",
      (_c, q) =>
        new Promise((_resolve, reject) => {
          q.signal?.addEventListener("abort", () => reject(new Error("x")));
        })
    );
    const shadow = await handle.finish(main());
    expect(shadow.outcome).toBe("skipped_budget");
    expect(shadow.recordBilled).toBe(false);
  });

  it("runner that throws -> failed, never throws", async () => {
    const handle = startUiVendorShadow(
      { language: "ko", prompt: "p" },
      "gemini-ui-vendor-v1",
      () => Promise.reject(new Error("boom"))
    );
    vi.stubEnv("UI_VENDOR_SHADOW_GRACE_MS", "50");
    const shadow = await handle.finish(main());
    expect(shadow.outcome).toBe("failed");
  });
});

describe("ui-vendor shadow cost", () => {
  const shadow = (over: Partial<UiVendorShadow> = {}): UiVendorShadow => ({
    candidate: "chatgpt-ui-vendor-v1",
    outcome: "ok",
    text: "t",
    citations: [],
    brandMentioned: true,
    durationMs: 1,
    error: null,
    recordBilled: true,
    vendorModel: null,
    webSearchTriggered: true,
    comparison: null,
    ...over,
  });
  const row = (s?: UiVendorShadow): EngineResponse => ({
    brandMentioned: true,
    citedSources: [],
    durationMs: 1,
    engineId: "chatgpt",
    errorMessage: null,
    isStub: false,
    mentionListSize: null,
    mentionPosition: null,
    rawResponse: "a",
    sentiment: null,
    shareOfVoice: null,
    ...(s ? { shadowUiVendor: s } : {}),
  });

  it("$1.50 per 1,000 successful records", () => {
    expect(UI_VENDOR_USD_PER_RECORD).toBeCloseTo(0.0015, 10);
    const c = uiVendorShadowCostOf(row(shadow()));
    expect(c?.basis).toBe("vendor-record");
    expect(c?.krw).toBeCloseTo(0.0015 * USD_TO_KRW, 6);
  });

  it("failed / skipped / unbilled -> no entry", () => {
    expect(
      uiVendorShadowCostOf(
        row(shadow({ outcome: "failed", recordBilled: false }))
      )
    ).toBeNull();
    expect(
      uiVendorShadowCostOf(
        row(shadow({ outcome: "skipped_budget", recordBilled: false }))
      )
    ).toBeNull();
    expect(uiVendorShadowCostOf(row())).toBeNull();
  });

  it("auditCost keeps it out of totalKrw but reports it", () => {
    const base = auditCost([row()]);
    const withShadow = auditCost([row(shadow()), row(shadow())]);
    expect(withShadow.uiVendorShadow).toHaveLength(2);
    expect(withShadow.uiVendorShadowKrw).toBeCloseTo(
      2 * 0.0015 * USD_TO_KRW,
      6
    );
    expect(withShadow.shadowKrw).toBeCloseTo(
      withShadow.uiVendorShadowKrw ?? 0,
      6
    );
    expect(withShadow.totalKrw).toBeCloseTo(base.totalKrw * 2, 6);
    expect(base).not.toHaveProperty("uiVendorShadowKrw");
    expect(base).not.toHaveProperty("shadowKrw");
  });
});
