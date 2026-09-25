// Read-only operator tool. Accepts an API snapshot, never connects to the DB.
// Bundle with esbuild (platform=node), then run with the JSON filename.
// Provider credentials come from the invoking process, not from this file.
import { readFileSync } from "node:fs";
import { proposeAuditRevalidation } from "../packages/audit/revalidate-stored-audit";

const inputPath = process.argv[2];
if (!inputPath)
  throw new Error("Usage: propose-audit-revalidation <saved-api.json>");
const snapshot = JSON.parse(readFileSync(inputPath, "utf8"));
const result = snapshot.result ?? snapshot;
const identity = result.measurementContext?.officialSiteIdentity;
if (
  !identity ||
  typeof result.brandName !== "string" ||
  typeof result.domain !== "string" ||
  !Array.isArray(result.engineResponses)
) {
  throw new Error(
    "Snapshot must include brand, domain, engine responses and recorded official identity"
  );
}
// Restrict the proposal to measurement inputs. No emails, owner IDs, leads,
// financial data, or generated consulting content are sent to the verifier.
const proposal = await proposeAuditRevalidation(
  {
    brandName: result.brandName,
    domain: result.domain,
    brandVariants: result.brandVariants,
    engineResponses: result.engineResponses.map(
      (row: Record<string, unknown>) => ({
        engineId: row.engineId,
        rawResponse: row.rawResponse,
        excerpt: row.excerpt,
        errorMessage: row.errorMessage,
        isStub: row.isStub,
        citedSources: row.citedSources,
      })
    ),
  },
  identity
);
console.log(JSON.stringify(proposal, null, 2));
