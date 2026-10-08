import { describe, expect, it, vi } from "vitest";
import { commitAuditResult } from "./commit-audit-result";

describe("commitAuditResult", () => {
  it("fences the terminal write and clears the previous PDF link atomically", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = { auditJob: { updateMany } };
    const result = { engineResponses: [] };
    const postprocessing = { pdf: "pending" };

    await expect(
      commitAuditResult(database, "job-1", "lease-1", result, postprocessing)
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1", status: "processing", leaseToken: "lease-1" },
        data: expect.objectContaining({
          status: "completed",
          result,
          postprocessing,
          pdfUrl: null,
        }),
      })
    );
  });
});
