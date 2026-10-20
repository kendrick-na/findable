/** @vitest-environment node */
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ingest = await import("@/lib/ax-mail/discovery/ingest");
const { emptyDiscovered } = await import("@/lib/ax-mail/discovery/types");
const { createTimeBudget } = await import("@repo/observability/time-budget");

type Store = import("@/lib/ax-mail/discovery/ingest").CompanyStore;
type CompanyRecord = import("@/lib/ax-mail/discovery/ingest").CompanyRecord;
type FactInput = import("@/lib/ax-mail/discovery/ingest").FactInput;

/** 메모리 저장소 — ingest 테스트와 같은 계약. 호출마다 지연을 줄 수 있다(시간 예산 시험용). */
function memoryStore(delayMs = 0, clock?: { t: number }) {
  const companies = new Map<string, CompanyRecord>();
  const facts = new Map<string, FactInput & { companyId: string }>();
  let seq = 0;
  const wait = (): void => {
    if (clock) {
      clock.t += delayMs;
    }
  };
  const store: Store = {
    create(data) {
      wait();
      seq++;
      const row = { ...data, id: `c${seq}` };
      companies.set(row.id, row);
      return Promise.resolve(row);
    },
    findByBusinessNumber(bn) {
      wait();
      return Promise.resolve(
        [...companies.values()].find((c) => c.businessNumber === bn) ?? null
      );
    },
    findByNameRegion(name, region) {
      wait();
      return Promise.resolve(
        [...companies.values()].filter(
          (c) => c.normalizedName === name && c.region === region
        )
      );
    },
    listFacts(companyId, field, source) {
      wait();
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
      wait();
      const prev = companies.get(id) as CompanyRecord;
      const next = { ...prev, ...data };
      companies.set(id, next);
      return Promise.resolve(next);
    },
    upsertFact(companyId, fact) {
      wait();
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

describe("시간 예산 — 다 쓰면 멈추고 이어서 할 위치를 돌려준다", () => {
  test("예산이 없으면 전부 처리하고 nextIndex 는 없다(예전 동작)", async () => {
    const { companies, store } = memoryStore();
    const r = await ingest.ingestCompanies(store, batchOf(5), {
      fetchedAt: AT,
    });
    expect(companies.size).toBe(5);
    expect(r.nextIndex).toBeUndefined();
  });

  test("예산이 다 되면 멈추고 nextIndex 를 돌려준다", async () => {
    const clock = { t: 0 };
    // 1건당 저장소 호출이 여러 번 → 가짜 시계를 1건마다 1000ms 씩 올린다.
    const { companies, store } = memoryStore(1000, clock);
    const budget = createTimeBudget(3500, { now: () => clock.t });
    const r = await ingest.ingestCompanies(store, batchOf(10), {
      budget,
      fetchedAt: AT,
    });
    expect(r.nextIndex).toBeDefined();
    expect(r.nextIndex as number).toBeGreaterThan(0);
    expect(r.nextIndex as number).toBeLessThan(10);
    expect(companies.size).toBeLessThan(10);
  });

  test("nextIndex 부터 이어서 하면 모두 한 번씩만 들어간다(멱등)", async () => {
    const clock = { t: 0 };
    const { companies, store } = memoryStore(1000, clock);
    const items = batchOf(10);
    let start = 0;
    for (let round = 0; round < 20; round++) {
      const budget = createTimeBudget(3500, { now: () => clock.t });
      const r = await ingest.ingestCompanies(store, items, {
        budget,
        fetchedAt: AT,
        startIndex: start,
      });
      if (r.nextIndex === undefined) {
        break;
      }
      start = r.nextIndex;
    }
    expect(companies.size).toBe(10);
  });
});
