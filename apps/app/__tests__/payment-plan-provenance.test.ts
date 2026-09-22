/**
 * 환불 권한 회수 — 결제 출처가 맞을 때만 Free로 내린다.
 *
 * 결제와 무관한 파트너·초대코드·관리자 권한을 환불 웹훅이 빼앗는 회귀를 막는다.
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import { isCurrentPaymentGrant } from "@repo/auth/plan-grant";

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
});
