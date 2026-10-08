import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  brandUpdate: vi.fn(),
  ensureOrgExists: vi.fn(),
  orgUpdate: vi.fn(),
  scopedBrandById: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  database: {
    brand: { update: mocks.brandUpdate },
    organization: { update: mocks.orgUpdate },
  },
}));
vi.mock("@repo/observability/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/scoped", () => ({
  scopedBrandById: mocks.scopedBrandById,
}));
vi.mock("@/lib/db/ensure-org", () => ({
  ensureOrgExists: mocks.ensureOrgExists,
}));

import { updateBrandProfile } from "@/app/actions/brand/update-profile";

describe("updateBrandProfile — Org 행 보장 (웹훅 지연)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scopedBrandById.mockResolvedValue({
      id: "brand_1",
      organizationId: "org_1",
    });
  });

  it("Org 행을 먼저 보장한 뒤 온보딩 단계를 저장한다", async () => {
    mocks.ensureOrgExists.mockResolvedValue("org_1");
    const result = await updateBrandProfile({
      brandId: "brand_1",
      marketScope: "korea",
      onboardingStep: 3,
    });
    expect(result).toEqual({ ok: true });
    expect(mocks.ensureOrgExists).toHaveBeenCalledOnce();
    expect(mocks.orgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "org_1" } })
    );
  });

  it("Org 를 보장하지 못하면 쓰지 않고 안내 문구를 돌려준다", async () => {
    mocks.ensureOrgExists.mockResolvedValue(null);
    const result = await updateBrandProfile({
      brandId: "brand_1",
      onboardingStep: 3,
    });
    expect(result).toEqual({
      error: "조직 정보를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
    expect(mocks.orgUpdate).not.toHaveBeenCalled();
    expect(mocks.brandUpdate).not.toHaveBeenCalled();
  });

  it("온보딩 단계가 없는 저장은 Org 조회를 하지 않는다", async () => {
    await updateBrandProfile({ brandId: "brand_1", competitors: ["A"] });
    expect(mocks.ensureOrgExists).not.toHaveBeenCalled();
    expect(mocks.brandUpdate).toHaveBeenCalledOnce();
  });

  it("공식 회사 정보를 정규화해 저장한다", async () => {
    await updateBrandProfile({
      brandId: "brand_1",
      legalName: "  비바리퍼블리카 ",
      businessNumber: "1234567890",
    });
    expect(mocks.brandUpdate).toHaveBeenCalledWith({
      where: { id: "brand_1" },
      data: { legalName: "비바리퍼블리카", businessNumber: "123-45-67890" },
    });
  });

  it("사업자등록번호 형식이 틀리면 저장하지 않는다", async () => {
    const result = await updateBrandProfile({
      brandId: "brand_1",
      businessNumber: "12345",
    });
    expect(result).toEqual({ error: "사업자등록번호 10자리를 확인해 주세요." });
    expect(mocks.brandUpdate).not.toHaveBeenCalled();
  });

  it("빈 값으로 저장하면 지운다(null)", async () => {
    await updateBrandProfile({ brandId: "brand_1", legalName: "" });
    expect(mocks.brandUpdate).toHaveBeenCalledWith({
      where: { id: "brand_1" },
      data: { legalName: null },
    });
  });
});
