/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The app auto-refresh cron runs paid measurements AND billing expiry. On a
// Vercel Preview it must refuse before touching either, even with a valid
// CRON_SECRET. Uses the REAL @repo/security/cron guard; everything with a
// side effect is a spy that must stay untouched.
const m = vi.hoisted(() => ({
  runAuditJob: vi.fn(),
  orgUpdateMany: vi.fn(),
  orgFindMany: vi.fn(),
  auditJobCreate: vi.fn(),
  expireRenewal: vi.fn(),
  expireCancelled: vi.fn(),
  expireOneOff: vi.fn(),
  loadOrgs: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  database: {
    organization: { updateMany: m.orgUpdateMany, findMany: m.orgFindMany },
    auditJob: { create: m.auditJobCreate },
  },
}));
vi.mock("@repo/audit/runner", () => ({ runAuditJob: m.runAuditJob }));
vi.mock("@repo/auth/server", () => ({ clerkClient: vi.fn() }));
vi.mock("@repo/email", () => ({ resend: undefined }));
vi.mock("@repo/email/templates/tracking-digest", () => ({
  TrackingDigestEmail: vi.fn(),
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/env", () => ({ env: {} }));
vi.mock("@/lib/billing/renewal-grace", () => ({
  expireLapsedRenewalGrants: m.expireRenewal,
}));
vi.mock("@/lib/billing/period-end-expiry", () => ({
  expireCancelledSubscriptions: m.expireCancelled,
  expireOneOffPaymentGrants: m.expireOneOff,
}));
vi.mock("@/lib/billing/auto-refresh-eligibility", () => ({
  loadAutoRefreshOrganizations: m.loadOrgs,
}));

import { GET } from "../app/api/cron/auto-refresh-tracking/route";

const SECRET = "test-cron-secret";
const request = () =>
  new Request("https://preview.example/api/cron/auto-refresh-tracking", {
    headers: { authorization: `Bearer ${SECRET}` },
  }) as never;

beforeEach(() => {
  for (const spy of Object.values(m)) {
    spy.mockReset();
  }
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("VERCEL_ENV", "preview");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("app auto-refresh cron on Vercel Preview", () => {
  it("answers 403 with no measurement, billing expiry or DB write", async () => {
    const response = await GET(request());
    expect(response.status).toBe(403);
    for (const spy of Object.values(m)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
