"use server";

import { grantPlanFromPayment } from "@repo/auth/plan-grant";
import { auth, currentUser } from "@repo/auth/server";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import {
  amountForPlan,
  buildPaymentId,
  cancelBillingKeySchedules,
  deleteBillingKey,
  getPortOnePayment,
  isPortOneConfigured,
  nextBillingDate,
  type PayablePlan,
  paymentIssuedAtFromPaymentId,
  payWithBillingKey,
  schedulePaymentWithBillingKey,
  userIdFromPaymentId,
} from "@repo/payments";
import { ensureOrgExists } from "@/lib/db/ensure-org";
import { getAppDictionary } from "@/lib/i18n";

/** 화면에 보이는 오류 문구 — 사전 `app.billingErrors`(요청 밖이면 ko). ⚠️ 결제사로 보내는 상품명은 그대로. */
const billingErrors = async () => (await getAppDictionary()).billingErrors;

/**
 * 정기결제(월 구독) — 빌링키 발급 → 첫 결제 → 해지. 2026-08-11 세션N-18.
 *
 * 왜 만들었나: 카카오페이 심사관이 *"사이트 내 정기결제 상품이 없으면 심사 진행이
 *   어렵다"* 고 회신했다. 기존엔 "월 구독"으로 팔면서 실제로는 **단건 1회 결제 후
 *   영구 부여**였다(표시와 실제가 다른 상태). 정기결제를 실제로 구현해 그 간극을 없앤다.
 *
 * 🔒 불변식 (단건 결제 `checkout.ts` 와 동일한 규칙을 따른다):
 *   - 금액은 **서버 카탈로그**에서만 온다(클라이언트가 보낸 금액 불신).
 *   - paymentId 에 세션 uid 를 심어 리플레이를 막는다.
 *   - `grantPlan` 은 멱등. 실패는 삼키지 않고 표면화한다.
 *
 * 🔴 **해지는 두 단계를 모두** 해야 한다:
 *     ① 결제 예약 취소 → ② 빌링키 삭제
 *   ①을 빠뜨리면 포트원 리커버리가 계속 청구를 시도해 **무한 과금 사고**가 난다.
 *   그래서 `unsubscribe()` 가 항상 이 순서로 부른다.
 *
 * 라이브 전환 뒤에는 첫 결제 직후 다음 달 예약을 만들고, Paid 웹훅이 이후 회차를 이어 예약한다.
 */

/** 정기결제 채널키(빌링키 발급 전용 채널). 단건 채널과 **다른 값**이다. */
const BILLING_CHANNEL_KEY =
  process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_BILLING ?? "";

/**
 * 🔒 이중 청구 방지(2026-10-05 컨트롤타워 승인 정책 — fail-closed).
 *
 * - active·past_due 이거나 빌링키가 남아 있는 조직은 새 구독을 시작하지 않는다.
 *   (Starter 중 Growth 결제 → 옛 예약이 고아가 되어 매달 두 번 청구되던 구멍)
 * - 청구 직전에 `billingNextPaymentId = 이번 첫 결제 ID` 를 **조건부 updateMany** 로 선점한다.
 *   동시에 들어온 두 번째 confirm 은 선점에 실패해 청구하지 않는다.
 * - 청구 뒤 DB 저장이 실패하면 선점 표식이 남는다 → 재시도는 새 ID로 다시 청구하지 않고
 *   "복구 필요"로 멈춘다. 표식은 PortOne 조회로 미청구(FAILED·CANCELLED)가 확인될 때만 푼다.
 *   (새 테이블·마이그레이션 없이 기존 컬럼만 쓴다. 선점 중에도 빌링키가 없으므로 결제 웹훅은
 *   이 첫 결제를 갱신 회차로 보지 않는다.)
 */
const SUBSCRIPTION_BLOCKING_STATUSES = new Set<string>(["active", "past_due"]);
/** 이보다 최근에 선점된 첫 결제는 아직 진행 중일 수 있어 PortOne 조회도 하지 않는다. */
const PENDING_CHARGE_SETTLE_MS = 10 * 60 * 1000;
/** PortOne 이 "청구되지 않았다"고 확정한 상태 — 이때만 선점 표식을 푼다. */
const UNCHARGED_PAYMENT_STATUSES = new Set<string>(["FAILED", "CANCELLED"]);

type PendingChargeState = "released" | "in_progress" | "paid";

/**
 * 선점된 첫 결제가 실제로 청구되지 않았으면 표식을 풀고 "released".
 * 조회 실패·진행 중 상태는 모두 표식 유지(fail-closed).
 */
async function settlePendingCharge(
  orgId: string,
  pendingPaymentId: string,
  options: { skipAgeCheck?: boolean } = {}
): Promise<PendingChargeState> {
  const issuedAt = paymentIssuedAtFromPaymentId(pendingPaymentId);
  if (
    !options.skipAgeCheck &&
    issuedAt &&
    Date.now() - issuedAt.getTime() < PENDING_CHARGE_SETTLE_MS
  ) {
    return "in_progress";
  }
  let status: string;
  try {
    status = (await getPortOnePayment(pendingPaymentId)).status;
  } catch (error) {
    log.error("billing.subscribe.pending_lookup_failed", {
      orgId,
      paymentId: pendingPaymentId,
      error: parseError(error),
    });
    return "in_progress";
  }
  if (UNCHARGED_PAYMENT_STATUSES.has(status)) {
    await database.organization.updateMany({
      where: { id: orgId, billingNextPaymentId: pendingPaymentId },
      data: { billingNextPaymentId: null },
    });
    return "released";
  }
  if (status === "PAID" || status === "PARTIAL_CANCELLED") {
    log.error("billing.subscribe.pending_paid_unrecorded", {
      orgId,
      paymentId: pendingPaymentId,
    });
    return "paid";
  }
  return "in_progress";
}

type EntryCheck = { ok: true } | { ok: false; error: string };

/** 이 조직이 지금 새 구독(첫 청구)을 시작해도 되는가. */
async function checkSubscriptionEntry(orgId: string): Promise<EntryCheck> {
  const org = await database.organization.findUnique({
    where: { id: orgId },
    select: {
      billingStatus: true,
      billingCustomerId: true,
      billingNextPaymentId: true,
    },
  });
  if (!org) {
    return {
      ok: false,
      error: (await billingErrors()).orgNotReady,
    };
  }
  if (
    SUBSCRIPTION_BLOCKING_STATUSES.has(org.billingStatus) ||
    org.billingCustomerId
  ) {
    return { ok: false, error: (await billingErrors()).alreadySubscribed };
  }
  if (org.billingNextPaymentId) {
    const state = await settlePendingCharge(orgId, org.billingNextPaymentId);
    if (state === "paid") {
      return { ok: false, error: (await billingErrors()).needsRecovery };
    }
    if (state === "in_progress") {
      return { ok: false, error: (await billingErrors()).inProgress };
    }
  }
  return { ok: true };
}

export interface SubscribeIntent {
  /** 첫 회 청구 금액(VAT 포함). 화면 고지와 같은 값이어야 한다. */
  amount: number;
  billingChannelKey: string;
  customerEmail?: string;
  customerName: string;
  /** 발급 요청 식별자. 결제 id 와 형식을 공유해 추적을 쉽게 한다. */
  issueId: string;
  /** 빌링키 발급창에 표시되는 제목. ⚠️ 카카오페이는 필수 입력이다(공식 문서). */
  issueName: string;
}

export type SubscribeIntentResult =
  | ({ ok: true } & SubscribeIntent)
  | { error: string };

/**
 * 정기결제 시작 — 서버가 issueId·금액·표시명을 확정해 클라이언트 SDK 에 넘긴다.
 * (금액을 클라이언트가 정하지 않게 하는 지점.)
 */
export const createSubscribeIntent = async (
  plan: PayablePlan
): Promise<SubscribeIntentResult> => {
  const { userId } = await auth();
  if (!userId) {
    return { error: (await billingErrors()).signIn };
  }

  const amount = amountForPlan(plan);
  if (!amount) {
    return { error: (await billingErrors()).planNotPayable };
  }

  if (!(isPortOneConfigured() && BILLING_CHANNEL_KEY)) {
    return {
      error: (await billingErrors()).subscriptionNotConfigured,
    };
  }

  // 이미 구독 중이거나 이전 첫 결제가 미정리인 조직엔 빌링키 발급창을 열지 않는다.
  const ensuredOrgId = await ensureOrgExists();
  if (!ensuredOrgId) {
    return {
      error: (await billingErrors()).orgNotReady,
    };
  }
  const entry = await checkSubscriptionEntry(ensuredOrgId);
  if (!entry.ok) {
    return { error: entry.error };
  }

  const user = await currentUser();
  const customerEmail = user?.emailAddresses?.[0]?.emailAddress;
  const customerName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    customerEmail ||
    "Findable 고객";

  return {
    ok: true,
    billingChannelKey: BILLING_CHANNEL_KEY,
    issueId: buildPaymentId(plan, userId),
    issueName: `Findable ${plan} 월 정기결제`,
    amount,
    customerName,
    customerEmail,
  };
};

export type ConfirmSubscriptionResult =
  | {
      ok: true;
      plan: PayablePlan;
      granted: boolean;
      renewalScheduled: boolean;
    }
  | { error: string };

/**
 * 빌링키 발급 성공 후 — 첫 결제를 실행하고 plan 을 부여한다.
 *
 * 🔒 빌링키는 **결제 수단**일 뿐 결제가 아니다. 발급만 하고 결제를 안 하면
 *   "구독했는데 청구가 없는" 상태가 된다 → 발급 직후 1회차를 즉시 청구한다.
 */
export const confirmSubscription = async (
  plan: PayablePlan,
  billingKey: string
): Promise<ConfirmSubscriptionResult> => {
  const { userId } = await auth();
  if (!userId) {
    return { error: (await billingErrors()).signIn };
  }

  const amount = amountForPlan(plan);
  if (!amount) {
    return { error: (await billingErrors()).planNotPayable };
  }

  const user = await currentUser();
  const customerEmail = user?.emailAddresses?.[0]?.emailAddress;
  const customerName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    customerEmail ||
    "Findable 고객";

  // 결제 전에 구독 소유 조직을 보장한다. 돈은 받았는데 빌링키·해지·다음 예약을 기록할
  // 조직이 없는 상태를 만들면 안 된다.
  const ensuredOrgId = await ensureOrgExists();
  if (!ensuredOrgId) {
    return {
      error: (await billingErrors()).orgNotReady,
    };
  }

  const entry = await checkSubscriptionEntry(ensuredOrgId);
  if (!entry.ok) {
    log.warn("billing.subscribe.entry_refused", { userId, plan });
    return { error: entry.error };
  }

  // 🔒 청구 전 선점 — 같은 조직의 동시·중복 confirm 중 하나만 청구한다.
  const paymentId = buildPaymentId(plan, userId);
  const claimed = await database.organization.updateMany({
    where: {
      id: ensuredOrgId,
      billingCustomerId: null,
      billingNextPaymentId: null,
    },
    data: { billingNextPaymentId: paymentId },
  });
  if (claimed.count !== 1) {
    log.warn("billing.subscribe.claim_lost", { userId, plan });
    return { error: (await billingErrors()).inProgress };
  }

  try {
    await payWithBillingKey({
      billingKey,
      channelKey: BILLING_CHANNEL_KEY,
      paymentId,
      orderName: `Findable ${plan} 월 정기결제`,
      totalAmount: amount,
      currency: "KRW",
      customerName,
      customerEmail,
    });
  } catch (error) {
    log.error("billing.subscribe.failed", {
      userId,
      paymentId,
      error: parseError(error),
    });
    // 청구 여부를 PortOne 에 확인한다. 미청구가 확정될 때만 선점을 풀어 재시도를 허용한다.
    const state = await settlePendingCharge(ensuredOrgId, paymentId, {
      skipAgeCheck: true,
    });
    if (state === "released") {
      return {
        error: (await billingErrors()).subscribeFailed,
      };
    }
    return {
      error:
        state === "paid"
          ? (await billingErrors()).needsRecovery
          : (await billingErrors()).inProgress,
    };
  }

  try {
    // 결제 시각을 기준으로 다음 결제일과 ID를 정한다. 같은 예약을 재시도해도 ID가 변하지 않아야
    // PortOne의 중복예약 방지와 웹훅 재시도가 안전하다.
    const paidAt = new Date();
    const nextPaymentAt = nextBillingDate(paidAt);
    const nextPaymentId = buildPaymentId(plan, userId, nextPaymentAt.getTime());

    // 빌링키를 저장해 둬야 나중에 해지(예약 취소 + 삭제)를 할 수 있다.
    // ⚠️ Clerk 웹훅 지연으로 org row 가 아직 없을 수 있다 → `ensureOrgExists` 로 먼저 보장한다.
    //   (`relationMode="prisma"` 라 없는 org 에 update 하면 예외가 난다.)
    // 선점 표식(billingNextPaymentId = 이번 결제 ID)이 그대로일 때만 확정한다.
    const recorded = await database.organization.updateMany({
      where: { id: ensuredOrgId, billingNextPaymentId: paymentId },
      data: {
        billingCustomerId: billingKey,
        billingProvider: "portone",
        billingStatus: "active",
        billingLastPaymentId: paymentId,
        billingNextPaymentId: nextPaymentId,
        billingNextPaymentAt: nextPaymentAt,
      },
    });
    if (recorded.count !== 1) {
      throw new Error("subscription claim was not held at record time");
    }

    let renewalScheduled = false;
    try {
      await schedulePaymentWithBillingKey({
        billingKey,
        channelKey: BILLING_CHANNEL_KEY,
        paymentId: nextPaymentId,
        orderName: `Findable ${plan} 월 정기결제`,
        totalAmount: amount,
        currency: "KRW",
        customerName,
        customerEmail,
        timeToPay: nextPaymentAt,
      });
      renewalScheduled = true;
    } catch (error) {
      // 첫 결제는 이미 완료됐다. 고객에게 실패로 보이게 하지 않고, 자동갱신만 보류 상태로 남긴다.
      // 운영자는 billing.schedule_initial_failed 로그와 past_due 상태를 보고 복구한다.
      log.error("billing.schedule_initial_failed", {
        userId,
        paymentId,
        nextPaymentId,
        error: parseError(error),
      });
      await database.organization.update({
        where: { id: ensuredOrgId },
        data: {
          billingStatus: "past_due",
          billingNextPaymentId: null,
          billingNextPaymentAt: null,
        },
      });
    }

    const granted = await grantPlanFromPayment(userId, plan, paymentId);
    log.info("billing.subscribe.granted", {
      userId,
      paymentId,
      plan,
      amount,
      granted,
      renewalScheduled,
    });

    return { ok: true, plan, granted, renewalScheduled };
  } catch (error) {
    // ⚠️ 돈은 이미 나갔다. 선점 표식을 남겨 재시도가 새 ID로 다시 청구하지 못하게 하고,
    //   결제 웹훅이 plan 을 부여한다. 조직 기록은 운영자가 이 로그로 복구한다(키는 로그 제외).
    log.error("billing.subscribe.post_charge_record_failed", {
      userId,
      paymentId,
      error: parseError(error),
    });
    return { error: (await billingErrors()).needsRecovery };
  }
};

export type UnsubscribeResult = { ok: true } | { error: string };

/**
 * 구독 해지 — ⚖️ **전자상거래법 제5조 제4항**: 가입을 웹에서 받았으면 해지도 웹에서 가능해야 한다.
 *
 * 🔴 **순서가 중요하다**: ① 예약 취소 → ② 빌링키 삭제.
 *   빌링키만 지우고 예약을 남기면 포트원 리커버리가 계속 청구를 시도한다(무한 과금).
 */
export const unsubscribe = async (): Promise<UnsubscribeResult> => {
  const { userId, orgId, has } = await auth();
  if (!userId) {
    return { error: (await billingErrors()).signIn };
  }
  if (!orgId) {
    return { error: (await billingErrors()).orgNotFound };
  }

  const org = await database.organization.findUnique({
    where: { id: orgId },
    select: {
      billingCustomerId: true,
      billingLastPaymentId: true,
      billingProvider: true,
    },
  });

  const billingKey = org?.billingCustomerId;
  if (!(billingKey && org?.billingProvider === "portone")) {
    return { error: (await billingErrors()).nothingToCancel };
  }

  // 🔒 해지 권한(2026-10-05 컨트롤타워 승인): 결제한 멤버 본인 또는 조직 관리자만.
  //   결제자를 알 수 없는(레거시) 구독은 관리자만 해지한다(fail-closed).
  const payerId = org.billingLastPaymentId
    ? userIdFromPaymentId(org.billingLastPaymentId)
    : null;
  const isOrgAdmin = has?.({ role: "org:admin" }) ?? false;
  if (!(payerId === userId || isOrgAdmin)) {
    log.warn("billing.unsubscribe.forbidden", { userId, orgId });
    return {
      error: (await billingErrors()).cancelForbidden,
    };
  }

  try {
    // ① 예약된 다음 결제부터 먼저 끊는다.
    await cancelBillingKeySchedules(billingKey);
    // ② 결제 수단 자체를 삭제한다.
    await deleteBillingKey(billingKey);

    await database.organization.update({
      where: { id: orgId },
      data: {
        billingCustomerId: null,
        billingProvider: null,
        billingStatus: "canceled",
        // 예약은 위에서 취소됐다. 웹훅이 이 회차를 갱신으로 보지 않게 ID만 지운다.
        billingNextPaymentId: null,
        // billingLastPaymentId·billingNextPaymentAt 은 남긴다 = 이미 결제한 기간의
        // 출처와 끝(paid-through). auto-refresh cron 의 expireCancelledSubscriptions 가
        // 그 시각이 지나면 Clerk 결제 권한을 회수하고 billingStatus 를 expired 로 닫는다.
      },
    });

    // plan 은 즉시 내리지 않는다 — 이미 결제한 이용 기간이 남아 있기 때문(유예 없음).
    log.info("billing.unsubscribe.done", { userId, orgId });
    return { ok: true };
  } catch (error) {
    log.error("billing.unsubscribe.failed", {
      userId,
      orgId,
      error: parseError(error),
    });
    return { error: (await billingErrors()).cancelFailed };
  }
};
