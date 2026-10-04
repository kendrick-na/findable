import { createHash } from "node:crypto";
import type { ClientReportData } from "@repo/audit/client-report/report-data";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) {
        result[key] = canonicalize(source[key]);
      }
    }
    return result;
  }
  return value;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Hashes the exact public snapshot, excluding archival self-review metadata. */
export function hashClientReportSnapshot(data: ClientReportData): string {
  const { publicationReview: _archivalReview, ...snapshot } = data;
  return sha256(JSON.stringify(canonicalize(snapshot)));
}

/** Must receive the bytes fetched from the stored PDF artifact, not a claimed digest. */
export function hashClientReportPdfBytes(bytes: Uint8Array): string {
  return sha256(bytes);
}
