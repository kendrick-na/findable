import { createHash } from "node:crypto";
import { detectBrandMention } from "@repo/ai/lib/engines/utils";
import {
  verifyMention,
  type MentionVerdict,
} from "@repo/ai/lib/mention-verdict";
import { MENTION_VERDICT_VERSION } from "@repo/ai/lib/mention-verdict-version";

interface StoredAudit {
  brandName: string;
  domain: string;
  brandVariants?: string[];
  engineResponses: Array<{
    engineId: string;
    rawResponse?: string;
    excerpt?: string;
    errorMessage?: string | null;
    isStub?: boolean;
    citedSources?: Array<{ domain?: string; url?: string }>;
  }>;
}

/** Read-only proposal. No database imports, mutations, or publishable score.
 * A proposal requires source-to-claim review before materializing a new report.
 * In particular, old search candidate lists are NOT evidence of actual citation.
 */
export async function proposeAuditRevalidation(
  original: StoredAudit,
  officialSite: NonNullable<
    Parameters<typeof verifyMention>[0]["officialSite"]
  >,
  verify: typeof verifyMention = verifyMention
) {
  const sourceDigest = createHash("sha256")
    .update(JSON.stringify(original))
    .digest("hex");
  const rows: Array<{
    index: number;
    engineId: string;
    verdict: MentionVerdict;
    reason: string;
  }> = [];
  for (const [index, row] of original.engineResponses.entries()) {
    const text = row.rawResponse ?? row.excerpt ?? "";
    let verdict: MentionVerdict = {
      counted: false,
      quality: "unverified",
      via: "skipped",
    };
    let reason = "incomplete_source_text";
    if (row.errorMessage || row.isStub) {
      reason = "engine_unavailable";
    } else if (
      text.trim() &&
      (row.rawResponse !== undefined || !text.trimEnd().endsWith("…"))
    ) {
      try {
        verdict = await verify({
          brandName: original.brandName,
          brandDomain: original.domain,
          officialSite,
          text,
          // Never feed a previous rejected verdict back as stringMatched.
          stringMatched: detectBrandMention(
            text,
            original.brandName,
            original.brandVariants
          ).mentioned,
          citedDomains: row.citedSources
            ?.map((source) => source.domain ?? source.url ?? "")
            .filter(Boolean),
        });
        reason = "entity_rechecked_source_claim_review_pending";
      } catch {
        reason = "verification_failed";
      }
    }
    rows.push({ index, engineId: row.engineId, verdict, reason });
  }
  return {
    sourceDigest,
    proposedVerdictVersion: MENTION_VERDICT_VERSION,
    reviewRequired: true as const,
    rows,
  };
}
