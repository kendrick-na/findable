import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  requireAdmin: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@repo/auth/admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@repo/database", () => ({
  database: {
    refundRequest: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  },
}));
vi.mock("@repo/observability/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("@repo/observability/error", () => ({
  parseError: (e: unknown) => String(e),
}));
vi.mock("@/lib/db/missing-table", () => ({
  isMissingTableErrorFor: () => false,
}));

import { resolveRefundRequest } from "@/app/actions/admin/refund-requests";

describe("resolveRefundRequest — 관리자 환불 요청 처리 완료", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue("user_admin");
  });

  it("관리자가 아니면 아무것도 바꾸지 않는다", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("FORBIDDEN: admin only"));
    await expect(resolveRefundRequest("req_1")).rejects.toThrow("FORBIDDEN");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("처리 대기 요청만 처리 완료로 바꾸고 처리 시각을 남긴다", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    await expect(resolveRefundRequest("req_1")).resolves.toEqual({
      ok: true,
      outcome: "resolved",
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "req_1", status: "pending" },
      data: { status: "resolved", resolvedAt: expect.any(Date) },
    });
  });

  it("이미 처리된 요청은 처리 시각을 덮어쓰지 않는다", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue({ status: "resolved" });
    await expect(resolveRefundRequest("req_1")).resolves.toEqual({
      ok: true,
      outcome: "already_resolved",
    });
  });

  it("없는 요청은 not_found", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(null);
    await expect(resolveRefundRequest("missing")).resolves.toEqual({
      ok: false,
      outcome: "not_found",
    });
  });
});
