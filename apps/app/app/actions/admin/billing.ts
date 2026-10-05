"use server";

import { requireAdmin } from "@repo/auth/admin";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import {
  getPortOnePayment,
  isPortOnePaymentNotFound,
  paymentIssuedAtFromPaymentId,
} from "@repo/payments";
import { revalidatePath } from "next/cache";

/**
 * 운영 콘솔 — 멈춘 정기결제 선점(claim) 점검·해제 (2026-10-05).
 *
 * 왜: 이중 청구 가드(`actions/billing/subscription.ts`)는 청구 직전에
 *   `billingNextPaymentId = 첫 결제 ID` 를 선점하고, PortOne 이 "청구 안 됨"을 확정할 때만 푼다.
 *   PortOne 이 결제를 아예 만들지 못했으면(조회 404) 고객 경로는 계속 "처리 중"으로 막힌다.
 *   "결제는 됐는데 기록 못 함" 건도 같은 모양으로 남는다. 운영자가 보고 풀 곳이 없었다.
 *
 * 🔒 불변식:
 *   - 모든 함수가 `requireAdmin()` 으로 시작한다(서버 재확인, 아니면 throw).
 *   - 목록은 DB 만 읽는다(PortOne 호출 없음).
 *   - 해제는 PortOne 을 다시 조회해 FAILED·CANCELLED 이거나 결제가 없을 때(404/PAYMENT_NOT_FOUND)만
 *     푼다. PAID·부분취소는 절대 풀지 않는다 — 풀면 다음 confirm 이 새 ID로 다시 청구한다.
 *   - 해제는 "같은 선점 ID + 빌링키 없음" 조건부 updateMany 라 재실행·경합에 안전하다.
 *   - 모든 해제 시도를 관리자 userId 와 함께 로그로 남긴다. 고객에게 메일을 보내지 않는다.
 */

/** 이보다 최근 선점은 아직 결제창·청구가 진행 중일 수 있다. */
const STUCK_CLAIM_MIN_AGE_MS = 30 * 60 * 1000;
const UNCHARGED_STATUSES = new Set<string>(["FAILED", "CANCELLED"]);
const CHARGED_STATUSES = new Set<string>(["PAID", "PARTIAL_CANCELLED"]);
const ADMIN_BILLING_PATH = "/admin/billing";

export interface StuckClaimRow {
  /** 선점 후 지난 분. paymentId 에서 시각을 읽지 못하면 null. */
  ageMinutes: number | null;
  billingStatus: string;
  claimedAt: Date | null;
  organizationId: string;
  organizationName: string;
  paymentId: string;
}

export type ReleaseOutcome =
  | "released"
  | "already_released"
  | "not_a_claim"
  | "too_recent"
  | "paid_unrecorded"
  | "in_progress"
  | "lookup_failed";

export type ReleaseClaimResult =
  | { ok: true; outcome: "released" | "already_released" }
  | {
      ok: false;
      outcome: Exclude<ReleaseOutcome, "released" | "already_released">;
    };

function claimAge(paymentId: string, now: number) {
  const claimedAt = paymentIssuedAtFromPaymentId(paymentId);
  return {
    claimedAt,
    ageMs: claimedAt ? now - claimedAt.getTime() : null,
  };
}

/** 30분 넘게 남은 선점(빌링키 없음 + billingNextPaymentId 있음) 목록. 읽기 전용. */
export async function listStuckClaims(): Promise<StuckClaimRow[]> {
  await requireAdmin();
  const now = Date.now();
  const orgs = await database.organization.findMany({
    where: { billingCustomerId: null, billingNextPaymentId: { not: null } },
    select: {
      id: true,
      name: true,
      billingStatus: true,
      billingNextPaymentId: true,
    },
    take: 200,
  });
  const rows: StuckClaimRow[] = [];
  for (const org of orgs) {
    if (!org.billingNextPaymentId) {
      continue;
    }
    const { claimedAt, ageMs } = claimAge(org.billingNextPaymentId, now);
    // 시각을 못 읽는 ID 도 보여 준다(해제 때는 PortOne 확인을 거친다).
    if (ageMs !== null && ageMs < STUCK_CLAIM_MIN_AGE_MS) {
      continue;
    }
    rows.push({
      organizationId: org.id,
      organizationName: org.name,
      billingStatus: org.billingStatus,
      paymentId: org.billingNextPaymentId,
      claimedAt,
      ageMinutes: ageMs === null ? null : Math.floor(ageMs / 60_000),
    });
  }
  return rows.sort((a, b) => (b.ageMinutes ?? 0) - (a.ageMinutes ?? 0));
}

/** PortOne 이 "청구되지 않았다"를 확정할 때만 선점을 푼다. */
export async function releaseStuckClaim(
  organizationId: string
): Promise<ReleaseClaimResult> {
  const adminId = await requireAdmin();
  const org = await database.organization.findUnique({
    where: { id: organizationId },
    select: { billingCustomerId: true, billingNextPaymentId: true },
  });
  const paymentId = org?.billingNextPaymentId ?? null;
  const audit = (
    outcome: ReleaseOutcome,
    extra: Record<string, unknown> = {}
  ) => {
    const fields = { adminId, organizationId, paymentId, outcome, ...extra };
    if (outcome === "released" || outcome === "already_released") {
      log.info("admin.billing.claim_release", fields);
    } else {
      log.warn("admin.billing.claim_release", fields);
    }
  };

  if (!(org && paymentId)) {
    audit("already_released");
    return { ok: true, outcome: "already_released" };
  }
  // 빌링키가 있으면 선점이 아니라 진행 중인 구독의 다음 회차다.
  if (org.billingCustomerId) {
    audit("not_a_claim");
    return { ok: false, outcome: "not_a_claim" };
  }
  const { ageMs } = claimAge(paymentId, Date.now());
  if (ageMs !== null && ageMs < STUCK_CLAIM_MIN_AGE_MS) {
    audit("too_recent");
    return { ok: false, outcome: "too_recent" };
  }

  let portoneStatus: string;
  try {
    portoneStatus = (await getPortOnePayment(paymentId)).status;
  } catch (error) {
    if (!isPortOnePaymentNotFound(error)) {
      audit("lookup_failed", { error: parseError(error) });
      return { ok: false, outcome: "lookup_failed" };
    }
    portoneStatus = "NOT_FOUND";
  }

  if (CHARGED_STATUSES.has(portoneStatus)) {
    audit("paid_unrecorded", { portoneStatus });
    return { ok: false, outcome: "paid_unrecorded" };
  }
  if (
    !(portoneStatus === "NOT_FOUND" || UNCHARGED_STATUSES.has(portoneStatus))
  ) {
    audit("in_progress", { portoneStatus });
    return { ok: false, outcome: "in_progress" };
  }

  const released = await database.organization.updateMany({
    where: {
      id: organizationId,
      billingNextPaymentId: paymentId,
      billingCustomerId: null,
    },
    data: { billingNextPaymentId: null },
  });
  const outcome = released.count === 1 ? "released" : "already_released";
  audit(outcome, { portoneStatus });
  revalidatePath(ADMIN_BILLING_PATH);
  return { ok: true, outcome };
}
