/**
 * '경쟁사 없음' 저장의 세 상태 (2026-10-14).
 *   true  → 표식 {"none": true} 저장(명시 선택)
 *   false → 빈 목록 = 미설정(명시 해제 — 프로필 편집기 체크 해제)
 *   안 보냄 → 이미 '없음'이면 표식 유지(표식을 모르는 호출부가 빈 목록으로 저장해도 선택이 안 사라진다)
 *   이름 있는 경쟁사가 있으면 표식은 어느 경우에도 저장하지 않는다.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  update: vi.fn(),
  orgUpdate: vi.fn(),
  owned: { current: null as unknown },
}));
vi.mock("@repo/database", () => ({
  database: {
    brand: { update: h.update },
    organization: { update: h.orgUpdate },
  },
}));
vi.mock("@/lib/db/scoped", () => ({
  scopedBrandById: () => Promise.resolve(h.owned.current),
}));
vi.mock("@/lib/db/ensure-org", () => ({
  ensureOrgExists: () => Promise.resolve("org_1"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { updateBrandProfile } from "../app/actions/brand/update-profile";

const saved = async (
  input: Record<string, unknown>
): Promise<unknown[] | undefined> => {
  await updateBrandProfile({ brandId: "b1", ...input } as never);
  return h.update.mock.calls[0]?.[0].data.competitors;
};

beforeEach(() => {
  h.orgUpdate.mockReset();
  h.orgUpdate.mockResolvedValue({});
  h.update.mockReset();
  h.update.mockResolvedValue({});
  h.owned.current = {
    id: "b1",
    organizationId: "org_1",
    competitors: [],
  };
});

describe("updateBrandProfile — 경쟁사 없음 3상태", () => {
  it("true → 표식 저장", async () => {
    expect(await saved({ competitors: [], noCompetitors: true })).toEqual([
      { none: true },
    ]);
  });

  it("false → 이미 '없음'이어도 미설정(빈 목록)으로 해제", async () => {
    h.owned.current = {
      id: "b1",
      organizationId: "org_1",
      competitors: [{ none: true }],
    };
    expect(await saved({ competitors: [], noCompetitors: false })).toEqual([]);
  });

  it("안 보냄 → 이미 '없음'이면 표식 유지, 아니면 빈 목록", async () => {
    h.owned.current = {
      id: "b1",
      organizationId: "org_1",
      competitors: [{ none: true }],
    };
    expect(await saved({ competitors: [] })).toEqual([{ none: true }]);
    h.update.mockReset();
    h.update.mockResolvedValue({});
    h.owned.current = { id: "b1", organizationId: "org_1", competitors: [] };
    expect(await saved({ competitors: [] })).toEqual([]);
  });

  it("이름 있는 경쟁사가 있으면 표식은 어느 경우에도 저장하지 않는다", async () => {
    expect(
      await saved({ competitors: ["라운드랩"], noCompetitors: true })
    ).toEqual(["라운드랩"]);
  });
});

describe("온보딩 단계 저장 — 상한 6", () => {
  it("6단계를 저장하면 6으로 저장된다(예전 상한 5는 6단계 이탈 시 5단계로 되돌렸다)", async () => {
    await updateBrandProfile({ brandId: "b1", onboardingStep: 6 } as never);
    expect(h.orgUpdate.mock.calls[0]?.[0].data.onboardingStep).toBe(6);
  });

  it("범위를 벗어난 값은 2~6 으로 자른다", async () => {
    await updateBrandProfile({ brandId: "b1", onboardingStep: 99 } as never);
    expect(h.orgUpdate.mock.calls[0]?.[0].data.onboardingStep).toBe(6);
    h.orgUpdate.mockClear();
    await updateBrandProfile({ brandId: "b1", onboardingStep: 0 } as never);
    expect(h.orgUpdate.mock.calls[0]?.[0].data.onboardingStep).toBe(2);
  });
});
