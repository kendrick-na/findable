"use server";

import { grantPlan } from "@repo/auth/plan-grant";
import { auth, currentUser } from "@repo/auth/server";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import {
  amountForPlan,
  buildPaymentId,
  cancelBillingKeySchedules,
  deleteBillingKey,
  isPortOneConfigured,
  type PayablePlan,
  payWithBillingKey,
} from "@repo/payments";
import { ensureOrgExists } from "@/lib/db/ensure-org";

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
 * ⚠️ 지금은 **테스트 채널**(카카오페이 CID `TCSUBSCRIP`)이라 실제 청구가 없다.
 *   라이브 전환은 심사 승인 후 채널키 교체로 한다.
 */

/** 정기결제 채널키(빌링키 발급 전용 채널). 단건 채널과 **다른 값**이다. */
const BILLING_CHANNEL_KEY =
  process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_BILLING ?? "";

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
    return { error: "로그인 후 이용해 주세요." };
  }

  const amount = amountForPlan(plan);
  if (!amount) {
    return { error: "결제할 수 없는 플랜입니다." };
  }

  if (!(isPortOneConfigured() && BILLING_CHANNEL_KEY)) {
    return {
      error: "정기결제가 아직 설정되지 않았습니다. 상담으로 문의해 주세요.",
    };
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
  | { ok: true; plan: PayablePlan; granted: boolean }
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
    return { error: "로그인 후 이용해 주세요." };
  }

  const amount = amountForPlan(plan);
  if (!amount) {
    return { error: "결제할 수 없는 플랜입니다." };
  }

  const user = await currentUser();
  const customerEmail = user?.emailAddresses?.[0]?.emailAddress;
  const customerName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    customerEmail ||
    "Findable 고객";

  const paymentId = buildPaymentId(plan, userId);

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

    // 빌링키를 저장해 둬야 나중에 해지(예약 취소 + 삭제)를 할 수 있다.
    // ⚠️ Clerk 웹훅 지연으로 org row 가 아직 없을 수 있다 → `ensureOrgExists` 로 먼저 보장한다.
    //   (`relationMode="prisma"` 라 없는 org 에 update 하면 예외가 난다.)
    // ⚠️ 저장 실패가 **결제 성공을 뒤집지 않게** catch 로 가둔다 — 돈은 이미 나갔다.
    //   대신 error 로그를 남겨 수동 복구가 가능하게 한다(빌링키가 로그에 남으면 안 되므로 키는 제외).
    const ensuredOrgId = await ensureOrgExists().catch(() => null);
    if (ensuredOrgId) {
      await database.organization
        .update({
          where: { id: ensuredOrgId },
          data: {
            billingCustomerId: billingKey,
            billingProvider: "portone",
            billingStatus: "active",
          },
        })
        .catch((error: unknown) => {
          log.error("billing.subscribe.store_key_failed", {
            orgId: ensuredOrgId,
            error: parseError(error),
          });
        });
    } else {
      // org 가 없으면 해지 버튼이 빌링키를 못 찾는다 → 반드시 눈에 띄게 남긴다.
      log.error("billing.subscribe.no_org_cannot_store_key", { userId });
    }

    const granted = await grantPlan(userId, plan);
    log.info("billing.subscribe.granted", {
      userId,
      paymentId,
      plan,
      amount,
      granted,
    });

    return { ok: true, plan, granted };
  } catch (error) {
    log.error("billing.subscribe.failed", {
      userId,
      paymentId,
      error: parseError(error),
    });
    return {
      error: "정기결제 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    };
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
  const { userId, orgId } = await auth();
  if (!userId) {
    return { error: "로그인 후 이용해 주세요." };
  }
  if (!orgId) {
    return { error: "조직 정보를 찾을 수 없습니다." };
  }

  const org = await database.organization.findUnique({
    where: { id: orgId },
    select: { billingCustomerId: true, billingProvider: true },
  });

  const billingKey = org?.billingCustomerId;
  if (!(billingKey && org?.billingProvider === "portone")) {
    return { error: "해지할 정기결제가 없습니다." };
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
      },
    });

    // plan 은 즉시 내리지 않는다 — 이미 결제한 이용 기간이 남아 있기 때문.
    // (기간 만료 처리는 갱신 스케줄러 도입 시 함께. 지금은 상태만 canceled.)
    log.info("billing.unsubscribe.done", { userId, orgId });
    return { ok: true };
  } catch (error) {
    log.error("billing.unsubscribe.failed", {
      userId,
      orgId,
      error: parseError(error),
    });
    return { error: "해지 처리에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }
};
