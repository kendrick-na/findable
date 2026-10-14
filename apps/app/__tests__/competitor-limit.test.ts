/**
 * 플랜별 경쟁사 상한(2026-10-15) — 새로 늘리는 경우만 막고, 이미 많이 저장된 브랜드는 그대로 둔다.
 *
 * @vitest-environment node
 */
import { planCapabilities } from "@repo/auth/plan";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  plan: "growth" as string,
  planThrows: false,
  update: vi.fn(),
  owned: { current: null as unknown },
}));
vi.mock("@repo/auth/plan-server", () => ({
  getCurrentPlan: () =>
    h.planThrows
      ? Promise.reject(new Error("no auth"))
      : Promise.resolve(h.plan),
}));
vi.mock("@repo/database", () => ({
  database: { brand: { update: h.update }, organization: { update: vi.fn() } },
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

const names = (n: number) => Array.from({ length: n }, (_, i) => `경쟁${i}사`);

beforeEach(() => {
  h.plan = "growth";
  h.planThrows = false;
  h.update.mockReset();
  h.update.mockResolvedValue({});
  h.owned.current = { id: "b1", organizationId: "org_1", competitors: [] };
});

describe("planCapabilities.competitorLimit", () => {
  it("free 3 · starter 5 · growth 10 · scale/enterprise 20", () => {
    expect(
      (["free", "starter", "growth", "scale", "enterprise"] as const).map(
        (p) => planCapabilities(p).competitorLimit
      )
    ).toEqual([3, 5, 10, 20, 20]);
  });
});

describe("updateBrandProfile — 경쟁사 상한", () => {
  it("상한 이하로 새로 저장하면 통과", async () => {
    expect(
      await updateBrandProfile({ brandId: "b1", competitors: names(10) })
    ).toEqual({ ok: true });
  });

  it("상한을 넘겨 새로 늘리면 거절하고 저장하지 않는다", async () => {
    const r = await updateBrandProfile({
      brandId: "b1",
      competitors: names(11),
    });
    expect(r).toEqual({
      error: "경쟁사는 현재 플랜에서 최대 10개까지 등록할 수 있어요.",
    });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("free 는 3개까지", async () => {
    h.plan = "free";
    expect(
      await updateBrandProfile({ brandId: "b1", competitors: names(4) })
    ).toHaveProperty("error");
    expect(
      await updateBrandProfile({ brandId: "b1", competitors: names(3) })
    ).toEqual({ ok: true });
  });

  it("이미 상한보다 많이 저장된 브랜드(예: 11개)는 그 수를 넘기지 않는 한 다시 저장할 수 있다(줄이라고 강요하지 않는다)", async () => {
    h.owned.current = {
      id: "b1",
      organizationId: "org_1",
      competitors: names(11),
    };
    expect(
      await updateBrandProfile({ brandId: "b1", competitors: names(11) })
    ).toEqual({ ok: true });
    expect(
      await updateBrandProfile({ brandId: "b1", competitors: names(8) })
    ).toEqual({ ok: true });
    expect(
      await updateBrandProfile({ brandId: "b1", competitors: names(12) })
    ).toHaveProperty("error");
  });

  it("플랜을 읽지 못하면 막지 않는다(저장을 못 하게 하는 쪽이 더 나쁘다)", async () => {
    h.planThrows = true;
    expect(
      await updateBrandProfile({ brandId: "b1", competitors: names(15) })
    ).toEqual({ ok: true });
  });

  it("경쟁사를 안 보낸 저장은 영향이 없다", async () => {
    h.plan = "free";
    expect(
      await updateBrandProfile({ brandId: "b1", entityVariants: ["별칭"] })
    ).toEqual({ ok: true });
  });
});
