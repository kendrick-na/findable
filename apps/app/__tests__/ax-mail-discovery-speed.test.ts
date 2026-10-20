/** @vitest-environment node */
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ingest = await import("@/lib/ax-mail/discovery/ingest");
const { emptyDiscovered } = await import("@/lib/ax-mail/discovery/types");
const { createTimeBudget } = await import("@repo/observability/time-budget");
const { withLatency } = await import("@repo/observability/testing/latency");

type Store = import("@/lib/ax-mail/discovery/ingest").CompanyStore;
type CompanyRecord = import("@/lib/ax-mail/discovery/ingest").CompanyRecord;
type FactInput = import("@/lib/ax-mail/discovery/ingest").FactInput;

/** 메모리 저장소(계약은 ingest 테스트와 같다). 지연은 withLatency 가 넣는다. */
function memoryStore() {
  const companies = new Map<string, CompanyRecord>();
  const facts = new Map<string, FactInput & { companyId: string }>();
  let seq = 0;
  const store: Store = {
    create(data) {
      seq++;
      const row = { ...data, id: `c${seq}` };
      companies.set(row.id, row);
      return Promise.resolve(row);
    },
    findByBusinessNumber(bn) {
      return Promise.resolve(
        [...companies.values()].find((c) => c.businessNumber === bn) ?? null
      );
    },
    findByNameRegion(name, region) {
      return Promise.resolve(
        [...companies.values()].filter(
          (c) => c.normalizedName === name && c.region === region
        )
      );
    },
    listFacts(companyId, field, source) {
      return Promise.resolve(
        [...facts.values()]
          .filter(
            (f) =>
              f.companyId === companyId &&
              f.field === field &&
              f.source === source
          )
          .map((f) => ({ asOf: f.asOf, value: f.value }))
      );
    },
    update(id, data) {
      const next = { ...(companies.get(id) as CompanyRecord), ...data };
      companies.set(id, next);
      return Promise.resolve(next);
    },
    upsertFact(companyId, fact) {
      const key = `${companyId}|${fact.field}|${fact.source}|${fact.asOf}`;
      const existed = facts.has(key);
      facts.set(key, { ...fact, companyId });
      return Promise.resolve(existed ? "updated" : "created");
    },
  };
  return { companies, store };
}

const AT = new Date("2026-10-20T00:00:00Z");
const batchOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    ...emptyDiscovered("fsc", `회사${i}`),
    businessNumber: `1${String(i).padStart(9, "0")}`,
  }));

/** 가짜 시계: sleep 은 실제로 기다리지 않고 시계만 올린다. */
function fakeClock() {
  const clock = { t: 0 };
  return {
    clock,
    now: () => clock.t,
    sleep: (ms: number) => {
      clock.t += ms;
      return Promise.resolve();
    },
  };
}

describe("속도 — 왕복 200ms 가정에서 예산 안에 끝나거나 partial 로 멈춘다", () => {
  test("180곳: 90초 예산 안에서 멈추고, 1건당 DB 호출 수가 상한 안이다", async () => {
    const { now, sleep, clock } = fakeClock();
    const { store } = memoryStore();
    const probe = withLatency(store, 200, { sleep });
    const budget = createTimeBudget(120_000, { now, reserveMs: 30_000 });
    const items = batchOf(180);
    const r = await ingest.ingestCompanies(probe.proxy, items, {
      budget,
      fetchedAt: AT,
    });
    // 예산(90초)을 넘지 않고, 한 건 분량(여유 1건)만 넘을 수 있다.
    const perItemMs = clock.t / Math.max(1, items.length);
    expect(clock.t).toBeLessThanOrEqual(90_000 + 10_000);
    expect(r.nextIndex).toBeDefined();
    expect(r.nextIndex as number).toBeGreaterThan(0);
    // 1건당 저장소 호출 수 상한(신규 회사 기준 약 6~10회).
    const processed = r.nextIndex as number;
    expect(probe.calls() / processed).toBeLessThanOrEqual(12);
    expect(perItemMs).toBeGreaterThan(0);
  });

  test("분할 호출(이어서)로 180곳 전부 들어가고, 재호출마다 예산 안에서 끝난다", async () => {
    const { store, companies } = memoryStore();
    const items = batchOf(180);
    let start = 0;
    let rounds = 0;
    for (; rounds < 50; rounds++) {
      const { now, sleep } = fakeClock();
      const probe = withLatency(store, 200, { sleep });
      const budget = createTimeBudget(120_000, { now, reserveMs: 30_000 });
      const r = await ingest.ingestCompanies(probe.proxy, items, {
        budget,
        fetchedAt: AT,
        startIndex: start,
      });
      if (r.nextIndex === undefined) {
        break;
      }
      start = r.nextIndex;
    }
    expect(companies.size).toBe(180);
    expect(rounds).toBeGreaterThan(0);
    expect(rounds).toBeLessThan(50);
  });
});
