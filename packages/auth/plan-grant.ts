import "server-only";

import { clerkClient } from "@clerk/nextjs/server";
import { hasPlan, normalizePlan, type Plan } from "./plan";

/**
 * plan 부여(grant) — 서버 전용 공용 헬퍼.
 *
 * Clerk `user.publicMetadata.plan` 을 지정 plan 으로 멱등 push 한다(게이팅 캐시).
 * 파트너 승인(actions/partner/decide.ts)·결제 성공(payments verify·webhook) 등
 * "plan 을 코드로 올리는" 모든 경로가 이 함수 하나를 재사용한다(로직 중복 방지).
 *
 * ⚠️ plan 의 최종 진실은 상황마다 다르다:
 *   - 파트너: DB PartnerApplication.status=approved
 *   - 결제: PortOne 결제 PAID + 서버 금액 검증
 *   이 함수는 그 진실이 확정된 뒤 "Clerk 캐시에 반영"만 담당한다(권위 write 아님).
 *
 * push 실패를 삼키지 않고 boolean 으로 반환 → 호출부가 재시도/경고를 판단.
 * (멱등이라 같은 값 재기록도 안전. 다음 로그인/재동기화로 교정 가능.)
 */

const MAX_PUSH_RETRIES = 3;

/**
 * 결제에서 부여된 plan 의 출처를 Clerk privateMetadata에만 남긴다.
 * publicMetadata는 화면·게이팅용 plan만 유지하고, 결제 식별자는 노출하지 않는다.
 */
const PAYMENT_GRANT_ID_KEY = "findablePaymentId";
const PAYMENT_GRANT_STACK_KEY = "findablePaymentGrantStack";

type PaymentGrantState = {
  paymentId: string | null;
  plan: Plan;
};

type PaymentGrantResult = {
  plan: Plan;
  privateMetadata: Record<string, unknown> | null;
};

function paymentGrantStack(
  privateMetadata: Record<string, unknown> | null | undefined
): PaymentGrantState[] {
  const value = privateMetadata?.[PAYMENT_GRANT_STACK_KEY];
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    if (
      (typeof candidate.paymentId !== "string" && candidate.paymentId !== null) ||
      typeof candidate.plan !== "string"
    ) {
      return [];
    }
    const plan = normalizePlan(candidate.plan);
    return candidate.plan === plan
      ? [{ paymentId: candidate.paymentId, plan }]
      : [];
  });
}

function privateMetadataForStack(
  stack: PaymentGrantState[]
): Record<string, unknown> | null {
  if (
    stack.length === 0 ||
    (stack.length === 1 && stack[0]?.plan === "free" && stack[0].paymentId === null)
  ) {
    return null;
  }
  return {
    [PAYMENT_GRANT_ID_KEY]: stack[0]?.paymentId ?? null,
    [PAYMENT_GRANT_STACK_KEY]: stack,
  };
}

/**
 * 결제가 기존보다 낮은 플랜을 덮어쓰지 않게 하고, 환불 때 복구할 현재 권한을 저장한다.
 * Clerk 호출과 분리해 결제/환불 권한 전이를 순수하게 검증한다.
 */
export function paymentGrantAfterPayment(
  currentPlan: Plan,
  privateMetadata: Record<string, unknown> | null | undefined,
  purchasedPlan: Plan,
  paymentId: string
): PaymentGrantResult {
  // Enterprise 등이 이미 있는 계정이 하위 플랜을 결제해도 권한을 낮추거나
  // 환불 웹훅의 회수 대상으로 표시하지 않는다.
  if (currentPlan !== purchasedPlan && hasPlan(currentPlan, purchasedPlan)) {
    return { plan: currentPlan, privateMetadata: null };
  }

  const existing = paymentGrantStack(privateMetadata);
  const currentPaymentId =
    typeof privateMetadata?.[PAYMENT_GRANT_ID_KEY] === "string"
      ? privateMetadata[PAYMENT_GRANT_ID_KEY]
      : null;
  const prior =
    existing[0]?.plan === currentPlan &&
    existing[0]?.paymentId === currentPaymentId
      ? existing
      : [{ paymentId: currentPaymentId, plan: currentPlan }, ...existing];

  return {
    plan: purchasedPlan,
    privateMetadata: privateMetadataForStack(
      [{ paymentId, plan: purchasedPlan }, ...prior].slice(0, 8)
    ),
  };
}

/** 현재 결제가 전면에 있을 때만 직전 권한으로 되돌린다. */
export function paymentGrantAfterRefund(
  privateMetadata: Record<string, unknown> | null | undefined,
  paymentId: string
): PaymentGrantResult & { revoked: boolean } {
  if (!isCurrentPaymentGrant(privateMetadata, paymentId)) {
    return { plan: "free", privateMetadata: null, revoked: false };
  }

  const remaining = paymentGrantStack(privateMetadata).slice(1);
  return {
    plan: remaining[0]?.plan ?? "free",
    privateMetadata: privateMetadataForStack(remaining),
    revoked: true,
  };
}

/** 결제 취소가 현재 결제에서 부여한 권한에만 닿도록 하는 순수 가드. */
export function isCurrentPaymentGrant(
  privateMetadata: Record<string, unknown> | null | undefined,
  paymentId: string
): boolean {
  return privateMetadata?.[PAYMENT_GRANT_ID_KEY] === paymentId;
}

async function updatePlanMetadata(input: {
  plan: Plan;
  privateMetadata?: Record<string, unknown> | null;
  userId: string;
}): Promise<boolean> {
  const clerk = await clerkClient();
  for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt++) {
    try {
      await clerk.users.updateUserMetadata(input.userId, {
        publicMetadata: { plan: input.plan },
        privateMetadata: input.privateMetadata ?? {
          [PAYMENT_GRANT_ID_KEY]: null,
          [PAYMENT_GRANT_STACK_KEY]: null,
        },
      });
      return true;
    } catch {
      if (attempt === MAX_PUSH_RETRIES) {
        return false;
      }
    }
  }
  return false;
}

export async function grantPlan(userId: string, plan: Plan): Promise<boolean> {
  // 파트너·초대코드·관리자 부여는 결제 취소로 회수하면 안 된다.
  return updatePlanMetadata({ userId, plan, privateMetadata: null });
}

/** 결제로 plan 을 부여하고, 전액 취소 때만 회수할 출처(paymentId)를 비공개로 보관한다. */
export async function grantPlanFromPayment(
  userId: string,
  plan: Plan,
  paymentId: string
): Promise<boolean> {
  const clerk = await clerkClient();
  try {
    const user = await clerk.users.getUser(userId);
    const next = paymentGrantAfterPayment(
      normalizePlan(user.publicMetadata.plan),
      user.privateMetadata as Record<string, unknown> | undefined,
      plan,
      paymentId
    );
    // 상위 권한 보유자의 하위 결제는 entitlement 변경이 없다. "부여 성공"으로
    // 처리해 webhook 재시도를 막되, 결제 ID를 권한 출처로 기록하지 않는다.
    if (next.plan === normalizePlan(user.publicMetadata.plan) && next.privateMetadata === null) {
      return true;
    }
    return updatePlanMetadata({ userId, ...next });
  } catch {
    return false;
  }
}

/**
 * 전액 환불 처리. 현재 권한이 **해당 결제**에서 온 경우에만 Free로 되돌린다.
 * 이후 파트너 승인·초대코드·관리자 부여가 덮어쓴 사용자는 절대 내리지 않는다.
 */
export async function revokePlanFromPayment(
  userId: string,
  paymentId: string
): Promise<{ revoked: boolean; reason: "not_current_payment" | "push_failed" | "revoked" }> {
  const clerk = await clerkClient();
  let privateMetadata: Record<string, unknown> | undefined;
  try {
    const user = await clerk.users.getUser(userId);
    privateMetadata = user.privateMetadata as Record<string, unknown> | undefined;
    if (
      !isCurrentPaymentGrant(
        privateMetadata,
        paymentId
      )
    ) {
      return { revoked: false, reason: "not_current_payment" };
    }
  } catch {
    return { revoked: false, reason: "push_failed" };
  }

  const next = paymentGrantAfterRefund(
    privateMetadata,
    paymentId
  );
  const revoked = next.revoked && (await updatePlanMetadata({ userId, ...next }));
  return revoked
    ? { revoked: true, reason: "revoked" }
    : { revoked: false, reason: "push_failed" };
}
