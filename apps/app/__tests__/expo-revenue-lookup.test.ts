/** @vitest-environment node */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const lib = await import("../scripts/expo-revenue-lookup");
type Checkpoint = import("../scripts/expo-revenue-lookup").Checkpoint;

const COMPANIES = [
  { booth: "E-11", name: "(주)탑월드" },
  { booth: "D-01", name: "(주)파이온텍" },
  { booth: "A-01", name: "(서원대)메디아크" },
];
const NOW = new Date("2026-10-21T00:00:00Z");

/** 가짜 시계 + 가짜 조회(실제 호출 없음). */
function clockAndSleep() {
  const clock = { t: NOW.getTime() };
  return {
    now: () => new Date(clock.t),
    sleep: (ms: number) => {
      clock.t += ms;
      return Promise.resolve();
    },
  };
}

const foundRes = (fy = "2025") => ({
  ambiguous: false,
  company: null,
  revenue: {
    amount: 1_234_567_890,
    basis: "business_report" as const,
    currency: "KRW",
    fiscalYear: fy,
    fsDiv: "CFS",
    receiptNo: "20260331002615",
  },
});

describe("매출 조회 — 출처·추정 금지·이어하기", () => {
  test("찾은 회사는 금액·사업연도·접수번호·출처·조회일을 남긴다", async () => {
    const cp: Checkpoint = { done: {}, version: 1 };
    const lookup = vi.fn(() => Promise.resolve(foundRes()));
    const { now, sleep } = clockAndSleep();
    await lib.runRevenueLookup(COMPANIES.slice(0, 1), lookup, cp, {
      now,
      sleep,
      minIntervalMs: 0,
    });
    const r = cp.done["(주)탑월드"];
    expect(r?.status).toBe("found");
    expect(r?.amount).toBe(1_234_567_890);
    expect(r?.fiscalYear).toBe("2025");
    expect(r?.receiptNo).toBe("20260331002615");
    expect(r?.source).toBe("DART");
    expect(r?.queriedAt.slice(0, 10)).toBe("2026-10-21");
  });

  test("공시가 없으면 금액을 만들지 않고 「확인 필요」로 표시한다", async () => {
    const cp: Checkpoint = { done: {}, version: 1 };
    const { now, sleep } = clockAndSleep();
    await lib.runRevenueLookup(
      COMPANIES.slice(1, 2),
      () => Promise.resolve({ ambiguous: false, company: null, revenue: null }),
      cp,
      { now, sleep, minIntervalMs: 0 }
    );
    expect(cp.done["(주)파이온텍"]?.status).toBe("not_found");
    expect(cp.done["(주)파이온텍"]?.amount).toBeUndefined();
    const table = lib.revenueTable(COMPANIES.slice(1, 2), cp);
    expect(table).toContain("확인 필요");
    expect(table).not.toMatch(/\d+원/);
  });

  test("동명 후보가 여럿이면 보류(ambiguous) — 임의로 고르지 않는다", async () => {
    const cp: Checkpoint = { done: {}, version: 1 };
    const { now, sleep } = clockAndSleep();
    await lib.runRevenueLookup(
      COMPANIES.slice(2, 3),
      () => Promise.resolve({ ambiguous: true, company: null, revenue: null }),
      cp,
      { now, sleep, minIntervalMs: 0 }
    );
    expect(cp.done["(서원대)메디아크"]?.status).toBe("ambiguous");
    expect(cp.done["(서원대)메디아크"]?.amount).toBeUndefined();
  });

  test("조회가 던져도 그 회사만 error 로 남기고 다음 회사를 계속한다", async () => {
    const cp: Checkpoint = { done: {}, version: 1 };
    const { now, sleep } = clockAndSleep();
    let n = 0;
    const lookup = (): Promise<ReturnType<typeof foundRes>> => {
      n++;
      if (n === 1) {
        return Promise.reject(new Error("boom"));
      }
      return Promise.resolve(foundRes());
    };
    await lib.runRevenueLookup(COMPANIES.slice(0, 2), lookup, cp, {
      now,
      sleep,
      minIntervalMs: 0,
    });
    expect(cp.done["(주)탑월드"]?.status).toBe("error");
    expect(cp.done["(주)파이온텍"]?.status).toBe("found");
  });

  test("체크포인트가 있으면 끝난 회사는 다시 부르지 않는다(이어하기)", async () => {
    const cp = {
      done: {
        "(주)탑월드": {
          booth: "E-11",
          name: "(주)탑월드",
          queriedAt: NOW.toISOString(),
          source: "DART" as const,
          status: "found" as const,
          amount: 1,
        },
      },
      version: 1 as const,
    };
    const lookup = vi.fn(() => Promise.resolve(foundRes()));
    const { now, sleep } = clockAndSleep();
    const r = await lib.runRevenueLookup(COMPANIES, lookup, cp, {
      now,
      sleep,
      minIntervalMs: 0,
    });
    expect(r.skipped).toBe(1);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup).not.toHaveBeenCalledWith("(주)탑월드");
  });

  test("외부 호출 사이에 최소 간격을 둔다(속도 제한 준수)", async () => {
    const cp: Checkpoint = { done: {}, version: 1 };
    const { now, sleep } = clockAndSleep();
    const waits: number[] = [];
    const spy = async (ms: number) => {
      waits.push(ms);
      await sleep(ms);
    };
    await lib.runRevenueLookup(
      COMPANIES,
      () => Promise.resolve(foundRes()),
      cp,
      {
        now,
        sleep: spy,
        minIntervalMs: 1000,
      }
    );
    expect(waits.length).toBe(2);
    expect(waits.every((w) => w > 0 && w <= 1000)).toBe(true);
  });

  test("예산이 다 되면 멈추고, 다음 실행이 남은 회사부터 이어한다", async () => {
    const cp: Checkpoint = { done: {}, version: 1 };
    const { now, sleep } = clockAndSleep();
    let left = 2;
    const first = await lib.runRevenueLookup(
      COMPANIES,
      () => Promise.resolve(foundRes()),
      cp,
      {
        now,
        sleep,
        minIntervalMs: 0,
        hasBudget: () => left-- > 0,
      }
    );
    expect(first.stoppedBy).toBe("budget");
    expect(Object.keys(cp.done)).toHaveLength(2);
    const second = await lib.runRevenueLookup(
      COMPANIES,
      () => Promise.resolve(foundRes()),
      cp,
      { now, sleep, minIntervalMs: 0 }
    );
    expect(second.stoppedBy).toBe("complete");
    expect(Object.keys(cp.done)).toHaveLength(3);
  });

  test("체크포인트 파일은 저장·재읽기가 되고 연락처 필드가 없다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "expo-rev-"));
    const path = join(dir, "cp.json");
    const cp: Checkpoint = await lib.loadCheckpoint(path);
    const { now, sleep } = clockAndSleep();
    await lib.runRevenueLookup(
      COMPANIES.slice(0, 2),
      () => Promise.resolve(foundRes()),
      cp,
      {
        checkpointPath: path,
        now,
        sleep,
        minIntervalMs: 0,
      }
    );
    const reloaded = await lib.loadCheckpoint(path);
    expect(Object.keys(reloaded.done)).toHaveLength(2);
    const raw = await readFile(path, "utf8");
    expect(raw).not.toMatch(/@|\b010-\d{4}/);
    expect(raw).not.toMatch(/email|phone|tel/i);
  });
});
