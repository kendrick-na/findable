/** @vitest-environment node */

// RefundRequest · RenewalNotice — 일회용 PostgreSQL 위에서 실제 Prisma 어댑터 오류 코드로
// ① migration 적용 전(테이블 없음) 내성 ② 적용 후 기록·예약 결제당 1통을 검증한다.
// Organization·User 는 대역(전체 스키마 없이 새 테이블만 만든다). 운영/공유 DB 는 쓰지 않는다.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@repo/database/generated/client";
import { PrismaPg } from "@repo/database/node_modules/@prisma/adapter-pg/dist/index.mjs";
import { buildPaymentId } from "@repo/payments/catalog";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-10-05T00:00:00.000Z");
const DUE = new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000);
const NEXT_PAYMENT_ID = buildPaymentId(
  "starter",
  "user_payer-1",
  DUE.getTime()
);

const state = vi.hoisted(() => ({
  database: null as unknown,
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  captureOpsAlert: vi.fn(),
}));
vi.mock("@repo/database", () => ({
  get database() {
    return state.database;
  },
}));
vi.mock("@repo/observability/log", () => ({ log: state.log }));
vi.mock("@repo/observability/ops-alert", () => ({
  captureOpsAlert: state.captureOpsAlert,
}));
vi.mock("@repo/observability/error", () => ({
  parseError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
// The pg config has no JSX transform; the template itself is covered by renewal-notice.test.ts.
vi.mock("@repo/email/templates/renewal-notice", () => ({
  RenewalNoticeEmail: () => null,
}));
vi.mock("@repo/auth/server", () => ({
  auth: () => Promise.resolve({ userId: "user_payer-1", orgId: "org-1" }),
}));

const tempDir = mkdtempSync("/tmp/findable-refund-renewal-pg-");
const socketDir = join(tempDir, "socket");
const port = 18_400 + Math.floor(Math.random() * 500);
const role = execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
const connectionString = `postgresql://${role}@127.0.0.1:${port}/postgres?application_name=findable_refund_renewal`;
let serverStarted = false;
let prisma: PrismaClient;
const pgEnv = { ...process.env, LC_ALL: "C", LANG: "C" };
const readMigration = (name: string) =>
  readFileSync(
    fileURLToPath(
      new URL(
        `../../../packages/database/prisma/migrations/${name}/migration.sql`,
        import.meta.url
      )
    ),
    "utf8"
  );

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8", env: pgEnv });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }
}

function startDatabase() {
  run("initdb", ["-D", tempDir, "-A", "trust", "--no-locale"]);
  mkdirSync(socketDir);
  run("pg_ctl", [
    "-D",
    tempDir,
    "-o",
    `-p ${port} -k ${socketDir}`,
    "-l",
    join(tempDir, "postgres.log"),
    "start",
  ]);
  serverStarted = true;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (
      spawnSync("pg_isready", ["-h", "127.0.0.1", "-p", String(port)])
        .status === 0
    ) {
      return;
    }
  }
  throw new Error("PostgreSQL readiness timed out");
}

const fakeOrganization = {
  findUnique: () =>
    Promise.resolve({ billingLastPaymentId: "fdbl-starter-payer-1-mg0x1a2b" }),
  findMany: () =>
    Promise.resolve([
      {
        id: "org-1",
        billingNextPaymentId: NEXT_PAYMENT_ID,
        billingNextPaymentAt: DUE,
      },
    ]),
};
const fakeUser = {
  findUnique: () => Promise.resolve({ email: "payer@example.test" }),
};

const mailer = () => {
  const send = vi.fn(() => Promise.resolve({ data: { id: "e" }, error: null }));
  return { send, client: { emails: { send } } };
};

const renewalRun = async (client: ReturnType<typeof mailer>["client"]) => {
  const { sendRenewalNotices } = await import("@/lib/billing/renewal-notice");
  return sendRenewalNotices({
    now: NOW,
    client,
    from: "billing@findable.test",
    appUrl: "https://app.findable.test",
    termsUrl: "https://findable.test/ko/legal/terms",
    env: { FINDABLE_RENEWAL_NOTICE_ENABLED: "true" },
  });
};

beforeAll(() => {
  startDatabase();
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: 2 }),
  });
  state.database = {
    organization: fakeOrganization,
    user: fakeUser,
    refundRequest: prisma.refundRequest,
    renewalNotice: prisma.renewalNotice,
  };
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (serverStarted) {
    spawnSync(
      "pg_ctl",
      [
        "-D",
        tempDir,
        "-o",
        `-p ${port} -k ${socketDir}`,
        "stop",
        "-m",
        "immediate",
      ],
      { stdio: "ignore" }
    );
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("RefundRequest · RenewalNotice on real PostgreSQL", () => {
  it("before the migrations: no false confirmation, no email", async () => {
    const { requestRefund } = await import(
      "@/app/actions/billing/refund-request"
    );
    const refund = await requestRefund({ message: "철회" });
    expect(refund.ok).toBe(false);
    expect(state.captureOpsAlert).toHaveBeenCalledWith(
      expect.stringContaining("저장 실패"),
      expect.objectContaining({ tableMissing: true })
    );

    const { send, client } = mailer();
    const renewal = await renewalRun(client);
    expect(renewal.status).toBe("ledger_missing");
    expect(send).not.toHaveBeenCalled();
  });

  it("after the migrations: request recorded once; one notice per scheduled payment", async () => {
    await prisma.$executeRawUnsafe(readMigration("20261005_refund_request"));
    await prisma.$executeRawUnsafe(readMigration("20261005_renewal_notice"));
    const { requestRefund } = await import(
      "@/app/actions/billing/refund-request"
    );
    expect(await requestRefund({ message: "철회" })).toEqual({
      ok: true,
      status: "created",
    });
    expect(await requestRefund({})).toEqual({
      ok: true,
      status: "already_pending",
    });
    const requests = await prisma.refundRequest.findMany();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      organizationId: "org-1",
      userId: "user_payer-1",
      paymentId: "fdbl-starter-payer-1-mg0x1a2b",
      status: "pending",
    });

    const { send, client } = mailer();
    // Concurrent runs converge on one email (unique paymentId claim).
    const runs = await Promise.all([renewalRun(client), renewalRun(client)]);
    expect(runs.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await renewalRun(client)).sent).toBe(0);
    const notices = await prisma.renewalNotice.findMany();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      paymentId: NEXT_PAYMENT_ID,
      organizationId: "org-1",
      userId: "user_payer-1",
      scheduledAt: DUE,
    });
  });
});
