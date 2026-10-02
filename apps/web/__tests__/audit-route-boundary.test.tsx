import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
  after: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  createJob: vi.fn(),
  updateJob: vi.fn(),
  createLead: vi.fn(),
  reconcile: vi.fn(),
  runAudit: vi.fn(),
  runCrew: vi.fn(),
  runBriefing: vi.fn(),
  streamChat: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  Prisma: { DbNull: Symbol("DbNull") },
  database: {
    auditJob: {
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
      findMany: mocks.findMany,
      count: mocks.count,
      create: mocks.createJob,
      update: mocks.updateJob,
    },
    lead: { create: mocks.createLead },
  },
}));
vi.mock("@repo/auth/server", () => ({
  auth: mocks.auth,
  currentUser: mocks.currentUser,
}));
vi.mock("@repo/observability/error", () => ({
  parseError: (error: unknown) => String(error),
}));
vi.mock("@repo/observability/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/server")>();
  return { ...original, after: mocks.after };
});
vi.mock("botid/server", () => ({ checkBotId: () => ({ isBot: false }) }));
vi.mock("@repo/audit/runner", () => ({ runAuditJob: mocks.runAudit }));
vi.mock("@repo/audit/stale-job", () => ({
  reconcileStaleAuditJob: mocks.reconcile,
}));
vi.mock("@repo/audit/crew-runner", () => ({
  runCrewForAuditJob: mocks.runCrew,
}));
vi.mock("@repo/audit/briefing-runner", () => ({
  runBriefingForAuditJob: mocks.runBriefing,
}));
vi.mock("@repo/ai/lib/crew", () => ({
  isCopilotConfigured: () => true,
  streamCopilotResponse: mocks.streamChat,
}));
vi.mock("@repo/email", () => ({
  resend: { emails: { send: mocks.sendEmail } },
}));
vi.mock("@repo/email/templates/audit-report", () => ({
  AuditReportEmail: () => null,
}));
vi.mock("@repo/audit/normalize-stored-metrics", () => ({
  withRecomputedAuditMetrics: (result: unknown) => result,
  isPublishableAuditResult: () => true,
  auditPublicationIssue: () => null,
  publicAuditResult: (result: unknown) => result,
  hasStaleAuditPdf: () => false,
}));
vi.mock("next/og", () => ({
  ImageResponse: class {
    element: React.ReactElement;
    constructor(element: React.ReactElement) {
      this.element = element;
    }
  },
}));
vi.mock("@repo/seo/metadata", () => ({ createMetadata: () => ({}) }));
vi.mock("../app/[locale]/audit/[jobId]/components/audit-result", () => ({
  AuditResultView: () => null,
}));
vi.mock("../app/[locale]/audit/[jobId]/components/audit-summary-ssr", () => ({
  AuditSummarySsr: ({ job }: { job: { domain: string } }) => (
    <span data-testid="ssr-summary">{job.domain}</span>
  ),
}));

import AuditResultPage from "../app/[locale]/audit/[jobId]/page";
import { POST as runBriefing } from "../app/api/audit/[jobId]/briefing/route";
import { POST as chat } from "../app/api/audit/[jobId]/chat/route";
import { POST as runCrew } from "../app/api/audit/[jobId]/crew/route";
import { POST as sendLead } from "../app/api/audit/[jobId]/lead/route";
import { GET as pollAudit } from "../app/api/audit/[jobId]/route";
import { POST as createAudit } from "../app/api/audit/route";
import { GET as auditOg } from "../app/api/og/audit/[jobId]/route";

const jobId = "11111111-1111-4111-8111-111111111111";
const params = { params: Promise.resolve({ jobId }) };
const request = (body?: unknown) =>
  new Request(`https://findable.example/api/audit/${jobId}`, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const privateJob = {
  id: jobId,
  email: "org:owner-org",
  organizationId: "owner-org",
  domain: "private.example",
  language: "ko",
  status: "completed",
  result: {
    brandName: "Secret",
    metrics: {
      sov: 80,
      enginesCovered: ["openai"],
      enginesWithMention: ["openai"],
      sentimentDistribution: { positive: 1, neutral: 0, negative: 0 },
      averageMentionPosition: 1,
      topCitedDomains: [],
    },
  },
  crewStatus: "completed",
  crewResult: { analysts: [], strategist: {} },
  createdAt: new Date("2026-10-01T00:00:00Z"),
  completedAt: new Date("2026-10-01T00:01:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: null, orgId: null });
  mocks.currentUser.mockResolvedValue(null);
  mocks.findUnique.mockResolvedValue(privateJob);
  mocks.findFirst.mockResolvedValue(null);
  mocks.findMany.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
  mocks.createJob.mockResolvedValue({
    id: "new-free-job",
    status: "queued",
    createdAt: new Date(),
  });
  mocks.createLead.mockResolvedValue({});
  mocks.reconcile.mockResolvedValue(null);
  mocks.streamChat.mockReturnValue(Response.json({ ok: true }));
});

describe("audit route tenant boundary", () => {
  test("POST misses same-domain private cache and creates a free job", async () => {
    // Model the database matching an org row only when the route omits either exclusion.
    mocks.findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if (where.status !== "completed") {
          return null;
        }
        return where.organizationId === null &&
          JSON.stringify(where.NOT).includes('"startsWith":"org:"')
          ? null
          : { id: jobId };
      }
    );
    const response = await createAudit(
      request({
        email: "free@example.com",
        domain: "private.example",
        language: "ko",
      }) as never
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ jobId: "new-free-job" });
    expect(mocks.createJob).toHaveBeenCalledOnce();
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  test("POST still reuses a completed public free job", async () => {
    mocks.findFirst.mockResolvedValue({ id: "public-free-job" });
    const response = await createAudit(
      request({
        email: "another@example.com",
        domain: "public.example",
        language: "ko",
      }) as never
    );
    expect(await response.json()).toMatchObject({
      jobId: "public-free-job",
      cached: true,
    });
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  describe.each([
    ["anonymous", null, null, privateJob],
    ["other active org", "other-org", "viewer@example.com", privateJob],
    ["SetNull org marker", null, null, { ...privateJob, organizationId: null }],
  ])("%s", (_label, orgId, email, job) => {
    beforeEach(() => {
      mocks.findUnique.mockResolvedValue(job);
      if (orgId || email) {
        mocks.auth.mockResolvedValue({ userId: "viewer", orgId });
        mocks.currentUser.mockResolvedValue({
          primaryEmailAddressId: "primary",
          emailAddresses: [{ id: "primary", emailAddress: email }],
        });
      }
    });

    test.each([
      ["GET", () => pollAudit(request() as never, params)],
      [
        "lead",
        () => sendLead(request({ email: "recipient@example.com" }), params),
      ],
      [
        "crew",
        () => {
          mocks.findUnique.mockResolvedValueOnce({
            ...job,
            crewStatus: "not_requested",
          });
          return runCrew(request({}) as never, params);
        },
      ],
      ["briefing", () => runBriefing(request({}) as never, params)],
      [
        "chat",
        () =>
          chat(
            request({
              messages: [{ role: "user", content: "What changed?" }],
            }) as never,
            params
          ),
      ],
    ])("%s returns 403 before side effects", async (_route, call) => {
      const response = await call();
      expect(response.status).toBe(403);
      expect(mocks.reconcile).not.toHaveBeenCalled();
      expect(mocks.findMany).not.toHaveBeenCalled();
      expect(mocks.createLead).not.toHaveBeenCalled();
      expect(mocks.updateJob).not.toHaveBeenCalled();
      expect(mocks.count).not.toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
      expect(mocks.sendEmail).not.toHaveBeenCalled();
      expect(mocks.streamChat).not.toHaveBeenCalled();
    });

    test("SSR omits private summary", async () => {
      const html = renderToStaticMarkup(
        await AuditResultPage({
          params: Promise.resolve({ locale: "ko", jobId }),
        })
      );
      expect(html).not.toContain("private.example");
      expect(html).not.toContain('data-testid="ssr-summary"');
    });

    test("OG preview cannot embed private brand or domain", async () => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => pollAudit(request() as never, params));
      try {
        const image = await auditOg(request(), params);
        const html = renderToStaticMarkup(
          (image as unknown as { element: React.ReactElement }).element
        );
        expect(html).not.toContain("Secret");
        expect(html).not.toContain("private.example");
        expect(fetchMock).toHaveBeenCalledOnce();
      } finally {
        fetchMock.mockRestore();
      }
    });
  });

  test("owner can poll workspace result and render SSR summary", async () => {
    mocks.auth.mockResolvedValue({ userId: "owner", orgId: "owner-org" });
    mocks.currentUser.mockResolvedValue({
      primaryEmailAddressId: "primary",
      emailAddresses: [],
    });
    const response = await pollAudit(request() as never, params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      domain: "private.example",
      isWorkspaceAudit: true,
    });
    const html = renderToStaticMarkup(
      await AuditResultPage({
        params: Promise.resolve({ locale: "ko", jobId }),
      })
    );
    expect(html).toContain("private.example");
  });

  test("free result remains link-readable without login", async () => {
    mocks.findUnique.mockResolvedValue({
      ...privateJob,
      email: "free@example.com",
      organizationId: null,
    });
    const response = await pollAudit(request() as never, params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      domain: "private.example",
      isWorkspaceAudit: false,
    });
    const html = renderToStaticMarkup(
      await AuditResultPage({
        params: Promise.resolve({ locale: "ko", jobId }),
      })
    );
    expect(html).toContain("private.example");
  });

  test("SetNull legacy org marker remains readable by its active org", async () => {
    mocks.findUnique.mockResolvedValue({ ...privateJob, organizationId: null });
    mocks.auth.mockResolvedValue({ userId: "owner", orgId: "owner-org" });
    mocks.currentUser.mockResolvedValue({
      primaryEmailAddressId: "primary",
      emailAddresses: [],
    });
    const response = await pollAudit(request() as never, params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ domain: "private.example" });
  });
});
