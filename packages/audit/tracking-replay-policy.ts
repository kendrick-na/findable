import { database } from "@repo/database";
import { isTrackableResponse } from "./tracking-eligibility";
import type { TaggedEngineResponse } from "./tracking";

export const TRACKING_RECONCILE_MAX_ATTEMPTS = 3;
export const TRACKING_RECONCILE_RETRY_MS = 60_000;

/** Distinguish immutable non-writes from dependencies that may recover. */
export async function classifyTrackingReplay(
  organizationId: string,
  tagged: TaggedEngineResponse[]
): Promise<"ready" | "not_applicable" | "unreplayable" | "retry"> {
  if (tagged.length === 0) return "unreplayable";
  const snapshotEngineIds = new Set(tagged.map((row) => row.engineId));
  if (!tagged.some((row) => isTrackableResponse(row, snapshotEngineIds))) {
    // Stub, provider error, unverified verdict or blank prompt cannot become
    // a real answer by retrying the same immutable AuditJob snapshot.
    return "not_applicable";
  }
  const organization = await database.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!organization) return "not_applicable";
  const engines = await database.engine.findMany({ select: { id: true } });
  const validEngineIds = new Set(engines.map((engine) => engine.id));
  // A missing Engine seed can be repaired without changing the snapshot.
  if (!tagged.some((row) => isTrackableResponse(row, validEngineIds))) return "retry";
  return "ready";
}
