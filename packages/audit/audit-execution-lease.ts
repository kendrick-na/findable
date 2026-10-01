import { randomUUID } from "node:crypto";
import { database } from "@repo/database";
import type { AuditCheckpoint } from "./checkpoint";
import { AUDIT_JOB_STALE_AFTER_MS } from "./stale-job";

/** Atomic queued→processing claim; only its token may persist this attempt. */
export async function claimAuditExecution(
  jobId: string,
  now = new Date(),
  token: string = randomUUID()
): Promise<string | null> {
  const claimed = await database.auditJob.updateMany({
    where: { id: jobId, status: "queued" },
    data: {
      status: "processing",
      attemptStartedAt: now,
      leaseToken: token,
      leaseUntil: new Date(now.getTime() + AUDIT_JOB_STALE_AFTER_MS),
    },
  });
  return claimed.count === 1 ? token : null;
}

export async function saveQuestionCheckpoint(
  jobId: string,
  leaseToken: string,
  checkpoint: AuditCheckpoint
): Promise<void> {
  const written = await database.auditJob.updateMany({
    where: { id: jobId, status: "processing", leaseToken },
    data: { checkpoint: checkpoint as never },
  });
  if (written.count !== 1) {
    throw new Error("Audit checkpoint lost its processing job");
  }
}
