/**
 * 브랜드 상한 검사 — 측정 시작 경로에도 (2026-10-14).
 *
 * 🔴 사고 유형: 상한 검사가 '브랜드 추가'(assign.ts)에만 있고, 측정 시작이 브랜드를 만드는 경로
 *   (`startOrgTracking` → `ensureOrgBrand`)에는 없어 그 길로 상한을 넘겨 브랜드가 생길 수 있었다.
 *
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  plan: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
}));
vi.mock("@repo/auth/plan-server", () => ({ getCurrentPlan: h.plan }));
vi.mock("@repo/database", () => ({
  database: { brand: { findFirst: h.findFirst, count: h.count } },
}));

import { brandCapacityBlock } from "../lib/brand/brand-capacity";

beforeEach(() => {
  for (const fn of Object.values(h)) {
    fn.mockReset();
  }
  h.plan.mockResolvedValue("free"); // 브랜드 상한 1
  h.findFirst.mockResolvedValue(null);
  h.count.mockResolvedValue(0);
});

describe("brandCapacityBlock", () => {
  it("상한에 닿았고 새 도메인이면 막는다(상한 값을 돌려준다)", async () => {
    h.count.mockResolvedValue(1);
    expect(await brandCapacityBlock("org_1", "new.example")).toEqual({
      limit: 1,
    });
  });

  it("상한 아래면 막지 않는다", async () => {
    h.plan.mockResolvedValue("starter"); // 3
    h.count.mockResolvedValue(2);
    expect(await brandCapacityBlock("org_1", "new.example")).toBeNull();
  });

  it("같은 도메인의 기존 브랜드를 재측정하는 것은 막지 않는다", async () => {
    h.count.mockResolvedValue(1);
    h.findFirst.mockResolvedValue({ id: "existing" });
    expect(await brandCapacityBlock("org_1", "same.example")).toBeNull();
  });

  it("상한이 없는 플랜은 막지 않는다 · 조회 실패도 측정을 막지 않는다", async () => {
    h.plan.mockResolvedValue("scale");
    h.count.mockResolvedValue(999);
    expect(await brandCapacityBlock("org_1", "x.example")).toBeNull();
    h.plan.mockRejectedValue(new Error("boom"));
    expect(await brandCapacityBlock("org_1", "x.example")).toBeNull();
  });
});

describe("연결 계약", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("측정 시작이 브랜드를 만들기 전에 상한을 본다", () => {
    const src = read("app/actions/brand/start-tracking.ts");
    const check = src.indexOf("await brandCapacityBlock(");
    const create = src.indexOf("await ensureOrgBrand(");
    expect(check).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(check);
    expect(src).toContain("upgrade: true");
  });

  it("브랜드 화면이 폼 위에 'n/한도'를 보여 주고 한도면 요금제 길을 준다", () => {
    const page = read("app/(authenticated)/brand/page.tsx");
    expect(page).toContain("dict.brandPage.brandCount");
    expect(page).toContain("brandLimitReached");
    expect(page).toContain('href="/billing"');
  });
});
