/**
 * 환불 권한 회수 — 결제 출처가 맞을 때만 Free로 내린다.
 *
 * 결제와 무관한 파트너·초대코드·관리자 권한을 환불 웹훅이 빼앗는 회귀를 막는다.
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import {
  isCurrentPaymentGrant,
  paymentGrantAfterPayment,
  paymentGrantAfterRefund,
} from "@repo/auth/plan-grant";

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
