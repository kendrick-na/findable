/**
 * 갱신 결제 실패 유예 만료 — cron 이 DB(billingStatus)와 Clerk 결제 권한을 함께 내린다.
 *
 * 결제 권한은 Organization.plan 이 아니라 Clerk publicMetadata.plan + 결제 출처에만 있다.
 * 그래서 유예 만료는 Clerk 결제 출처를 지워야 실제 게이팅(resolveEffectivePlan)이 내려간다.
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveEffectivePlan } from "@repo/auth/plan";
import { paymentGrantAfterExpiry } from "@repo/auth/plan-grant";
import {
  buildPaymentId,
  nextBillingDate,
  paymentIssuedAtFromPaymentId,
  RENEWAL_FAILURE_GRACE_DAYS,
  renewalGraceCutoff,
  renewalGraceEndsAt,
} from "@repo/payments";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  getUser: vi.fn(),
  updateUserMetadata: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  database: {
    // plan-grant serializes per-user Clerk writes in an advisory-lock transaction.
    $transaction: async (
      fn: (tx: { $executeRaw: () => Promise<number> }) => unknown
    ) => fn({ $executeRaw: async () => 1 }),
    organization: { findMany: mocks.findMany, updateMany: mocks.updateMany },
  },
}));

// auth 패키지가 실제 import하는 Clerk 복사본을 가로챈다(payment-plan-provenance 와 같은 방식).
vi.mock(
  "../../../packages/auth/node_modules/@clerk/nextjs/dist/esm/server/index.js",
  () => ({
    clerkClient: vi.fn(async () => ({
      users: {
        getUser: mocks.getUser,
        updateUserMetadata: mocks.updateUserMetadata,
      },
    })),
  })
);

const { expireLapsedRenewalGrants, isPaidPeriodOver } = await import(
  "../lib/billing/renewal-grace"
);

const USER_ID = "user_2abc";
const DAY = 24 * 60 * 60 * 1000;
const FIRST_AT = new Date("2026-08-01T00:00:00.000Z");
const RENEWAL_AT = nextBillingDate(FIRST_AT); // 2026-09-01
const FAILED_AT = nextBillingDate(RENEWAL_AT); // 2026-10-01
const FIRST_ID = buildPaymentId("starter", USER_ID, FIRST_AT.getTime());
const RENEWAL_ID = buildPaymentId("starter", USER_ID, RENEWAL_AT.getTime());
const FAILED_ID = buildPaymentId("starter", USER_ID, FAILED_AT.getTime());

/** 첫 결제 + 1회 갱신이 쌓인 Clerk 결제 출처(실제 grantPlanFromPayment 결과 형태). */
const SUBSCRIBER_METADATA = {
  findablePaymentId: RENEWAL_ID,
  findablePaymentGrantStack: [
    { paymentId: RENEWAL_ID, plan: "starter" },
    { paymentId: FIRST_ID, plan: "starter" },
    { paymentId: null, plan: "free" },
  ],
};

describe("유예 기간 계산", () => {
  it("유예는 7일이고 한 곳에서 계산한다", () => {
    expect(RENEWAL_FAILURE_GRACE_DAYS).toBe(7);
    expect(renewalGraceEndsAt(FAILED_AT).getTime() - FAILED_AT.getTime()).toBe(
      7 * DAY
    );
    expect(renewalGraceCutoff(renewalGraceEndsAt(FAILED_AT))).toEqual(
      FAILED_AT
    );
  });

  it("paymentId 의 시각 조각을 복원하고, 형식이 아니면 null", () => {
    expect(paymentIssuedAtFromPaymentId(RENEWAL_ID)).toEqual(RENEWAL_AT);
    expect(paymentIssuedAtFromPaymentId("partner-grant")).toBeNull();
  });

  it("이용 기간이 끝난 결제만 만료 대상이다", () => {
    const now = renewalGraceEndsAt(FAILED_AT);
    expect(isPaidPeriodOver(FIRST_ID, now)).toBe(true);
    expect(isPaidPeriodOver(RENEWAL_ID, now)).toBe(true);
    const recent = buildPaymentId("growth", USER_ID, now.getTime() - DAY);
    expect(isPaidPeriodOver(recent, now)).toBe(false);
    // P1-1: an unparseable payment source counts as expired (never "forever").
    expect(isPaidPeriodOver("partner-grant", now)).toBe(true);
  });
});

describe("paymentGrantAfterExpiry", () => {
  it("정기결제 회차가 모두 끝나면 직전 회차로 '복구'되지 않고 free 가 된다", () => {
    const next = paymentGrantAfterExpiry(
      "starter",
      SUBSCRIBER_METADATA,
      () => true
    );
    expect(next).toEqual({
      plan: "free",
      privateMetadata: null,
      expired: true,
    });
  });

  it("아직 기간이 남은 다른 결제 권한은 남긴다", () => {
    const recentId = buildPaymentId("growth", USER_ID, FAILED_AT.getTime());
    const next = paymentGrantAfterExpiry(
      "growth",
      {
        findablePaymentId: recentId,
        findablePaymentGrantStack: [
          { paymentId: recentId, plan: "growth" },
          ...SUBSCRIBER_METADATA.findablePaymentGrantStack,
        ],
      },
      (id) => id !== recentId
    );
    expect(next.plan).toBe("growth");
    expect(next.privateMetadata).toEqual({
      findablePaymentId: recentId,
      findablePaymentGrantStack: [
        { paymentId: recentId, plan: "growth" },
        { paymentId: null, plan: "free" },
      ],
    });
  });

  it("결제 출처가 없는 권한(파트너·초대·관리자)은 건드리지 않는다", () => {
    expect(paymentGrantAfterExpiry("growth", null, () => true)).toEqual({
      plan: "growth",
      privateMetadata: null,
      expired: false,
    });
  });
});

describe("expireLapsedRenewalGrants (cron)", () => {
  const graceOver = new Date(renewalGraceEndsAt(FAILED_AT).getTime() + 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([
      { id: "org-1", billingNextPaymentId: FAILED_ID },
    ]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.getUser.mockResolvedValue({
      publicMetadata: { plan: "starter" },
      privateMetadata: SUBSCRIBER_METADATA,
    });
    mocks.updateUserMetadata.mockResolvedValue({});
  });

  it("유예가 끝난 past_due 조직만 조회한다", async () => {
    await expireLapsedRenewalGrants(graceOver);
    const [args] = mocks.findMany.mock.calls[0] ?? [];
    expect(args.where).toEqual({
      billingStatus: "past_due",
      billingNextPaymentId: { not: null },
      billingNextPaymentAt: { lte: renewalGraceCutoff(graceOver) },
    });
  });

  it("유예 만료 시 Clerk 게이팅 plan 과 DB billingStatus 를 함께 내린다", async () => {
    const result = await expireLapsedRenewalGrants(graceOver);

    expect(result).toEqual({ expired: 1, scanned: 1, failed: 0 });
    expect(mocks.getUser).toHaveBeenCalledWith(USER_ID);
    expect(mocks.updateUserMetadata).toHaveBeenCalledWith(USER_ID, {
      publicMetadata: { plan: "free" },
      privateMetadata: {
        findablePaymentId: null,
        findablePaymentGrantStack: null,
      },
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "org-1",
        billingStatus: "past_due",
        billingNextPaymentId: FAILED_ID,
      },
      data: { billingStatus: "expired" },
    });

    // 실제 서버 게이트도 free 로 판정한다(결제 출처가 사라졌으므로 Clerk plan 이 free).
    expect(
      resolveEffectivePlan({
        clerkPlan: "free",
        organizationPlan: "free",
        organizationPlanExpiresAt: null,
        hasCurrentPaymentGrant: false,
      })
    ).toBe("free");
  });

  it("Clerk push 가 실패하면 DB 를 past_due 로 남겨 다음 cron 이 다시 시도한다", async () => {
    mocks.updateUserMetadata.mockRejectedValue(new Error("clerk down"));
    const result = await expireLapsedRenewalGrants(graceOver);

    expect(result).toEqual({ expired: 0, scanned: 1, failed: 1 });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("이미 회수된 사용자(중복 실행)는 Clerk 를 다시 쓰지 않고 DB 만 닫는다", async () => {
    mocks.getUser.mockResolvedValue({
      publicMetadata: { plan: "free" },
      privateMetadata: {},
    });
    const result = await expireLapsedRenewalGrants(graceOver);

    expect(mocks.updateUserMetadata).not.toHaveBeenCalled();
    expect(result.expired).toBe(1);
  });

  it("대상이 없으면 아무것도 쓰지 않는다", async () => {
    mocks.findMany.mockResolvedValue([]);
    const result = await expireLapsedRenewalGrants(graceOver);

    expect(result).toEqual({ expired: 0, scanned: 0, failed: 0 });
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe("배포 경로", () => {
  it("실제 스케줄된 apps/app auto-refresh cron 이 유예 만료를 호출한다", () => {
    const source = readFileSync(
      join(process.cwd(), "app/api/cron/auto-refresh-tracking/route.ts"),
      "utf8"
    );
    expect(source).toContain(
      'import { expireLapsedRenewalGrants } from "@/lib/billing/renewal-grace";'
    );
    expect(source).toContain("await expireLapsedRenewalGrants(now)");
  });
});
