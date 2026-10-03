import { describe, expect, it, vi } from "vitest";
import { MENTION_VERDICT_VERSION } from "../ai/lib/mention-verdict-version";
import {
  auditPublicationIssue,
  auditPublicationStatus,
  isPublishableAuditResult,
  publicAuditResult,
} from "./normalize-stored-metrics";
import {
  proposeAuditRevalidation,
  revalidateStoredAuditResult,
} from "./revalidate-stored-audit";

it("rechecks rejected matches from immutable text and never publishes a proposal as final", async () => {
  const original = {
    brandName: "TechDD",
    domain: "dd.knowverse.net",
    metrics: { sov: 23 },
    engineResponses: [
      {
        engineId: "gemini",
        brandMentioned: false,
        mentionQuality: "different_entity",
        excerpt: "노우버스의 TechDD와 TechScan",
        citedSources: [
          { domain: "knowverse.net", url: "https://knowverse.net/" },
        ],
      },
    ],
  };
  const before = JSON.stringify(original);
  const verify = vi
    .fn()
    .mockResolvedValue({ counted: true, quality: "confirmed", via: "llm" });
  const proposal = await proposeAuditRevalidation(
    original,
    { title: "TechDD" },
    verify
  );
  expect(verify.mock.calls[0][0].stringMatched).toBe(true);
  expect(proposal.rows[0].verdict.quality).toBe("confirmed");
  expect(proposal.reviewRequired).toBe(true);
  expect(proposal).not.toHaveProperty("metrics");
  expect(proposal).not.toHaveProperty("mentionVerdictVersion");
  expect(JSON.stringify(original)).toBe(before);
});

it("does not turn missing or truncated text into a verified absence", async () => {
  const verify = vi.fn();
  const proposal = await proposeAuditRevalidation(
    {
      brandName: "Example",
      domain: "example.com",
      engineResponses: [
        { engineId: "chatgpt", excerpt: "" },
        { engineId: "gemini", excerpt: "Example …" },
      ],
    },
    { title: "Example" },
    verify
  );
  expect(verify).not.toHaveBeenCalled();
  expect(
    proposal.rows.every((row) => row.verdict.quality === "unverified")
  ).toBe(true);
});

describe("stored audit revalidation backfill", () => {
  const identity = {
    title: "노우버스 | AI 전략",
    description: "노우버스는 AI 기술실사를 지원합니다.",
    siteName: "KNOWVERSE",
    h1: null,
    finalUrl: "https://www.knowverse.net/",
  };
  const legacy = () => ({
    brandName: "노우버스",
    domain: "knowverse.net",
    measurementContext: { officialSiteIdentity: identity },
    metrics: { sov: 40, unverifiedCount: 0, verifiedCount: 12 },
    geoActions: [{ title: "old advice" }],
    engineResponses: [
      ...Array.from({ length: 11 }, (_, index) => ({
        engineId: "gemini",
        brandMentioned: index < 3,
        mentionQuality: index < 3 ? "confirmed" : "absent",
        rawResponse: index < 3 ? "노우버스는 AI 기술실사 회사" : "다른 회사들",
        isStub: false,
        errorMessage: null,
      })),
      // Only a truncated excerpt survives — cannot be re-judged.
      {
        engineId: "claude",
        brandMentioned: true,
        mentionQuality: "confirmed",
        excerpt: "노우버스는 …",
        isStub: false,
        errorMessage: null,
      },
      { engineId: "naver-briefing", brandMentioned: false },
    ],
  });

  it("writes a new versioned result, preserves the original and flags re-measurement", async () => {
    const original = legacy();
    const before = JSON.stringify(original);
    const verify = vi.fn(async (input: { stringMatched: boolean }) =>
      input.stringMatched
        ? { counted: true, quality: "confirmed" as const, via: "llm" as const }
        : { counted: false, quality: "absent" as const, via: "rule" as const }
    );
    const outcome = await revalidateStoredAuditResult(original, {
      verify,
      now: new Date("2026-09-28T00:00:00Z"),
    });
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") {
      return;
    }
    // Only the 11 core rows with full text are sent to the verifier.
    expect(verify).toHaveBeenCalledTimes(11);
    expect(outcome.result.mentionVerdictVersion).toBe(MENTION_VERDICT_VERSION);
    expect(outcome.result.revalidation).toMatchObject({
      original,
      recommendRemeasure: true,
      rechecked: 11,
      incompleteSourceText: 1,
      revalidatedAt: "2026-09-28T00:00:00.000Z",
    });
    expect(outcome.result.metrics).toMatchObject({
      verifiedCount: 11,
      unverifiedCount: 1,
      sov: Math.round((3 / 11) * 100),
    });
    expect(outcome.result.geoActions).toEqual([]);
    // Entity revalidation cannot reconstruct an absent question plan. The
    // verdict is updated, but publication still requires a new measurement.
    expect(auditPublicationIssue(outcome.result)).toBe(
      "question_plan_unverified"
    );
    expect(auditPublicationStatus(outcome.result)).toBe("provisional");
    expect(isPublishableAuditResult(outcome.result)).toBe(false);
    const publicMetrics = publicAuditResult(outcome.result).metrics as Record<
      string,
      unknown
    >;
    expect(publicMetrics.sov).toBeNull();
    expect(JSON.stringify(original)).toBe(before);
  });

  it("skips current results and asks for re-measurement when no official identity was stored", async () => {
    const verify = vi.fn();
    const current = {
      ...legacy(),
      mentionVerdictVersion: MENTION_VERDICT_VERSION,
    };
    expect(
      await revalidateStoredAuditResult(current, { verify })
    ).toMatchObject({ status: "skipped", reason: "already_current" });
    const { measurementContext: _omit, ...noIdentity } = legacy();
    expect(
      await revalidateStoredAuditResult(noIdentity, { verify })
    ).toMatchObject({
      status: "skipped",
      reason: "missing_official_identity",
      recommendRemeasure: true,
    });
    expect(verify).not.toHaveBeenCalled();
  });
});
