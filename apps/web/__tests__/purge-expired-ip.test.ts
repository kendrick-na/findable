/**
 * 접속 IP 3개월 자동 삭제 — 2026-10-20 대표 결정 ②.
 *  - 3개월 지난 행의 IP 칸만 비우고(행은 유지), 최근 것·이미 비운 것은 그대로 둔다
 *  - 두 번 돌려도 같다(멱등)
 *  - cron 은 진짜 `denyIfNotCron` 을 거친다(비밀값 없거나 틀리면 DB 를 안 건드린다)
 *  - vercel.json 에 매일 일정이 등록돼 있고 하트비트 일정과 같다
 * 운영 DB 접속 0(메모리 DB).
 *
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface JobRow {
  createdAt: Date;
  id: string;
  ipAddress: string | null;
}

const h = vi.hoisted(() => ({ rows: [] as JobRow[], calls: 0 }));

const memoryAuditJob = {
  updateMany: ({
    where,
    data,
  }: {
    where: { createdAt: { lt: Date }; ipAddress: { not: null } };
    data: { ipAddress: null };
  }) => {
    h.calls += 1;
    let count = 0;
    for (const row of h.rows) {
      if (row.createdAt < where.createdAt.lt && row.ipAddress !== null) {
        row.ipAddress = data.ipAddress;
        count += 1;
      }
    }
    return Promise.resolve({ count });
  },
};

vi.mock("@repo/database", () => ({ database: { auditJob: memoryAuditJob } }));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { ipRetentionCutoff, purgeExpiredIpAddresses } = await import(
  "../lib/purge-expired-ip"
);
const { GET } = await import("../app/api/cron/purge-expired-ip/route");

/** 메모리 updateMany 를 Prisma 시그니처로 맞춘다(이 기능이 쓰는 인자 모양만 구현). */
const memClient = () =>
  ({ auditJob: memoryAuditJob }) as unknown as Parameters<
    typeof purgeExpiredIpAddresses
  >[0];

const NOW = new Date("2026-10-20T03:00:00.000Z");
const at = (iso: string) => new Date(iso);

const seedRows = (): JobRow[] => [
  { id: "old", createdAt: at("2026-07-19T00:00:00Z"), ipAddress: "1.2.3.4" },
  {
    id: "old_v6",
    createdAt: at("2026-01-01T00:00:00Z"),
    ipAddress: "2001:db8:1:2::/64",
  },
  {
    id: "old_mark",
    createdAt: at("2026-06-01T00:00:00Z"),
    ipAddress: "auto-refresh",
  },
  { id: "edge", createdAt: at("2026-07-20T03:00:00Z"), ipAddress: "5.6.7.8" },
  { id: "recent", createdAt: at("2026-10-19T00:00:00Z"), ipAddress: "9.9.9.9" },
  { id: "old_null", createdAt: at("2026-01-01T00:00:00Z"), ipAddress: null },
];

const ipOf = (id: string) => h.rows.find((r) => r.id === id)?.ipAddress;

beforeEach(() => {
  h.rows = seedRows();
  h.calls = 0;
});

describe("ipRetentionCutoff — 달력 기준 3개월", () => {
  it("10-20 이면 07-20 같은 시각", () => {
    expect(ipRetentionCutoff(NOW).toISOString()).toBe(
      "2026-07-20T03:00:00.000Z"
    );
  });
  it("연도를 넘어간다(2027-01-15 → 2026-10-15)", () => {
    expect(ipRetentionCutoff(at("2027-01-15T00:00:00Z")).toISOString()).toBe(
      "2026-10-15T00:00:00.000Z"
    );
  });
});

describe("purgeExpiredIpAddresses", () => {
  it("3개월 지난 행의 IP 만 비우고, 최근·경계 시각·이미 빈 행은 그대로 둔다", async () => {
    const r = await purgeExpiredIpAddresses(memClient(), NOW);
    expect(r.cleared).toBe(3);
    expect(ipOf("old")).toBeNull();
    expect(ipOf("old_v6")).toBeNull();
    expect(ipOf("old_mark")).toBeNull();
    expect(ipOf("edge")).toBe("5.6.7.8"); // 정확히 3개월 = 아직 보관
    expect(ipOf("recent")).toBe("9.9.9.9");
    expect(h.rows).toHaveLength(6); // 행은 지우지 않는다
  });

  it("멱등: 두 번째 실행은 0건", async () => {
    await purgeExpiredIpAddresses(memClient(), NOW);
    const snapshot = structuredClone(h.rows);
    const again = await purgeExpiredIpAddresses(memClient(), NOW);
    expect(again.cleared).toBe(0);
    expect(h.rows).toEqual(snapshot);
  });
});

describe("cron 라우트 — 진짜 CRON_SECRET 검사", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  const call = (auth?: string) =>
    GET(
      new Request("https://www.test/api/cron/purge-expired-ip", {
        headers: auth ? { authorization: auth } : {},
      }) as never
    );

  it("비밀값이 맞으면 정리하고 건수를 돌려준다", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.VERCEL_ENV = "production";
    const res = await call("Bearer s3cret");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cleared: number };
    expect(typeof body.cleared).toBe("number");
    expect(h.calls).toBe(1);
  });

  it.each([
    ["헤더 없음", undefined],
    ["틀린 값", "Bearer nope"],
  ])("⛔ %s 이면 401 이고 DB 를 건드리지 않는다", async (_name, auth) => {
    process.env.CRON_SECRET = "s3cret";
    process.env.VERCEL_ENV = "production";
    const res = await call(auth);
    expect(res.status).toBe(401);
    expect(h.calls).toBe(0);
  });

  it("⛔ Preview 배포에서는 403 이고 DB 를 건드리지 않는다", async () => {
    process.env.CRON_SECRET = "s3cret";
    process.env.VERCEL_ENV = "preview";
    const res = await call("Bearer s3cret");
    expect(res.status).toBe(403);
    expect(h.calls).toBe(0);
  });
});

describe("배포 설정", () => {
  it("vercel.json 에 매일 일정이 있고 라우트의 하트비트 일정과 같다", () => {
    const config = JSON.parse(
      readFileSync(join(import.meta.dirname, "../vercel.json"), "utf8")
    ) as { crons?: Array<{ path: string; schedule: string }> };
    const cron = config.crons?.find(
      (c) => c.path === "/api/cron/purge-expired-ip"
    );
    expect(cron?.schedule).toBe("30 16 * * *");
    const route = readFileSync(
      join(import.meta.dirname, "../app/api/cron/purge-expired-ip/route.ts"),
      "utf8"
    );
    expect(route).toContain(`"${cron?.schedule}"`);
    expect(route).toContain("denyIfNotCron");
  });
});
