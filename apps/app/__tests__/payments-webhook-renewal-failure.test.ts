/**
 * KNOWN RED — 갱신 결제 실패 웹훅 미처리 (2026-10-05 컨트롤타워 C17).
 *
 * 정기결제 다음 회차가 실패(`Transaction.Failed`)해도 웹훅은 `ignored_event` 로
 * 끝나고, Clerk plan 부여에는 만료가 없다. 그래서 미납 이후에도 유료 권한이
 * 그대로 남을 수 있다. 실패 처리 정책(즉시 회수 vs 유예 기간)은 아직 미정이라,
 * 여기서는 정책과 무관한 최소 불변식만 고정한다:
 *   "갱신 실패가 확정되면 결제 상태가 어딘가에는 반영돼야 한다"
 *   = plan 회수가 호출되거나, 조직 billingStatus 가 active 에서 벗어난다.
 *
 * `it.fails` 라 지금은 스위트를 깨지 않는다. 실패 처리를 구현하면 이 테스트가
 * "예상한 실패가 일어나지 않음"으로 빨개진다 → 그때 `it` 으로 바꾼다.
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPortOnePayment: vi.fn(),
  revokePlanFromPayment: vi.fn(),
  grantPlanFromPayment: vi.fn(),
  organizationUpdate: vi.fn(),
  organizationFindFirst: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@repo/auth/plan-grant", () => ({
  grantPlanFromPayment: mocks.grantPlanFromPayment,
  revokePlanFromPayment: mocks.revokePlanFromPayment,
}));

vi.mock("@repo/database", () => ({
  database: {
    organization: {
      findFirst: mocks.organizationFindFirst,
      update: mocks.organizationUpdate,
      updateMany: mocks.organizationUpdate,
    },
  },
}));

vi.mock("@repo/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/payments")>();
  return {
    ...actual,
    getPortOnePayment: mocks.getPortOnePayment,
    verifyWebhookSignature: () => ({ ok: true }),
  };
});

const { POST } = await import("../app/webhooks/payments/route");

const RENEWAL_PAYMENT_ID = "fdbl-starter-2abc-renewal";

function failedRenewalRequest(): Request {
  return new Request("https://app.test/webhooks/payments", {
    method: "POST",
    body: JSON.stringify({
      type: "Transaction.Failed",
      data: { paymentId: RENEWAL_PAYMENT_ID, storeId: "store-1" },
    }),
  });
}

describe("갱신 결제 실패 웹훅", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPortOnePayment.mockResolvedValue({
      id: RENEWAL_PAYMENT_ID,
      status: "FAILED",
      amount: { total: 0 },
    });
    mocks.revokePlanFromPayment.mockResolvedValue({
      revoked: true,
      reason: "revoked",
    });
    mocks.organizationFindFirst.mockResolvedValue({
      id: "org-1",
      billingStatus: "active",
      billingNextPaymentId: RENEWAL_PAYMENT_ID,
    });
  });

  it.fails("KNOWN RED: 실패가 확정된 갱신 회차는 유료 상태에 반영된다", async () => {
    const response = await POST(failedRenewalRequest());
    const body = (await response.json()) as { reason?: string };

    const revoked = mocks.revokePlanFromPayment.mock.calls.length > 0;
    const leftActive = mocks.organizationUpdate.mock.calls.some(
      ([args]) =>
        typeof args?.data?.billingStatus === "string" &&
        args.data.billingStatus !== "active"
    );

    expect(body.reason).not.toBe("ignored_event:Transaction.Failed");
    expect(revoked || leftActive).toBe(true);
  });
});
