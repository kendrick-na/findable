/**
 * advisory lock 키 — 두 int4 키(네임스페이스, hashtext(id)) 고정 (2026-10-20, 코덱스 3차).
 * `packages/database` 에는 시험 러너가 없어 여기서 돈다.
 *
 * @vitest-environment node
 */
import {
  ADVISORY_LOCK_NAMESPACE,
  advisoryXactLock,
  clerkUserLock,
  ipPurgeCronLock,
  tryAdvisoryXactLock,
} from "@repo/database/advisory-lock";
import { describe, expect, it } from "vitest";

const INT4_MAX = 2_147_483_647;

/** 태그 템플릿 호출을 SQL 문자열 + 값으로 기록하는 가짜 트랜잭션. */
const recorder = (locked = true) => {
  const calls: { sql: string; values: unknown[] }[] = [];
  const record = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ sql: strings.join("$"), values });
  };
  const tx = {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      record(strings, ...values);
      return Promise.resolve(1);
    },
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      record(strings, ...values);
      return Promise.resolve([{ locked }]);
    },
  };
  return {
    calls,
    tx: tx as unknown as Parameters<typeof advisoryXactLock>[0],
  };
};

describe("advisory lock 키", () => {
  it("네임스페이스는 서로 다르고 int4 범위 안이다", () => {
    const values = Object.values(ADVISORY_LOCK_NAMESPACE);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(INT4_MAX);
    }
  });

  it("사용자 잠금과 IP cron 잠금은 다른 네임스페이스를 쓴다", () => {
    expect(clerkUserLock("user_1").namespace).toBe(
      ADVISORY_LOCK_NAMESPACE.CLERK_USER
    );
    expect(ipPurgeCronLock().namespace).toBe(
      ADVISORY_LOCK_NAMESPACE.IP_PURGE_CRON
    );
    expect(clerkUserLock("x").namespace).not.toBe(ipPurgeCronLock().namespace);
  });

  it("잠금 SQL 은 두 인자(int4 네임스페이스, hashtext(id)) 형식이다 — hashtext 단독 금지", async () => {
    const { calls, tx } = recorder();
    await advisoryXactLock(tx, clerkUserLock("user_1"));
    expect(calls[0].sql).toMatch(
      /pg_advisory_xact_lock\(\$::int4, hashtext\(\$\)\)/
    );
    expect(calls[0].values).toEqual([
      ADVISORY_LOCK_NAMESPACE.CLERK_USER,
      "user_1",
    ]);
  });

  it("try 잠금도 같은 형식이고 결과를 그대로 돌려준다", async () => {
    const free = recorder(true);
    expect(await tryAdvisoryXactLock(free.tx, ipPurgeCronLock())).toBe(true);
    expect(free.calls[0].sql).toMatch(
      /pg_try_advisory_xact_lock\(\$::int4, hashtext\(\$\)\)/
    );
    expect(free.calls[0].values).toEqual([
      ADVISORY_LOCK_NAMESPACE.IP_PURGE_CRON,
      "purge-expired-ip",
    ]);
    const busy = recorder(false);
    expect(await tryAdvisoryXactLock(busy.tx, ipPurgeCronLock())).toBe(false);
  });
});
