/** @vitest-environment node */
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ic = await import("@/lib/ax-mail/discovery/identity-check");
const { withLatency } = await import("@repo/observability/testing/latency");

type FactInput = import("@/lib/ax-mail/discovery/ingest").FactInput;

describe("대조 1회 — DB 호출 상한(왕복 200ms 가정, 가짜 시계)", () => {
  test("회사 1곳 대조 = 저장 1회, 홈페이지 읽기 1회, 200ms 한 번 — 상한 안", async () => {
    const clock = { t: 0 };
    const sleep = (ms: number) => {
      clock.t += ms;
      return Promise.resolve();
    };
    const rows: FactInput[] = [];
    const db = {
      save: (f: FactInput): Promise<void> => {
        rows.push(f);
        return Promise.resolve();
      },
    };
    const probe = withLatency(db, 200, { sleep });
    let reads = 0;
    const out = await ic.runCompanyIdentityCheck({
      checkedOn: "2026-10-21",
      company: {
        businessNumber: "8330187017",
        dartCorpCode: "00123456",
        legalName: "(주)파이온텍",
      },
      fetchedAt: new Date("2026-10-21T00:00:00Z"),
      hasRevenue: true,
      readHomepageNumbers: () => {
        reads++;
        return Promise.resolve({
          numbers: ["8330187017"],
          pagesRead: 2,
          status: "ok" as const,
        });
      },
      save: (f) => probe.proxy.save(f),
    });
    expect(out.kind).toBe("ok");
    expect(probe.calls()).toBe(1);
    expect(reads).toBe(1);
    expect(rows).toHaveLength(1);
    expect(clock.t).toBe(200);
  });

  test("매출·DART 번호가 없으면 DB 저장도 홈페이지 읽기도 하지 않는다", async () => {
    let saves = 0;
    let reads = 0;
    const base = {
      checkedOn: "2026-10-21",
      fetchedAt: new Date("2026-10-21T00:00:00Z"),
      readHomepageNumbers: () => {
        reads++;
        return Promise.resolve({
          numbers: [],
          pagesRead: 1,
          status: "ok" as const,
        });
      },
      save: () => {
        saves++;
        return Promise.resolve();
      },
    };
    const noRev = await ic.runCompanyIdentityCheck({
      ...base,
      company: {
        businessNumber: "8330187017",
        dartCorpCode: "00123456",
        legalName: "(주)파이온텍",
      },
      hasRevenue: false,
    });
    const noDart = await ic.runCompanyIdentityCheck({
      ...base,
      company: {
        businessNumber: null,
        dartCorpCode: null,
        legalName: "(주)파이온텍",
      },
      hasRevenue: true,
    });
    expect(noRev.kind).toBe("no_revenue");
    expect(noDart.kind).toBe("no_dart");
    expect(saves).toBe(0);
    expect(reads).toBe(0);
  });

  test("홈페이지 상태 변환: robots 차단·수집거부는 refused, 나머지 실패는 unavailable", () => {
    expect(ic.toHomepageStatus("ok")).toBe("ok");
    expect(ic.toHomepageStatus("blocked_by_robots")).toBe("refused");
    expect(ic.toHomepageStatus("refused")).toBe("refused");
    expect(ic.toHomepageStatus("unavailable")).toBe("unavailable");
    expect(ic.toHomepageStatus("skipped")).toBe("unavailable");
  });
});
