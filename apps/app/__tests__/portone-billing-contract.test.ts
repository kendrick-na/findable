/**
 * PortOne V2 계약 — 실청구 없이 요청 모양과 응답 파싱을 고정한다.
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPayment,
  schedulePaymentWithBillingKey,
} from "@repo/payments/portone";

const originalSecret = process.env.PORTONE_API_SECRET;

beforeEach(() => {
  process.env.PORTONE_API_SECRET = "test-portone-secret";
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalSecret === undefined) {
    delete process.env.PORTONE_API_SECRET;
  } else {
    process.env.PORTONE_API_SECRET = originalSecret;
  }
});

describe("PortOne V2 결제·정기결제 계약", () => {
  it("단건 조회는 V2의 최상위 currency를 읽는다", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "fdbl-starter-user_1-x",
          storeId: "store-1",
          status: "PAID",
          amount: { total: 108_900 },
          currency: "KRW",
        }),
        { status: 200 }
      )
    );

    await expect(getPayment("fdbl-starter-user_1-x")).resolves.toMatchObject({
      amount: { total: 108_900 },
      currency: "KRW",
      status: "PAID",
    });
  });

  it("다음 달 예약은 billing-key·채널·KRW·청구 시각을 PortOne V2 형식으로 보낸다", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const timeToPay = new Date("2026-10-22T11:00:00.000Z");

    await schedulePaymentWithBillingKey({
      billingKey: "billing-key-test",
      channelKey: "channel-key-test",
      currency: "KRW",
      customerEmail: "billing-test@example.com",
      customerName: "Billing Test",
      orderName: "Findable starter 월 정기결제",
      paymentId: "fdbl-starter-user_1-next",
      timeToPay,
      totalAmount: 108_900,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.portone.io/payments/fdbl-starter-user_1-next/schedule",
      expect.objectContaining({ method: "POST" })
    );
    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String((request as RequestInit).body))).toEqual({
      payment: {
        billingKey: "billing-key-test",
        channelKey: "channel-key-test",
        orderName: "Findable starter 월 정기결제",
        customer: {
          fullName: "Billing Test",
          email: "billing-test@example.com",
        },
        amount: { total: 108_900 },
        currency: "KRW",
      },
      timeToPay: "2026-10-22T11:00:00.000Z",
    });
  });

  it("같은 예약 ID의 웹훅 재시도는 중복 청구가 아니라 성공으로 끝낸다", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ type: "PAYMENT_SCHEDULE_ALREADY_EXISTS" }),
        { status: 409 }
      )
    );

    await expect(
      schedulePaymentWithBillingKey({
        billingKey: "billing-key-test",
        channelKey: "channel-key-test",
        currency: "KRW",
        customerName: "Billing Test",
        orderName: "Findable starter 월 정기결제",
        paymentId: "fdbl-starter-user_1-next",
        timeToPay: new Date("2026-10-22T11:00:00.000Z"),
        totalAmount: 108_900,
      })
    ).resolves.toBeUndefined();
  });
});
