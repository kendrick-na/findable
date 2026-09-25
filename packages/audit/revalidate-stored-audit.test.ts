import { expect, it, vi } from "vitest";
import { proposeAuditRevalidation } from "./revalidate-stored-audit";

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
