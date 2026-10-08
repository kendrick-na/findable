import "server-only";

import { clerkClient } from "@clerk/nextjs/server";
import { database } from "@repo/database";
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
 * 🔒 P1-4(2026-10-05): Clerk 메타데이터는 읽기→계산→쓰기다. 결제 부여·환불 회수·기간 만료가
 *   같은 사용자에게 동시에 돌면 둘 다 같은 스냅샷을 읽고, 나중에 쓴 쪽이 먼저 쓴 변경을 지운다
 *   (방금 결제한 권한이 사라지거나 회수한 권한이 되살아난다).
 *   → 사용자별 Postgres advisory lock(트랜잭션 범위) 안에서 읽고 쓴다. 다른 사용자는 막지 않는다.
 *   잠금을 못 잡으면(DB 장애) 쓰지 않고 실패로 돌려준다 — 호출부가 재시도한다(fail-closed).
 *   ⚠️ 잠금 동안 DB 연결 하나를 쥔 채 Clerk 를 호출한다(보통 수백 ms). 그래서 범위를 이
 *   읽기→쓰기 구간으로만 좁힌다.
 */
const METADATA_LOCK_TX = { maxWait: 10_000, timeout: 60_000 } as const;

function withUserMetadataLock<T>(
  userId: string,
  fn: () => Promise<T>
): Promise<T> {
  return database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`findable:plan-metadata:${userId}`}, 0))`;
    return fn();
  }, METADATA_LOCK_TX);
}

/**
 * 결제에서 부여된 plan 의 출처를 Clerk privateMetadata에만 남긴다.
 * publicMetadata는 화면·게이팅용 plan만 유지하고, 결제 식별자는 노출하지 않는다.
 */
const PAYMENT_GRANT_ID_KEY = "findablePaymentId";
const PAYMENT_GRANT_STACK_KEY = "findablePaymentGrantStack";

interface PaymentGrantState {
  paymentId: string | null;
  plan: Plan;
}

interface PaymentGrantResult {
  plan: Plan;
  privateMetadata: Record<string, unknown> | null;
}

function paymentGrantStack(
  privateMetadata: Record<string, unknown> | null | undefined
): PaymentGrantState[] {
  const value = privateMetadata?.[PAYMENT_GRANT_STACK_KEY];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const candidate = entry as Record<string, unknown>;
    if (
      (typeof candidate.paymentId !== "string" &&
        candidate.paymentId !== null) ||
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
    (stack.length === 1 &&
      stack[0]?.plan === "free" &&
      stack[0].paymentId === null)
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
  // 현재 또는 과거 결제의 늦은 재전송은 기존 권한 출처를 바꾸지 않는다.
  if (
    currentPaymentId === paymentId ||
    existing.some((grant) => grant.paymentId === paymentId)
  ) {
    return { plan: currentPlan, privateMetadata: privateMetadata ?? null };
  }
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

/**
 * 환불된 결제 출처를 제거하고, 현재 결제라면 직전 권한으로 되돌린다.
 * revoked는 출처 제거 성공을 뜻하며, 아래쪽 결제 환불 때 현재 plan은 그대로다.
 */
export function paymentGrantAfterRefund(
  privateMetadata: Record<string, unknown> | null | undefined,
  paymentId: string
): PaymentGrantResult & { revoked: boolean } {
  const stack = paymentGrantStack(privateMetadata);
  const isCurrent = isCurrentPaymentGrant(privateMetadata, paymentId);
  const hasPaymentGrant =
    isCurrent || stack.some((grant) => grant.paymentId === paymentId);
  if (!hasPaymentGrant) {
    return { plan: "free", privateMetadata: null, revoked: false };
  }

  const remaining = stack.filter((grant) => grant.paymentId !== paymentId);
  return {
    plan: (isCurrent ? remaining[0] : stack[0])?.plan ?? "free",
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
  try {
    return await withUserMetadataLock(userId, () =>
      updatePlanMetadata({ userId, plan, privateMetadata: null })
    );
  } catch {
    return false;
  }
}

/** 결제로 plan 을 부여하고, 전액 취소 때만 회수할 출처(paymentId)를 비공개로 보관한다. */
export async function grantPlanFromPayment(
  userId: string,
  plan: Plan,
  paymentId: string
): Promise<boolean> {
  try {
    return await withUserMetadataLock(userId, () =>
      grantPlanFromPaymentLocked(userId, plan, paymentId)
    );
  } catch {
    return false;
  }
}

async function grantPlanFromPaymentLocked(
  userId: string,
  plan: Plan,
  paymentId: string
): Promise<boolean> {
  const clerk = await clerkClient();
  try {
    const user = await clerk.users.getUser(userId);
    const currentPlan = normalizePlan(user.publicMetadata.plan);
    const privateMetadata = user.privateMetadata as
      | Record<string, unknown>
      | undefined;
    const next = paymentGrantAfterPayment(
      currentPlan,
      privateMetadata,
      plan,
      paymentId
    );
    // 변경이 없는 재전송과 상위 권한 보유자의 하위 결제는 쓰지 않는다.
    if (
      next.plan === currentPlan &&
      (next.privateMetadata === privateMetadata ||
        next.privateMetadata === null)
    ) {
      return true;
    }
    return updatePlanMetadata({ userId, ...next });
  } catch {
    return false;
  }
}

/**
 * 전액 환불 처리. 현재 결제면 직전 권한으로 되돌리고, 아래쪽 결제면
 * 현재 권한을 유지하면서 환불된 출처만 제거한다.
 * 이후 파트너 승인·초대코드·관리자 부여가 덮어쓴 사용자는 절대 내리지 않는다.
 */
interface RevokeResult {
  reason: "not_current_payment" | "push_failed" | "revoked";
  revoked: boolean;
}

export async function revokePlanFromPayment(
  userId: string,
  paymentId: string
): Promise<RevokeResult> {
  try {
    return await withUserMetadataLock(userId, () =>
      revokePlanFromPaymentLocked(userId, paymentId)
    );
  } catch {
    return { revoked: false, reason: "push_failed" };
  }
}

async function revokePlanFromPaymentLocked(
  userId: string,
  paymentId: string
): Promise<RevokeResult> {
  const clerk = await clerkClient();
  let privateMetadata: Record<string, unknown> | undefined;
  let currentPlan: Plan;
  try {
    const user = await clerk.users.getUser(userId);
    privateMetadata = user.privateMetadata as
      | Record<string, unknown>
      | undefined;
    currentPlan = normalizePlan(user.publicMetadata.plan);
  } catch {
    return { revoked: false, reason: "push_failed" };
  }

  const next = paymentGrantAfterRefund(privateMetadata, paymentId);
  if (!next.revoked) {
    return { revoked: false, reason: "not_current_payment" };
  }
  const plan = isCurrentPaymentGrant(privateMetadata, paymentId)
    ? next.plan
    : currentPlan;
  const revoked = await updatePlanMetadata({ userId, ...next, plan });
  return revoked
    ? { revoked: true, reason: "revoked" }
    : { revoked: false, reason: "push_failed" };
}

/**
 * 이용 기간이 끝난 결제 출처를 스택에서 모두 제거한다(갱신 실패 유예 만료용).
 *
 * 환불(`paymentGrantAfterRefund`)과 달리 결제 한 건이 아니라 여러 건을 지운다.
 * 정기결제는 회차마다 같은 plan 출처가 쌓이므로, 마지막 회차만 지우면 직전 회차의
 * 같은 plan 으로 "복구"되어 권한이 남는다. 그래서 끝난 출처를 한꺼번에 걸러낸다.
 * 현재 출처가 지워질 때만 plan 을 남은 맨 위 출처(없으면 free)로 내린다.
 */
export function paymentGrantAfterExpiry(
  currentPlan: Plan,
  privateMetadata: Record<string, unknown> | null | undefined,
  isExpired: (paymentId: string) => boolean
): PaymentGrantResult & { expired: boolean } {
  const stack = paymentGrantStack(privateMetadata);
  const currentPaymentId =
    typeof privateMetadata?.[PAYMENT_GRANT_ID_KEY] === "string"
      ? privateMetadata[PAYMENT_GRANT_ID_KEY]
      : null;
  const currentExpired =
    currentPaymentId !== null && isExpired(currentPaymentId);
  const remaining = stack.filter(
    (grant) => grant.paymentId === null || !isExpired(grant.paymentId)
  );
  if (!currentExpired && remaining.length === stack.length) {
    return {
      plan: currentPlan,
      privateMetadata: privateMetadata ?? null,
      expired: false,
    };
  }
  return {
    plan: currentExpired ? (remaining[0]?.plan ?? "free") : currentPlan,
    privateMetadata: privateMetadataForStack(remaining),
    expired: true,
  };
}

/**
 * 갱신 결제 실패 후 유예가 끝난 사용자의 결제 권한을 회수한다(cron 전용).
 * 결제와 무관한 권한(파트너·초대코드·관리자)은 grantPlan 이 출처를 비우므로 건드리지 않는다.
 */
interface ExpireResult {
  expired: boolean;
  reason: "nothing_to_expire" | "push_failed" | "expired";
}

export async function expirePaymentGrants(
  userId: string,
  isExpired: (paymentId: string) => boolean
): Promise<ExpireResult> {
  try {
    return await withUserMetadataLock(userId, () =>
      expirePaymentGrantsLocked(userId, isExpired)
    );
  } catch {
    return { expired: false, reason: "push_failed" };
  }
}

async function expirePaymentGrantsLocked(
  userId: string,
  isExpired: (paymentId: string) => boolean
): Promise<ExpireResult> {
  let privateMetadata: Record<string, unknown> | undefined;
  let currentPlan: Plan;
  try {
    const clerk = await clerkClient();
    const user = await clerk.users.getUser(userId);
    privateMetadata = user.privateMetadata as
      | Record<string, unknown>
      | undefined;
    currentPlan = normalizePlan(user.publicMetadata.plan);
  } catch {
    return { expired: false, reason: "push_failed" };
  }

  const next = paymentGrantAfterExpiry(currentPlan, privateMetadata, isExpired);
  if (!next.expired) {
    return { expired: false, reason: "nothing_to_expire" };
  }
  const pushed = await updatePlanMetadata({
    userId,
    plan: next.plan,
    privateMetadata: next.privateMetadata,
  });
  return pushed
    ? { expired: true, reason: "expired" }
    : { expired: false, reason: "push_failed" };
}
