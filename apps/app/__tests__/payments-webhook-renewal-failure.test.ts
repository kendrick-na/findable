/**
 * 갱신 결제 실패 웹훅 (2026-10-05 컨트롤타워 C17 — KNOWN RED 해소).
 *
 * 정기결제 다음 회차가 실패(`Transaction.Failed`)해도 웹훅은 `ignored_event` 로
 * 끝나고, Clerk plan 부여에는 만료가 없다. 그래서 미납 이후에도 유료 권한이
 * 그대로 남을 수 있다. 실패 처리 정책(즉시 회수 vs 유예 기간)은 아직 미정이라,
 * 여기서는 정책과 무관한 최소 불변식만 고정한다:
 *   "갱신 실패가 확정되면 결제 상태가 어딘가에는 반영돼야 한다"
 *   = plan 회수가 호출되거나, 조직 billingStatus 가 active 에서 벗어난다.
 *
 * 정책 확정(7일 유예 후 cron 회수)과 함께 `it.fails` → `it` 으로 바꿨다.
 * 아래 추가 테스트가 정책 세부(첫 결제 실패 무시·비최종 재시도·중복 멱등·결제 복구)를 고정한다.
 *
 * @vitest-environment node
 */

import { amountForPlan } from "@repo/payments/catalog";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPortOnePayment: vi.fn(),
  revokePlanFromPayment: vi.fn(),
  grantPlanFromPayment: vi.fn(),
  // Serves both update and updateMany; updateMany callers read `count`.
  organizationUpdate: vi.fn(async () => ({ count: 1 })),
  organizationFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  schedulePaymentWithBillingKey: vi.fn(),
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
    user: { findUnique: mocks.userFindUnique },
  },
}));

vi.mock("@repo/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/payments")>();
  return {
    ...actual,
    getPortOnePayment: mocks.getPortOnePayment,
    schedulePaymentWithBillingKey: mocks.schedulePaymentWithBillingKey,
    verifyWebhookSignature: () => ({ ok: true }),
  };
});

const { POST } = await import("../app/webhooks/payments/route");

const RENEWAL_PAYMENT_ID = "fdbl-starter-2abc-renewal";

function webhookRequest(type: string, paymentId: string): Request {
  return new Request("https://app.test/webhooks/payments", {
    method: "POST",
    body: JSON.stringify({ type, data: { paymentId, storeId: "store-1" } }),
  });
}

function failedRenewalRequest(): Request {
  return webhookRequest("Transaction.Failed", RENEWAL_PAYMENT_ID);
}

const statusWrites = () =>
  mocks.organizationUpdate.mock.calls
    .map(([args]) => args?.data?.billingStatus)
    .filter((value): value is string => typeof value === "string");

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
      billingNextPaymentAt: new Date("2026-10-01T00:00:00.000Z"),
    });
  });

  it("실패가 확정된 갱신 회차는 유료 상태에 반영된다", async () => {
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

  it("유예 기간에는 권한을 회수하지 않고 past_due 만 표시한다", async () => {
    const response = await POST(failedRenewalRequest());
    const body = (await response.json()) as { reason?: string };

    expect(body.reason).toBe("renewal_failed_grace_started");
    expect(mocks.revokePlanFromPayment).not.toHaveBeenCalled();
    expect(statusWrites()).toEqual(["past_due"]);
    const [args] = mocks.organizationUpdate.mock.calls[0] ?? [];
    expect(args.where).toMatchObject({
      billingNextPaymentId: RENEWAL_PAYMENT_ID,
      billingStatus: "active",
    });
  });

  it("첫 결제(예약 회차가 아닌 결제) 실패는 아무도 내리지 않는다", async () => {
    mocks.organizationFindFirst.mockResolvedValue(null);
    const response = await POST(
      webhookRequest("Transaction.Failed", "fdbl-starter-2abc-first")
    );
    const body = (await response.json()) as { reason?: string };

    expect(response.status).toBe(200);
    expect(body.reason).toBe("failed_not_scheduled_renewal");
    expect(mocks.organizationUpdate).not.toHaveBeenCalled();
    expect(mocks.revokePlanFromPayment).not.toHaveBeenCalled();
  });

  it("PortOne 조회가 아직 최종 실패가 아니면 재전송을 요청한다", async () => {
    mocks.getPortOnePayment.mockResolvedValue({
      id: RENEWAL_PAYMENT_ID,
      status: "PENDING",
      amount: { total: 0 },
    });
    const response = await POST(failedRenewalRequest());
    const body = (await response.json()) as { reason?: string };

    expect(response.status).toBe(500);
    expect(body.reason).toBe("failed_not_final:PENDING");
    expect(mocks.organizationUpdate).not.toHaveBeenCalled();
  });

  it("조회 자체가 실패하면 재전송을 요청한다", async () => {
    mocks.getPortOnePayment.mockRejectedValue(new Error("network"));
    const response = await POST(failedRenewalRequest());

    expect(response.status).toBe(500);
    expect(mocks.organizationUpdate).not.toHaveBeenCalled();
  });

  it("같은 실패 웹훅이 다시 와도 상태를 한 번만 바꾼다", async () => {
    await POST(failedRenewalRequest());
    mocks.organizationFindFirst.mockResolvedValue({
      id: "org-1",
      billingStatus: "past_due",
      billingNextPaymentId: RENEWAL_PAYMENT_ID,
      billingNextPaymentAt: new Date("2026-10-01T00:00:00.000Z"),
    });
    const second = await POST(failedRenewalRequest());
    const body = (await second.json()) as { reason?: string };

    expect(second.status).toBe(200);
    expect(body.reason).toBe("renewal_failed_already_recorded");
    expect(statusWrites()).toEqual(["past_due"]);
  });

  it("실패 후 같은 회차가 결제되면 active 로 돌아오고 다음 회차를 예약한다", async () => {
    mocks.getPortOnePayment.mockResolvedValue({
      id: RENEWAL_PAYMENT_ID,
      status: "PAID",
      currency: "KRW",
      paidAt: "2026-10-03T00:00:00.000Z",
      amount: { total: amountForPlan("starter") },
    });
    mocks.grantPlanFromPayment.mockResolvedValue(true);
    mocks.schedulePaymentWithBillingKey.mockResolvedValue(undefined);
    mocks.userFindUnique.mockResolvedValue({
      email: "owner@example.test",
      name: null,
      organization: {
        id: "org-1",
        billingCustomerId: "billing-key-test",
        billingNextPaymentId: RENEWAL_PAYMENT_ID,
        billingProvider: "portone",
        billingStatus: "past_due",
      },
    });

    const response = await POST(
      webhookRequest("Transaction.Paid", RENEWAL_PAYMENT_ID)
    );

    expect(response.status).toBe(200);
    expect(mocks.grantPlanFromPayment).toHaveBeenCalledWith(
      "user_2abc",
      "starter",
      RENEWAL_PAYMENT_ID
    );
    expect(mocks.schedulePaymentWithBillingKey).toHaveBeenCalledTimes(1);
    expect(statusWrites()).toEqual(["active"]);
  });
});
