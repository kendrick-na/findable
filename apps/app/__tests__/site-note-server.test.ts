/**
 * "한 줄 소개" 안전망 서버 쪽(2026-10-14) — 사이트 글자가 거의 안 읽히면 화면에 알리고, 고객이 적은 소개는 질문 재료로만 쓰며 저장하지 않는다.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  suggest: vi.fn(),
  readSite: vi.fn(),
  identity: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@repo/audit/prompt-archive", () => ({
  activePromptFilter: () => ({}),
  archivedPromptIds: () => Promise.resolve([]),
}));
vi.mock("@repo/ai/lib/brand-identity", () => ({
  lookupStaticBrandName: () => null,
  resolveBrandIdentity: h.identity,
}));
vi.mock("@repo/ai/lib/prompt-suggestions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  suggestTrackingPrompts: h.suggest,
}));
vi.mock("@repo/audit/site-profile", () => ({ readSiteProfile: h.readSite }));
vi.mock("@repo/auth/plan-server", () => ({
  getCurrentPlan: () => Promise.resolve("free"),
}));
vi.mock("@repo/database", () => ({
  database: { prompt: { count: () => Promise.resolve(0) } },
}));
vi.mock("@/lib/db/scoped", () => ({
  requireOrg: () => Promise.resolve("org_1"),
  scopedBrandById: () =>
    Promise.resolve({
      id: "brand_1",
      name: "카카오페이",
      domain: "kakaopay.com",
      industry: "finance",
      marketScope: "korea",
      entityVariants: [],
      competitors: [],
    }),
}));

import { suggestPromptsAction } from "../app/actions/brand/suggest-prompts";
import { cleanSiteNote, SITE_NOTE_MAX } from "../lib/brand/site-note";

beforeEach(() => {
  h.suggest.mockReset();
  h.readSite.mockReset();
  h.identity.mockReset();
  h.identity.mockResolvedValue({ brandName: "카카오페이", brandVariants: [] });
  h.readSite.mockResolvedValue({
    bodySnippet: "카카오페이",
    description: null,
    faq: [],
    h1: null,
    headings: [],
    jsonLdFacts: [],
    siteName: null,
    thin: true,
    title: "카카오페이",
  });
  h.suggest.mockResolvedValue({
    competitors: [],
    prompts: [],
    siteThin: true,
  });
});

describe("서버: 한 줄 소개", () => {
  it("사이트가 얇으면 siteThin 을 화면에 알린다", async () => {
    const r = await suggestPromptsAction({ brandId: "brand_1" });
    expect(r).toMatchObject({ ok: true, siteThin: true });
  });

  it("고객이 적은 소개는 사이트 재료 앞에 붙고 thin 이 풀린다(저장은 안 한다)", async () => {
    h.suggest.mockResolvedValue({ competitors: [], prompts: [] });
    await suggestPromptsAction({
      brandId: "brand_1",
      siteNote: "  송금·결제·투자를 하는   금융 앱이에요 ",
    });
    const site = h.suggest.mock.calls[0]?.[0].site;
    expect(site.description).toContain("송금·결제·투자를 하는 금융 앱이에요");
    expect(
      site.bodySnippet.startsWith("송금·결제·투자를 하는 금융 앱이에요")
    ).toBe(true);
    expect(site.thin).toBe(false);
  });

  it("소개가 비어 있으면 사이트 재료를 그대로 쓴다", async () => {
    await suggestPromptsAction({ brandId: "brand_1", siteNote: "   " });
    expect(h.suggest.mock.calls[0]?.[0].site.thin).toBe(true);
  });

  it("cleanSiteNote: 제어 문자 제거·공백 정리·300자 제한", () => {
    expect(cleanSiteNote("a\u0000b\n\nc")).toBe("a b c");
    expect(cleanSiteNote("가".repeat(500))).toHaveLength(SITE_NOTE_MAX);
    expect(cleanSiteNote(undefined)).toBe("");
  });
});
