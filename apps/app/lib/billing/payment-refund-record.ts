/**
 * 환불 기록(PaymentRefund) — PortOne 취소 웹훅이 남기는 내구 기록 (2026-10-05).
 *
 * 왜: 환불 펜스는 그동안 "환불이 있었다"를 조직 상태(canceled) + PortOne 실시간 조회로
 *   추론했다. 정리(cleanup)가 실패해 조직이 active 로 남은 사이나, PortOne 조회가 늦은 사이엔
 *   추론이 틀릴 수 있다. 이 기록이 있으면 그 사실을 먼저 믿는다.
 *
 * 🔒 불변식:
 *   - 결제 1건당 1행(paymentId unique). 부분 → 전액 취소는 같은 행을 승격하고,
 *     전액을 부분으로 되돌리지 않는다. 누적 취소 금액은 커질 때만 갱신한다(재전송·순서 뒤바뀜 안전).
 *   - 배포가 migration 보다 먼저 나가도 안전하다: 테이블이 없으면 쓰기는 건너뛰고 읽기는
 *     "기록 없음"을 돌려 호출부가 기존 판정으로 돌아간다. 이 상황은 프로세스당 한 번만 경고한다.
 *   - 기록은 보조 사실이다. 쓰기·읽기 실패가 웹훅 처리(회수·정리)를 막지 않는다.
 */

import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";

export type RefundKind = "full" | "partial";

export interface PaymentRefundInput {
  amount: number;
  kind: RefundKind;
  organizationId: string | null;
  paymentId: string;
  refundedAt: Date;
  userId: string;
}

export type RecordRefundResult =
  | "created"
  | "updated"
  | "unchanged"
  | "unavailable";

const REFUND_TABLE_RE = /PaymentRefund/;
const MISSING_RELATION_RE = /does not exist|42P01|42704/;

let warnedMissingTable = false;

function errorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const { code } = error as { code: unknown };
    return typeof code === "string" ? code : null;
  }
  return null;
}

/** 테이블(또는 enum)이 아직 없는 DB — migration 적용 전 배포. */
export function isMissingTableError(error: unknown): boolean {
  if (errorCode(error) === "P2021") {
    return true;
  }
  const message = error instanceof Error ? error.message : "";
  return REFUND_TABLE_RE.test(message) && MISSING_RELATION_RE.test(message);
}

function handleFailure(
  operation: "read" | "write",
  paymentId: string,
  error: unknown
): void {
  if (isMissingTableError(error)) {
    if (!warnedMissingTable) {
      warnedMissingTable = true;
      log.warn("payments.refund_record.table_missing", { operation });
    }
    return;
  }
  log.error("payments.refund_record.failed", {
    operation,
    paymentId,
    error: parseError(error),
  });
}

/** 멱등 기록. 같은 사실을 여러 번 받아도 한 행이고, 더 약한 사실로 덮지 않는다. */
export async function recordPaymentRefund(
  input: PaymentRefundInput
): Promise<RecordRefundResult> {
  try {
    try {
      await database.paymentRefund.create({ data: input });
      return "created";
    } catch (error) {
      if (errorCode(error) !== "P2002") {
        throw error;
      }
    }
    let changed = 0;
    if (input.kind === "full") {
      const promoted = await database.paymentRefund.updateMany({
        where: { paymentId: input.paymentId, kind: "partial" },
        data: {
          kind: "full",
          amount: input.amount,
          refundedAt: input.refundedAt,
        },
      });
      changed += promoted.count;
    }
    const grown = await database.paymentRefund.updateMany({
      where: { paymentId: input.paymentId, amount: { lt: input.amount } },
      data: { amount: input.amount },
    });
    changed += grown.count;
    return changed > 0 ? "updated" : "unchanged";
  } catch (error) {
    handleFailure("write", input.paymentId, error);
    return "unavailable";
  }
}

/** 기록된 환불 종류. 기록이 없거나 읽을 수 없으면 null(호출부는 기존 판정으로 돌아간다). */
export async function readPaymentRefundKind(
  paymentId: string
): Promise<RefundKind | null> {
  try {
    const row = await database.paymentRefund.findUnique({
      where: { paymentId },
      select: { kind: true },
    });
    return row?.kind ?? null;
  } catch (error) {
    handleFailure("read", paymentId, error);
    return null;
  }
}
