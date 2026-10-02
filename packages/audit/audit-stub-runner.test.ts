import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Drives the real runAuditJob in FINDABLE_AUDIT_STUB_MODE against an
// in-memory AuditJob row. Every paid or network entry point is replaced by a
// spy that throws, so any leak fails the run and is counted.
type Row = Record<string, unknown>;
const h = vi.hoisted(() => {
  const matches = (
    row: Record<string, unknown>,
    where: Record<string, unknown>
  ): boolean =>
    Object.entries(where).every(([key, cond]) => {
      const value = row[key] ?? null;
      if (cond === null) {
        return value === null;
      }
      if (typeof cond === "object" && !(cond instanceof Date)) {
        const op = cond as { gt?: Date; lt?: Date };
        if (!(value instanceof Date)) {
          return false;
        }
        return (
          (!op.gt || value.getTime() > op.gt.getTime()) &&
          (!op.lt || value.getTime() < op.lt.getTime())
        );
      }
      return value === cond;
    });
  const DB_NULL = Symbol("DbNull");
  const apply = (
    row: Record<string, unknown>,
    data: Record<string, unknown>
  ) => {
    for (const [key, value] of Object.entries(data)) {
      row[key] = value === DB_NULL ? null : value;
    }
  };
  const paid = (name: string) =>
    Object.assign(
      (..._args: unknown[]) => Promise.reject(new Error(`PAID CALL: ${name}`)),
      { label: name }
    );
  return {
    DB_NULL,
    matches,
    apply,
    rows: new Map<string, Row>(),
    queryAllEngines: vi.fn(paid("queryAllEngines")),
    verifyMentions: vi.fn(paid("verifyMentions")),
    resolveBrandIdentity: vi.fn(paid("resolveBrandIdentity")),
    resolveOfficialSiteIdentity: vi.fn(paid("resolveOfficialSiteIdentity")),
    generateAuditPdf: vi.fn(paid("generateAuditPdf")),
    runBriefingForAuditJob: vi.fn(paid("runBriefingForAuditJob")),
    persistAuditTracking: vi.fn(() => Promise.resolve("skipped")),
  };
});

vi.mock("@repo/database", () => ({
  Prisma: { DbNull: h.DB_NULL },
  database: {
    auditJob: {
      updateMany: ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const row of h.rows.values()) {
          if (h.matches(row, where)) {
            h.apply(row, data);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
      update: ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = h.rows.get(where.id) as Row;
        h.apply(row, data);
        return Promise.resolve(row);
      },
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(h.rows.get(where.id) ?? null),
      findFirst: ({ where }: { where: Row }) =>
        Promise.resolve(
          [...h.rows.values()].find((row) => h.matches(row, where)) ?? null
        ),
    },
  },
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@repo/ai/lib/engines", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  queryAllEngines: h.queryAllEngines,
}));
vi.mock("@repo/ai/lib/mention-verdict", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  verifyMentions: h.verifyMentions,
}));
vi.mock("@repo/ai/lib/brand-identity", () => ({
  resolveBrandIdentity: h.resolveBrandIdentity,
}));
vi.mock("./official-site-identity", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveOfficialSiteIdentity: h.resolveOfficialSiteIdentity,
}));
vi.mock("./pdf-generator", () => ({ generateAuditPdf: h.generateAuditPdf }));
vi.mock("./briefing-runner", () => ({
  runBriefingForAuditJob: h.runBriefingForAuditJob,
}));
vi.mock("./tracking", () => ({
  persistAuditTracking: h.persistAuditTracking,
}));

import {
  AUDIT_STUB_MARKER,
  liveAuditAi,
  selectAuditAi,
  stubAuditAi,
} from "./audit-stub";
import { makeAuditCheckpoint } from "./checkpoint";
import { runAuditJob } from "./runner";

const input = {
  jobId: "job-1",
  domain: "example.com",
  brandName: "Example",
  language: "both" as const,
};
const createdAt = new Date();
const seedJob = (extra: Row = {}) =>
  h.rows.set("job-1", {
    id: "job-1",
    email: "lead@example.com",
    domain: "example.com",
    brandId: null,
    status: "queued",
    createdAt,
    attemptStartedAt: null,
    leaseToken: null,
    leaseUntil: null,
    checkpoint: null,
    ...extra,
  });
const job = () => h.rows.get("job-1") as Row;
const paidSpies = () => [
  h.queryAllEngines,
  h.verifyMentions,
  h.resolveBrandIdentity,
  h.resolveOfficialSiteIdentity,
  h.generateAuditPdf,
  h.runBriefingForAuditJob,
];

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  h.rows.clear();
  for (const spy of paidSpies()) {
    spy.mockClear();
  }
  fetchSpy = vi.fn(() => Promise.reject(new Error("NETWORK CALL")));
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("FINDABLE_AUDIT_STUB_MODE", "1");
  vi.stubEnv("VERCEL_ENV", "preview");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Names of every paid/network entry point that was touched (should be []). */
const leakedCalls = () => [
  ...paidSpies()
    .filter((spy) => spy.mock.calls.length > 0)
    .map((spy) => spy.getMockName()),
  ...(fetchSpy.mock.calls.length > 0 ? ["fetch"] : []),
];

describe("FINDABLE_AUDIT_STUB_MODE selection", () => {
  it("keeps the exact live functions when the flag is absent or not '1'", () => {
    expect(selectAuditAi({})).toBe(liveAuditAi);
    expect(selectAuditAi({ FINDABLE_AUDIT_STUB_MODE: "true" })).toBe(
      liveAuditAi
    );
    expect(liveAuditAi.queryAllEngines).toBe(h.queryAllEngines);
    expect(liveAuditAi.verifyMentions).toBe(h.verifyMentions);
    expect(liveAuditAi.resolveBrandIdentity).toBe(h.resolveBrandIdentity);
    expect(liveAuditAi.resolveOfficialSiteIdentity).toBe(
      h.resolveOfficialSiteIdentity
    );
  });

  it("refuses the flag on Vercel production", () => {
    expect(() =>
      selectAuditAi({
        FINDABLE_AUDIT_STUB_MODE: "1",
        VERCEL_ENV: "production",
      })
    ).toThrow("not allowed in production");
  });
});

describe("runAuditJob in stub mode", () => {
  it("completes a full measurement with zero adapter or network calls", async () => {
    seedJob();
    await runAuditJob(input);

    expect(leakedCalls()).toEqual([]);
    expect(job().errorMessage ?? null).toBeNull();
    expect(job().status).toBe("completed");
    expect(job().checkpoint).toBeNull();
    const result = job().result as {
      engineResponses: { rawResponse?: string; excerpt?: string }[];
      measurementContext: { stubMode?: boolean };
    };
    expect(result.measurementContext.stubMode).toBe(true);
    expect(result.engineResponses.length).toBeGreaterThan(0);
    expect(job().postprocessing).toMatchObject({
      pdf: "skipped",
      briefing: "skipped",
    });
  });

  it("resumes a stub checkpoint and pays only the unfinished questions", async () => {
    const checkpoint = makeAuditCheckpoint(
      { domain: "example.com", language: "both" },
      {
        brandName: "Example",
        brandVariants: [],
        identityGrounded: true,
        officialSiteIdentity: {
          finalUrl: "https://example.com/",
          title: "Example",
          description: null,
          h1: null,
          siteName: null,
        },
      },
      [
        { text: "q1", lang: "ko", kind: "brand" },
        { text: "q2", lang: "en", kind: "brand" },
        { text: "q3", lang: "ko", kind: "discovery" },
      ],
      createdAt.toISOString()
    );
    const done = await Promise.all(
      [0, 1].map((index) =>
        stubAuditAi.queryAllEngines(
          {
            prompt: checkpoint.prompts[index].text,
            language: checkpoint.prompts[index].lang,
            brandName: "Example",
          },
          checkpoint.enginePlan[index] as never
        )
      )
    );
    seedJob({ checkpoint: { ...checkpoint, responses: done } });
    const engines = vi.spyOn(stubAuditAi, "queryAllEngines");

    await runAuditJob(input);

    expect(leakedCalls()).toEqual([]);
    expect(engines).toHaveBeenCalledTimes(1);
    expect(engines.mock.calls[0][0]).toMatchObject({ prompt: "q3" });
    expect(job().status).toBe("completed");
  });

  it("refuses to resume a live checkpoint as stub (no mixed evidence)", async () => {
    const checkpoint = makeAuditCheckpoint(
      { domain: "example.com", language: "both" },
      {
        brandName: "Example",
        brandVariants: [],
        identityGrounded: true,
        officialSiteIdentity: {
          finalUrl: "https://example.com/",
          title: "Example",
          description: null,
          h1: null,
          siteName: null,
        },
      },
      [{ text: "q1", lang: "en" }],
      createdAt.toISOString()
    );
    const live = checkpoint.enginePlan[0].map((engineId) => ({
      engineId,
      rawResponse: "real provider answer",
      brandMentioned: false,
      citedSources: [],
      durationMs: 10,
      isStub: false,
      errorMessage: null,
    }));
    seedJob({ checkpoint: { ...checkpoint, responses: [live] } });

    await runAuditJob(input);

    expect(leakedCalls()).toEqual([]);
    expect(job().status).toBe("failed");
    expect(job().errorMessage).toContain("stub mode refuses");
  });

  it("fails the Job instead of running when the flag reaches production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    seedJob();

    await runAuditJob(input);

    expect(leakedCalls()).toEqual([]);
    expect(job().status).toBe("failed");
    expect(job().errorMessage).toContain("not allowed in production");
  });

  it("marks every stub answer so it can never pass as a live one", async () => {
    const rows = await stubAuditAi.queryAllEngines(
      { prompt: "q", language: "ko", brandName: "Example" },
      ["chatgpt", "naver"]
    );
    expect(rows.every((row) => row.isStub)).toBe(true);
    expect(
      rows.every((row) => row.rawResponse.startsWith(AUDIT_STUB_MARKER))
    ).toBe(true);
  });
});
