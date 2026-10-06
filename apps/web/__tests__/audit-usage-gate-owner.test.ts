/**
 * P2-3: the usage-gate 429 returned existingJobId for any email+domain, so
 * anyone who knew (or guessed) a customer's email and domain got a link to
 * that customer's free result. Only the job's owner may receive it.
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  isOwner: vi.fn(),
}));

vi.mock("botid/server", () => ({
  checkBotId: vi.fn(async () => ({ isBot: false })),
}));
vi.mock("@repo/database", () => ({
  Prisma: {},
  database: {
    auditJob: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      findFirst: fx.findFirst,
      findUnique: fx.findUnique,
      create: vi.fn(),
    },
    lead: { create: vi.fn(async () => ({})) },
  },
}));
vi.mock("@repo/audit/runner", () => ({ runAuditJob: vi.fn() }));
vi.mock("@repo/audit/stale-job", () => ({
  isStaleAuditJob: vi.fn(() => false),
  reconcileStaleAuditJob: vi.fn(),
}));
vi.mock("@/app/api/audit/_lib/owner", () => ({ resolveIsOwner: fx.isOwner }));
vi.mock("@repo/observability/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const EXISTING = {
  id: "job-existing-1",
  email: "victim@example.com",
  domain: "victim.example",
  organizationId: null,
  status: "completed",
  createdAt: new Date(),
};

async function submit() {
  const { POST } = await import("@/app/api/audit/route");
  return POST(
    new NextRequest("http://localhost/api/audit", {
      method: "POST",
      body: JSON.stringify({
        email: "victim@example.com",
        domain: "victim.example",
      }),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // 👤 2026-10-07 — 공개 무료 진단은 기본 꺼짐(`FREE_AUDIT_PUBLIC_ENABLED`).
  //   이 파일은 「켜져 있을 때」의 사용량 게이트(429)를 검증하므로 켠 상태로 돈다.
  vi.stubEnv("FREE_AUDIT_PUBLIC_ENABLED", "true");
  // 1st findFirst = domain cache (miss), 2nd = usage gate (recent job).
  fx.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(EXISTING);
  fx.findUnique.mockResolvedValue({
    email: EXISTING.email,
    organizationId: EXISTING.organizationId,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public free audit OFF (FREE_AUDIT_PUBLIC_ENABLED unset)", () => {
  it("returns 404 before the usage gate and never touches the database", async () => {
    vi.stubEnv("FREE_AUDIT_PUBLIC_ENABLED", "");
    const response = await submit();
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("existingJobId");
    expect(fx.findFirst).not.toHaveBeenCalled();
    expect(fx.findUnique).not.toHaveBeenCalled();
    expect(fx.isOwner).not.toHaveBeenCalled();
  });
});

describe("usage-gate 429 does not leak another person's result [P2-3]", () => {
  it("omits existingJobId when the caller is not the job owner", async () => {
    fx.isOwner.mockResolvedValue(false);
    const response = await submit();
    expect(response.status).toBe(429);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toEqual(expect.any(String));
    expect(body).not.toHaveProperty("existingJobId");
  });

  it("control: the owner still gets the link to their existing result", async () => {
    fx.isOwner.mockResolvedValue(true);
    const response = await submit();
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      existingJobId: EXISTING.id,
    });
    expect(fx.isOwner).toHaveBeenCalledWith({
      email: EXISTING.email,
      organizationId: EXISTING.organizationId,
    });
  });
});
