"use server";

import { requireAdmin } from "@repo/auth/admin";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { isMissingTableErrorFor } from "@/lib/db/missing-table";

/**
 * 운영 콘솔 — 환불·청약철회 요청 목록 (2026-10-05).
 *
 * 🔒 `requireAdmin()` 으로 시작한다. DB 만 읽는다(PortOne·Clerk 호출 없음, 고객 메일 없음).
 *   처리(PortOne 취소·정기결제 해지)는 기존 운영 절차대로 하고, 이 목록은 "누가 언제 요청했나"를 보여 준다.
 *   테이블이 없으면(migration 전 배포) 빈 목록을 돌려준다.
 */

const LIST_LIMIT = 100;

export interface RefundRequestRow {
  createdAt: Date;
  id: string;
  message: string | null;
  organizationId: string;
  organizationName: string | null;
  paymentId: string | null;
  status: "pending" | "resolved";
  userId: string;
}

export async function listRefundRequests(): Promise<RefundRequestRow[]> {
  await requireAdmin();
  let requests: Omit<RefundRequestRow, "organizationName">[];
  try {
    requests = await database.refundRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT,
      select: {
        id: true,
        organizationId: true,
        userId: true,
        paymentId: true,
        message: true,
        status: true,
        createdAt: true,
      },
    });
  } catch (error) {
    if (isMissingTableErrorFor(error, "RefundRequest")) {
      log.warn("admin.refund_requests.table_missing", {});
      return [];
    }
    log.error("admin.refund_requests.list_failed", {
      error: parseError(error),
    });
    throw error;
  }

  const orgIds = [...new Set(requests.map((r) => r.organizationId))];
  const orgs =
    orgIds.length === 0
      ? []
      : await database.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true },
        });
  const nameById = new Map(orgs.map((o) => [o.id, o.name]));
  return requests.map((r) => ({
    ...r,
    organizationName: nameById.get(r.organizationId) ?? null,
  }));
}

export type ResolveRefundRequestResult =
  | { ok: true; outcome: "resolved" | "already_resolved" }
  | { ok: false; outcome: "not_found" | "failed" };

/**
 * 환불 요청을 "처리 완료"로 표시한다 — PortOne 취소·해지를 마친 운영자가 누른다.
 *
 * 🔒 `requireAdmin()` 으로 시작한다. 이 함수는 **표시만** 바꾼다(PortOne·Clerk 호출 없음,
 *   고객 메일 없음). 실제 환불은 PortOne 취소 → 결제 웹훅이 권한을 회수한다.
 *   처리 대기(pending)일 때만 바꿔서, 두 번 눌러도 처리 시각이 덮어써지지 않는다.
 */
export async function resolveRefundRequest(
  id: string
): Promise<ResolveRefundRequestResult> {
  const adminId = await requireAdmin();
  try {
    const updated = await database.refundRequest.updateMany({
      where: { id, status: "pending" },
      data: { status: "resolved", resolvedAt: new Date() },
    });
    if (updated.count === 1) {
      log.info("admin.refund_requests.resolved", { adminId, requestId: id });
      return { ok: true, outcome: "resolved" };
    }
    const existing = await database.refundRequest.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing) {
      return { ok: false, outcome: "not_found" };
    }
    return { ok: true, outcome: "already_resolved" };
  } catch (error) {
    log.error("admin.refund_requests.resolve_failed", {
      adminId,
      requestId: id,
      error: parseError(error),
    });
    return { ok: false, outcome: "failed" };
  }
}
