/**
 * 환불 권한 회수 — 결제 출처가 맞을 때만 Free로 내린다.
 *
 * 결제와 무관한 파트너·초대코드·관리자 권한을 환불 웹훅이 빼앗는 회귀를 막는다.
 * @vitest-environment node
 */

import {
  grantPlanFromPayment,
  isCurrentPaymentGrant,
  paymentGrantAfterPayment,
  paymentGrantAfterRefund,
} from "@repo/auth/plan-grant";
import { describe, expect, it, vi } from "vitest";

const clerkUsers = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUserMetadata: vi.fn(),
}));

// auth 패키지가 실제 import하는 Clerk 복사본을 가로챈다.
vi.mock(
  "../../../packages/auth/node_modules/@clerk/nextjs/dist/esm/server/index.js",
  () => ({
    clerkClient: vi.fn(async () => ({ users: clerkUsers })),
  })
);

describe("결제 권한 출처", () => {
  it("결제 ID가 정확히 같을 때만 권한 회수 후보가 된다", () => {
    expect(
      isCurrentPaymentGrant(
        { findablePaymentId: "fdbl-starter-1-current" },
        "fdbl-starter-1-current"
      )
    ).toBe(true);
  });

  it("다른 결제의 취소 웹훅은 현재 권한을 회수하지 않는다", () => {
    expect(
      isCurrentPaymentGrant(
        { findablePaymentId: "fdbl-growth-1-current" },
        "fdbl-starter-1-old"
      )
    ).toBe(false);
  });

  it("결제 출처가 없는 파트너·초대코드 권한은 회수하지 않는다", () => {
    expect(isCurrentPaymentGrant({}, "fdbl-starter-1-current")).toBe(false);
    expect(isCurrentPaymentGrant(undefined, "fdbl-starter-1-current")).toBe(
      false
    );
  });

  it("잘못된 형태의 privateMetadata도 안전하게 거부한다", () => {
    expect(
      isCurrentPaymentGrant(
        { findablePaymentId: ["fdbl-starter-1-current"] },
        "fdbl-starter-1-current"
      )
    ).toBe(false);
  });

  it("상위 Enterprise 권한 보유자가 하위 Starter를 결제해도 권한을 낮추지 않는다", () => {
    expect(paymentGrantAfterPayment("enterprise", {}, "starter", "payment-1"))
      .toEqual({ plan: "enterprise", privateMetadata: null });
  });

  it("결제 환불 시에는 결제 전 권한을 복원한다", () => {
    const granted = paymentGrantAfterPayment("enterprise", {}, "starter", "payment-1");
    expect(granted).toEqual({ plan: "enterprise", privateMetadata: null });

    const paidFromFree = paymentGrantAfterPayment("free", {}, "starter", "payment-2");
    expect(paymentGrantAfterRefund(paidFromFree.privateMetadata, "payment-2")).toEqual({
      plan: "free",
      privateMetadata: null,
      revoked: true,
    });
  });

  it("verify와 Paid 웹훅이 같은 결제를 부여한 뒤 전액 환불하면 한 번만 회수한다", () => {
    const verified = paymentGrantAfterPayment(
      "free",
      {},
      "growth",
      "payment-1"
    );
    const webhook = paymentGrantAfterPayment(
      verified.plan,
      verified.privateMetadata,
      "growth",
      "payment-1"
    );

    expect(webhook).toEqual(verified);
    expect(
      paymentGrantAfterRefund(webhook.privateMetadata, "payment-1")
    ).toEqual({
      plan: "free",
      privateMetadata: null,
      revoked: true,
    });
  });

  it("늦게 도착한 과거 결제 Paid 웹훅은 현재 결제를 덮거나 중복 기록하지 않는다", () => {
    const first = paymentGrantAfterPayment("free", {}, "growth", "payment-1");
    const second = paymentGrantAfterPayment(
      first.plan,
      first.privateMetadata,
      "growth",
      "payment-2"
    );
    const lateFirst = paymentGrantAfterPayment(
      second.plan,
      second.privateMetadata,
      "growth",
      "payment-1"
    );

    expect(lateFirst).toEqual(second);
    expect(
      paymentGrantAfterRefund(lateFirst.privateMetadata, "payment-2")
    ).toEqual({
      plan: "growth",
      privateMetadata: first.privateMetadata,
      revoked: true,
    });
  });

  it("기존 중복 결제 출처를 환불할 때 같은 ID를 모두 제거한다", () => {
    const legacy = {
      findablePaymentId: "payment-1",
      findablePaymentGrantStack: [
        { paymentId: "payment-1", plan: "growth" },
        { paymentId: "payment-1", plan: "growth" },
        { paymentId: null, plan: "free" },
      ],
    };

    expect(paymentGrantAfterRefund(legacy, "payment-1")).toEqual({
      plan: "free",
      privateMetadata: null,
      revoked: true,
    });
  });

  it("이미 부여된 결제의 재전송은 Clerk metadata를 다시 쓰지 않는다", async () => {
    const existing = paymentGrantAfterPayment("free", {}, "growth", "payment-1");
    clerkUsers.getUser.mockResolvedValue({
      publicMetadata: { plan: existing.plan },
      privateMetadata: existing.privateMetadata,
    });
    clerkUsers.updateUserMetadata.mockClear();

    const result = await grantPlanFromPayment("user-1", "growth", "payment-1");
    expect(clerkUsers.getUser).toHaveBeenCalledWith("user-1");
    expect(result).toBe(true);
    expect(clerkUsers.updateUserMetadata).not.toHaveBeenCalled();

    const newer = paymentGrantAfterPayment(
      existing.plan,
      existing.privateMetadata,
      "growth",
      "payment-2"
    );
    clerkUsers.getUser.mockResolvedValue({
      publicMetadata: { plan: newer.plan },
      privateMetadata: newer.privateMetadata,
    });
    expect(await grantPlanFromPayment("user-1", "growth", "payment-1")).toBe(
      true
    );
    expect(clerkUsers.updateUserMetadata).not.toHaveBeenCalled();
  });

  it("상위 플랜 결제 후 환불하면 직전 유료 권한과 출처를 복원한다", () => {
    const starter = paymentGrantAfterPayment("free", {}, "starter", "starter-1");
    const growth = paymentGrantAfterPayment(
      "starter",
      starter.privateMetadata ?? {},
      "growth",
      "growth-1"
    );

    expect(paymentGrantAfterRefund(growth.privateMetadata, "growth-1")).toEqual({
      plan: "starter",
      privateMetadata: starter.privateMetadata,
      revoked: true,
    });
  });
});
