"use server";

import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { captureOpsAlert } from "@repo/observability/ops-alert";
import { isMissingTableErrorFor } from "@/lib/db/missing-table";

/**
 * 앱 내 환불·청약철회 요청 접수 — 2026-10-05.
 *
 * ⚖️ 약관 제4조의3 제5항은 요금제 화면 요청과 이메일 접수를 모두 적고, 결제 전 고지도
 *   "요금제 화면에서도 요청"을 안내한다. 계약을 웹에서 받았으니 철회 요청도 웹에서 받을 수 있게 한다(전상법 제5조 제4항 취지).
 *
 * 🔒 불변식:
 *   - 로그인 + 조직이 있어야 접수한다. 요청자·조직·마지막 결제 ID 를 함께 남긴다.
 *   - **고객에게 메일을 보내지 않는다.** 운영자 알림(Sentry ops-alert)과 로그만 남긴다.
 *     알림에는 ID 만 싣는다(이메일·자유 입력 내용 금지 — ops-alert 계약).
 *   - 처리 대기(pending) 요청이 이미 있으면 새로 만들지 않는다(연타·중복 알림 방지).
 *   - 실제 환불(PortOne 취소)·해지는 운영자가 한다. 이 함수는 결제를 건드리지 않는다.
 *   - 테이블이 없으면(migration 전 배포) "접수됐다"고 말하지 않는다. 이메일을 안내하고 운영자에게 알린다.
 */

const MESSAGE_MAX = 500;
const CONTACT_EMAIL = "kendrick@indigochild.kr";
const SAVE_FAILED_ERROR = `요청을 저장하지 못했어요. 번거로우시겠지만 ${CONTACT_EMAIL} 로 보내 주세요.`;

export type RefundRequestResult =
  | { ok: true; status: "created" | "already_pending" }
  | { ok: false; error: string };

const normalizeMessage = (raw: unknown): string | null => {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed.slice(0, MESSAGE_MAX);
};

export async function requestRefund(input: {
  message?: string;
}): Promise<RefundRequestResult> {
  const { userId, orgId } = await auth();
  if (!(userId && orgId)) {
    return {
      ok: false,
      error: "로그인한 조직에서만 요청할 수 있어요. 다시 로그인해 주세요.",
    };
  }
  const message = normalizeMessage(input?.message);

  try {
    const pending = await database.refundRequest.findFirst({
      where: { organizationId: orgId, status: "pending" },
      select: { id: true },
    });
    if (pending) {
      log.info("billing.refund_request.already_pending", {
        organizationId: orgId,
        requestId: pending.id,
      });
      return { ok: true, status: "already_pending" };
    }

    const org = await database.organization.findUnique({
      where: { id: orgId },
      select: { billingLastPaymentId: true },
    });
    const created = await database.refundRequest.create({
      data: {
        organizationId: orgId,
        userId,
        paymentId: org?.billingLastPaymentId ?? null,
        message,
      },
      select: { id: true },
    });

    log.info("billing.refund_request.created", {
      organizationId: orgId,
      requestId: created.id,
    });
    captureOpsAlert("환불·청약철회 요청 접수 — /admin/billing 에서 확인", {
      requestId: created.id,
      organizationId: orgId,
      hasPaymentId: Boolean(org?.billingLastPaymentId),
    });
    return { ok: true, status: "created" };
  } catch (error) {
    const tableMissing = isMissingTableErrorFor(error, "RefundRequest");
    log.error("billing.refund_request.failed", {
      organizationId: orgId,
      tableMissing,
      error: parseError(error),
    });
    // 저장은 못 했어도 운영자는 알아야 한다(고객은 이메일로 다시 보내도록 안내).
    captureOpsAlert(
      "환불·청약철회 요청 저장 실패 — 고객에게 이메일 접수 안내함",
      {
        organizationId: orgId,
        tableMissing,
      }
    );
    return { ok: false, error: SAVE_FAILED_ERROR };
  }
}
