/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Vercel Preview must never reach a paid AI provider from app entry points
// outside the stubbed audit runner. Each guarded entry below is exercised on
// Preview (stub, AI mock untouched) and on production (AI mock called).
const h = vi.hoisted(() => ({
  resolveBrandIdentity: vi.fn(),
  lookupStaticBrandName: vi.fn(),
  suggestTrackingPrompts: vi.fn(),
  resolveIndustryProfile: vi.fn(),
  suggestCompetitors: vi.fn(),
  generateContentDraft: vi.fn(),
  revalidateStoredAuditResult: vi.fn(),
  findUnique: vi.fn(),
}));

// 질문 보관 조회(raw SQL)는 이 테스트의 관심사가 아니다 — 보관된 질문 없음으로 둔다.
vi.mock("@repo/audit/prompt-archive", () => ({
  activePromptFilter: () => ({}),
  archivedPromptIds: () => Promise.resolve([]),
}));
vi.mock("@repo/ai/lib/brand-identity", () => ({
  lookupStaticBrandName: h.lookupStaticBrandName,
  resolveBrandIdentity: h.resolveBrandIdentity,
}));
vi.mock("@repo/ai/lib/prompt-suggestions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  suggestTrackingPrompts: h.suggestTrackingPrompts,
}));
vi.mock("@repo/ai/lib/industry-profile", () => ({
  resolveIndustryProfile: h.resolveIndustryProfile,
}));
vi.mock("@repo/ai/lib/competitor-suggest", () => ({
  suggestCompetitors: h.suggestCompetitors,
}));
vi.mock("@repo/ai/lib/content-draft", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  generateContentDraft: h.generateContentDraft,
}));
vi.mock("@repo/audit/site-profile", () => ({
  readSiteProfile: () =>
    Promise.resolve({
      bodySnippet: "",
      description: "민감성 피부 진정 크림",
      faq: [],
      h1: null,
      headings: [],
      jsonLdFacts: [],
      siteName: "테스트",
      thin: false,
      title: "테스트 | 스킨케어",
    }),
}));
vi.mock("@repo/audit/revalidate-stored-audit", () => ({
  revalidateStoredAuditResult: h.revalidateStoredAuditResult,
}));
vi.mock("@repo/auth/admin", () => ({
  requireAdmin: () => Promise.resolve("admin_1"),
}));
vi.mock("@repo/auth/plan-server", () => ({
  getCurrentPlan: () => Promise.resolve("free"),
}));
vi.mock("@repo/database", () => ({
  database: {
    auditJob: { findUnique: h.findUnique },
    prompt: { count: () => Promise.resolve(0) },
  },
}));
vi.mock("@/lib/db/scoped", () => ({
  requireOrg: () => Promise.resolve("org_1"),
  scopedBrandById: () =>
    Promise.resolve({
      id: "brand_1",
      name: "테스트브랜드",
      domain: "x.test",
      industry: "beauty",
      marketScope: "korea",
      entityVariants: ["별칭"],
      competitors: [{ name: "경쟁사A" }],
    }),
}));

import { suggestBrandIdentity } from "../app/actions/brand/suggest-brand-identity";
import { suggestPromptsAction } from "../app/actions/brand/suggest-prompts";
import { POST as auditRevalidation } from "../app/api/admin/audit-revalidation/route";
import {
  generateContentDraftUnlessPreview,
  suggestCompetitorsUnlessPreview,
} from "../lib/preview/ai-guards";

const draftInput: Parameters<typeof generateContentDraftUnlessPreview>[0] = {
  action: { title: "t", evidence: "근거", how: "방법" },
  brand: { name: "테스트브랜드", domain: "x.test" },
  locale: "ko",
  measurement: {
    enginesMeasured: 4,
    enginesMentioned: 2,
    measuredAt: "2026-10-05T00:00:00.000Z",
    shareOfVoice: null,
    sourceDomains: [],
    weakPrompts: [],
  },
};

const revalidationRequest = () =>
  new Request("https://app.test/api/admin/audit-revalidation", {
    method: "POST",
    body: JSON.stringify({
      jobIds: ["11111111-1111-4111-8111-111111111111"],
    }),
  });

beforeEach(() => {
  for (const fn of Object.values(h)) {
    fn.mockReset();
  }
  h.lookupStaticBrandName.mockReturnValue(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("on Vercel Preview", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview");
  });

  it("suggestPromptsAction returns static suggestions without any LLM", async () => {
    const result = await suggestPromptsAction({ brandId: "brand_1" });
    expect(result).toMatchObject({ ok: true });
    if (!("ok" in result)) {
      throw new Error("expected ok");
    }
    expect(result.suggestions.prompts.length).toBeGreaterThanOrEqual(4);
    // 업종 기반 소비자 말투 기본 질문 — 이름 없는 질문 + 이름 질문 1개.
    expect(
      result.suggestions.prompts.some((p) => p.text.includes("테스트브랜드"))
    ).toBe(true);
    expect(
      result.suggestions.prompts.filter((p) => !p.text.includes("테스트브랜드"))
        .length
    ).toBeGreaterThanOrEqual(3);
    expect(result.suggestions.competitors).toEqual([]);
    expect(h.resolveBrandIdentity).not.toHaveBeenCalled();
    expect(h.suggestTrackingPrompts).not.toHaveBeenCalled();
  });

  it("suggestBrandIdentity keeps the dictionary name and skips industry inference", async () => {
    h.lookupStaticBrandName.mockReturnValue("설화수");
    expect(await suggestBrandIdentity("sulwhasoo.com")).toEqual({
      name: "설화수",
      industry: null,
    });
    expect(h.resolveIndustryProfile).not.toHaveBeenCalled();
  });

  it("onboarding competitor suggestion returns no candidates", async () => {
    expect(
      await suggestCompetitorsUnlessPreview({
        brandName: "b",
        domain: "x.test",
      })
    ).toEqual([]);
    expect(h.suggestCompetitors).not.toHaveBeenCalled();
  });

  it("content draft uses the deterministic template", async () => {
    const draft = await generateContentDraftUnlessPreview(draftInput);
    expect(draft.usedFallback).toBe(true);
    expect(draft.model).toBe("deterministic-evidence-template-v1");
    expect(h.generateContentDraft).not.toHaveBeenCalled();
  });

  it("admin audit revalidation refuses before reading jobs or calling the verifier", async () => {
    const res = await auditRevalidation(revalidationRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "disabled_on_preview" });
    expect(h.findUnique).not.toHaveBeenCalled();
    expect(h.revalidateStoredAuditResult).not.toHaveBeenCalled();
  });
});

describe("on production (unchanged behaviour)", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "production");
  });

  it("suggestPromptsAction calls brand identity and the suggestion LLM", async () => {
    h.resolveBrandIdentity.mockResolvedValue({
      brandName: "해석된이름",
      brandVariants: [],
    });
    h.suggestTrackingPrompts.mockResolvedValue({
      prompts: [],
      competitors: ["c"],
    });
    const result = await suggestPromptsAction({ brandId: "brand_1" });
    expect(result).toEqual({
      ok: true,
      // 무료 플랜 상한 5 − 저장된 질문 0 = 더 담을 수 있는 칸
      remaining: 5,
      suggestions: { prompts: [], competitors: ["c"] },
    });
    expect(h.resolveBrandIdentity).toHaveBeenCalledWith(
      "x.test",
      "테스트브랜드"
    );
    // 재료: 업종·시장·사이트 문구·별칭·경쟁사까지 넘긴다(브랜드명 단독 입력 금지).
    expect(h.suggestTrackingPrompts).toHaveBeenCalledWith(
      expect.objectContaining({
        brandName: "해석된이름",
        competitors: ["경쟁사A"],
        domain: "x.test",
        industry: "beauty",
        marketScope: "korea",
        site: expect.objectContaining({ title: "테스트 | 스킨케어" }),
      })
    );
    const passed = h.suggestTrackingPrompts.mock.calls[0]?.[0];
    expect(passed.aliases).toContain("별칭");
  });

  it("suggestBrandIdentity resolves the industry profile", async () => {
    h.lookupStaticBrandName.mockReturnValue("설화수");
    h.resolveIndustryProfile.mockResolvedValue({
      industry: "beauty",
      confidence: "dictionary",
    });
    expect(await suggestBrandIdentity("sulwhasoo.com")).toEqual({
      name: "설화수",
      industry: "beauty",
    });
    expect(h.resolveIndustryProfile).toHaveBeenCalledTimes(1);
  });

  it("onboarding competitor suggestion calls the LLM helper", async () => {
    h.suggestCompetitors.mockResolvedValue(["A", "B"]);
    expect(
      await suggestCompetitorsUnlessPreview({
        brandName: "b",
        domain: "x.test",
      })
    ).toEqual(["A", "B"]);
    expect(h.suggestCompetitors).toHaveBeenCalledTimes(1);
  });

  it("content draft calls the LLM generator", async () => {
    h.generateContentDraft.mockResolvedValue({ usedFallback: false });
    expect(await generateContentDraftUnlessPreview(draftInput)).toEqual({
      usedFallback: false,
    });
    expect(h.generateContentDraft).toHaveBeenCalledWith(draftInput);
  });

  it("admin audit revalidation still runs the verifier", async () => {
    h.findUnique.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      status: "completed",
      result: {},
    });
    h.revalidateStoredAuditResult.mockResolvedValue({
      status: "skipped",
      reason: "test",
    });
    const res = await auditRevalidation(revalidationRequest());
    expect(res.status).toBe(200);
    expect(h.revalidateStoredAuditResult).toHaveBeenCalledTimes(1);
  });
});
