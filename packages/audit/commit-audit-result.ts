export interface AuditCommitDatabase {
  auditJob: {
    updateMany: (args: {
      where: { id: string; status: "processing"; leaseToken: string };
      data: {
        status: "completed";
        result: unknown;
        postprocessing: unknown;
        completedAt: Date;
        pdfUrl: null;
        checkpoint: null;
        leaseToken: null;
        leaseUntil: null;
      };
    }) => Promise<{ count: number }>;
  };
}

/** Complete exactly one processing generation; stale generations are fenced. */
export async function commitAuditResult(
  database: AuditCommitDatabase,
  jobId: string,
  leaseToken: string,
  result: unknown,
  postprocessing: unknown,
  completedAt = new Date()
): Promise<boolean> {
  const committed = await database.auditJob.updateMany({
    where: { id: jobId, status: "processing", leaseToken },
    data: {
      status: "completed",
      result,
      postprocessing,
      completedAt,
      pdfUrl: null,
      checkpoint: null,
      leaseToken: null,
      leaseUntil: null,
    },
  });
  return committed.count === 1;
}
