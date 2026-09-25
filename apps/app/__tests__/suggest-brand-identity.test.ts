import { beforeEach, describe, expect, it, vi } from "vitest";

const lookupStaticBrandNameMock = vi.fn();
const resolveIndustryProfileMock = vi.fn();

vi.mock("@repo/ai/lib/brand-identity", () => ({
  lookupStaticBrandName: (domain: string) => lookupStaticBrandNameMock(domain),
}));
vi.mock("@repo/ai/lib/industry-profile", () => ({
  resolveIndustryProfile: (...args: unknown[]) =>
    resolveIndustryProfileMock(...args),
}));

import { suggestBrandIdentity } from "../app/actions/brand/suggest-brand-identity";

beforeEach(() => {
  lookupStaticBrandNameMock.mockReset();
  resolveIndustryProfileMock.mockReset();
});

describe("브랜드 등록 제안", () => {
  it("사전에 없는 도메인은 이름·업종을 지어내지 않는다", async () => {
    lookupStaticBrandNameMock.mockReturnValue(null);
    expect(await suggestBrandIdentity("unknown.example")).toEqual({
      name: null,
      industry: null,
    });
    expect(resolveIndustryProfileMock).not.toHaveBeenCalled();
  });

  it("확인된 사전 업종만 제안한다", async () => {
    lookupStaticBrandNameMock.mockReturnValue("설화수");
    resolveIndustryProfileMock.mockResolvedValue({
      industry: "beauty",
      confidence: "dictionary",
    });
    expect(await suggestBrandIdentity("sulwhasoo.com")).toEqual({
      name: "설화수",
      industry: "beauty",
    });
  });

  it("LLM 추정과 업종 미확인은 확정 제안으로 채우지 않는다", async () => {
    lookupStaticBrandNameMock.mockReturnValue("브랜드");
    resolveIndustryProfileMock.mockResolvedValue({
      industry: "finance",
      confidence: "inferred",
    });
    expect(await suggestBrandIdentity("brand.example")).toEqual({
      name: "브랜드",
      industry: null,
    });
  });
});
