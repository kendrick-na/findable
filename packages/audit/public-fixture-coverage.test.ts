import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MENTION_VERDICT_VERSION } from "../ai/lib/mention-verdict-version";
import {
  auditPublicationStatus,
  withRecomputedAuditMetrics,
} from "./normalize-stored-metrics";

const fixtures = [
  ["b7f319e1-1d96-4875-a1e1-e7f5e0e814c9.json", "published"],
  ["d5dd90b4-1bf3-4022-bfa6-76de64ab8496.json", "published"],
  ["fcccedb7-a7de-4578-b1be-f42bd162f341.json", "provisional"],
  ["00e40b02-cf16-48c8-bb61-ace0c1da692f.json", "withheld"],
  ["39a89fdb-0d20-4bc2-900f-66bdf332aac2.json", "withheld"],
] as const;

describe("stored public audit fixture publication", () => {
  for (const [name, expectedStatus] of fixtures) {
    it(`keeps ${name.slice(0, 8)} at ${expectedStatus} with the question coverage gate`, () => {
      const job = JSON.parse(
        readFileSync(
          new URL(`./__fixtures__/public-audits/${name}`, import.meta.url),
          "utf8"
        )
      ) as { result: Record<string, unknown> };
      const corrected = withRecomputedAuditMetrics(job.result);
      expect(auditPublicationStatus(corrected)).toBe(expectedStatus);
      if (corrected.mentionVerdictVersion === MENTION_VERDICT_VERSION) {
        const coverage = (corrected.metrics as Record<string, unknown>)
          .questionCoverage as {
          brand: { planned: number; withSuccessfulAiAnswer: number };
        };
        expect(coverage.brand).toMatchObject({
          planned: 4,
          withSuccessfulAiAnswer: 4,
        });
      }
    });
  }
});
