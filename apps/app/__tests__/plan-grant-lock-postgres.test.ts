/** @vitest-environment node */

// P1-4 — plan-grant 의 사용자별 advisory lock 이 실제 PostgreSQL + Prisma 어댑터에서
// 동작하고(SQL 형식), 같은 사용자의 동시 읽기→쓰기를 직렬화하는지 확인한다.
// Clerk 는 지연 쓰기를 가진 메모리 더블. 운영/공유 DB 는 쓰지 않는다(initdb 임시 클러스터만).

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@repo/database/generated/client";
import { PrismaPg } from "@repo/database/node_modules/@prisma/adapter-pg/dist/index.mjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const USER_ID = "user_pg-race-1";
const OLD_ID = "fdbl-starter-pg-race-1-old";
const NEW_ID = "fdbl-growth-pg-race-1-new";

const state = vi.hoisted(() => ({
  database: null as unknown,
  user: {
    publicMetadata: {} as Record<string, unknown>,
    privateMetadata: {} as Record<string, unknown>,
  },
}));
vi.mock("@repo/database", () => ({
  get database() {
    return state.database;
  },
}));
vi.mock(
  "../../../packages/auth/node_modules/@clerk/nextjs/dist/esm/server/index.js",
  () => ({
    clerkClient: async () => ({
      users: {
        getUser: async () => ({
          id: USER_ID,
          publicMetadata: structuredClone(state.user.publicMetadata),
          privateMetadata: structuredClone(state.user.privateMetadata),
        }),
        updateUserMetadata: async (
          _id: string,
          patch: {
            privateMetadata: Record<string, unknown>;
            publicMetadata: Record<string, unknown>;
          }
        ) => {
          // The expiry (writes plan "free") is the slow writer.
          const delay = patch.publicMetadata.plan === "free" ? 500 : 0;
          await new Promise((resolve) => setTimeout(resolve, delay));
          state.user.publicMetadata = {
            ...state.user.publicMetadata,
            ...patch.publicMetadata,
          };
          state.user.privateMetadata = {
            ...state.user.privateMetadata,
            ...patch.privateMetadata,
          };
          return {};
        },
      },
    }),
  })
);

const tempDir = mkdtempSync("/tmp/findable-plan-lock-pg-");
const socketDir = join(tempDir, "socket");
const port = 18_400 + Math.floor(Math.random() * 500);
const role = execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
const connectionString = `postgresql://${role}@127.0.0.1:${port}/postgres?application_name=findable_plan_lock`;
let serverStarted = false;
let database: PrismaClient;
const pgEnv = { ...process.env, LC_ALL: "C", LANG: "C" };
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

beforeAll(() => {
  startDatabase();
  database = new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: 4 }),
  });
  state.database = database;
});

afterAll(async () => {
  await database?.$disconnect();
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

describe("plan-grant advisory lock on real PostgreSQL [P1-4]", () => {
  it("serializes a concurrent expiry and grant so the grant survives", async () => {
    state.user.publicMetadata = { plan: "starter" };
    state.user.privateMetadata = {
      findablePaymentId: OLD_ID,
      findablePaymentGrantStack: [
        { paymentId: OLD_ID, plan: "starter" },
        { paymentId: null, plan: "free" },
      ],
    };
    // Warm the pool so both transactions really overlap.
    await Promise.all(
      Array.from({ length: 4 }, () =>
        database.$transaction((tx) => tx.$executeRaw`SELECT 1`)
      )
    );
    const { expirePaymentGrants, grantPlanFromPayment } = await import(
      "@repo/auth/plan-grant"
    );
    const [expired, granted] = await Promise.all([
      expirePaymentGrants(USER_ID, (id) => id === OLD_ID),
      grantPlanFromPayment(USER_ID, "growth", NEW_ID),
    ]);
    expect(expired.reason).toBe("expired");
    expect(granted).toBe(true);
    expect(state.user.publicMetadata.plan).toBe("growth");
    expect(state.user.privateMetadata.findablePaymentId).toBe(NEW_ID);
  });
});
