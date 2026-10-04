/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Vercel Preview must never run crons (measurements, sweeps, newsletter
// sends) against whatever database it is wired to, and must never email.
// Every route below runs the REAL @repo/security/cron guard; the database,
// mailer and runner are tripwires that fail the test if touched.
const h = vi.hoisted(() => {
  const touched: string[] = [];
  const tripwire = (name: string): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key) => {
        if (key === "then") {
          return;
        }
        touched.push(`${name}.${String(key)}`);
        return tripwire(`${name}.${String(key)}`);
      },
      apply: () => {
        touched.push(`${name}()`);
        throw new Error(`TOUCHED ${name}`);
      },
    });
  return { touched, tripwire };
});

vi.mock("@repo/database", () => ({
  database: h.tripwire("database"),
  Prisma: h.tripwire("Prisma"),
}));
vi.mock("@repo/email", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resend: h.tripwire("resend"),
}));
vi.mock("@repo/audit/sweep-audit-tracking", () => ({
  sweepAuditTrackingReconciliation: h.tripwire("sweep"),
}));
// A QStash signature that always verifies: the Preview refusal must not rely
// on the signature check failing.
vi.mock("@upstash/qstash", () => ({
  Receiver: class {
    verify() {
      return Promise.resolve(true);
    }
  },
}));
vi.mock("@/lib/indexnow", () => ({ submitToIndexNow: h.tripwire("indexnow") }));

import { createResendClient } from "@repo/email";
import { denyIfNotCron, denyIfVercelPreview } from "@repo/security/cron";
import { GET as autoRefreshRetired } from "../app/api/cron/auto-refresh-tracking/route";
import { GET as contentPublishing } from "../app/api/cron/content-publishing/route";
import { GET as dailyOpsDigest } from "../app/api/cron/daily-ops-digest/route";
import { GET as sweepStuckJobs } from "../app/api/cron/sweep-stuck-jobs/route";

const SECRET = "test-cron-secret";
const cronRequest = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://preview.example${path}`, {
    headers: { authorization: `Bearer ${SECRET}`, ...headers },
  }) as never;

beforeEach(() => {
  h.touched.length = 0;
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("VERCEL_ENV", "preview");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cron routes on Vercel Preview", () => {
  it("refuses with 403 even when the cron secret is valid", () => {
    expect(denyIfVercelPreview({ VERCEL_ENV: "preview" })?.status).toBe(403);
    expect(denyIfVercelPreview({ VERCEL_ENV: "production" })).toBeNull();
    expect(denyIfNotCron(cronRequest("/api/cron/x"))?.status).toBe(403);
  });

  it("keeps the normal secret check outside Preview", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(denyIfNotCron(cronRequest("/api/cron/x"))).toBeNull();
    expect(
      denyIfNotCron(
        new Request("https://x/api/cron/x", {
          headers: { authorization: "Bearer wrong" },
        })
      )?.status
    ).toBe(401);
  });

  it.each([
    ["sweep-stuck-jobs", sweepStuckJobs],
    ["daily-ops-digest", dailyOpsDigest],
    ["auto-refresh-tracking (retired)", autoRefreshRetired],
    ["content-publishing", contentPublishing],
  ] as const)("%s answers 403 without touching DB, mail or runner", async (name, GET) => {
    const response = await GET(cronRequest(`/api/cron/${name}`));
    expect(response.status).toBe(403);
    expect(h.touched).toEqual([]);
  });

  it("content-publishing refuses a valid QStash-signed call on Preview too", async () => {
    vi.stubEnv("QSTASH_CURRENT_SIGNING_KEY", "k1");
    vi.stubEnv("QSTASH_NEXT_SIGNING_KEY", "k2");
    const response = await contentPublishing(
      cronRequest("/api/cron/content-publishing", {
        "upstash-signature": "sig",
      })
    );
    expect(response.status).toBe(403);
    expect(h.touched).toEqual([]);
  });
});

describe("outbound email on Vercel Preview", () => {
  it("has no Resend client on Preview even with a token", () => {
    expect(
      createResendClient("re_test_token", { VERCEL_ENV: "preview" })
    ).toBeUndefined();
  });

  it("keeps the client in production and local dev when a token exists", () => {
    expect(
      createResendClient("re_test_token", { VERCEL_ENV: "production" })
    ).toBeDefined();
    expect(createResendClient("re_test_token", {})).toBeDefined();
    expect(createResendClient(undefined, {})).toBeUndefined();
  });
});
