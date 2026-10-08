/**
 * 결제 권한 기간 만료 — 해지한 구독과 1회 결제가 "영구 유료"로 남지 않게 한다(2026-10-05).
 *
 * 재현된 구멍(main 603e51d):
 *   (a) unsubscribe 가 billingLastPaymentId·billingNextPaymentAt 을 지워
 *       이용 기간 끝을 아무도 알 수 없었고, Clerk 결제 출처는 그대로 남았다.
 *   (b) 1회 결제(checkout.ts)는 Clerk 결제 출처만 쓰고 만료가 없었다.
 *   Clerk 결제 출처가 남으면 resolveEffectivePlan 이 Clerk plan 을 그대로 인정한다.
 *
 * 정책(컨트롤타워 승인):
 *   - 해지: 이미 결제한 기간 끝(billingNextPaymentAt)까지 유지, 그 뒤 만료. 유예 없음.
 *     DB 는 renewal grace 와 같은 "expired" 로 닫는다.
 *   - 1회 결제: 결제 시각(paymentId) + 1개월 뒤 만료.
 *   - 파트너·초대·관리자 권한(결제 출처 없음)은 건드리지 않는다.
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPaymentId, nextBillingDate } from "@repo/payments";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  orgFindMany: vi.fn(),
  orgFindUnique: vi.fn(),
  orgUpdate: vi.fn(),
  orgUpdateMany: vi.fn(),
  userFindMany: vi.fn(),
  getUser: vi.fn(),
  getUserList: vi.fn(),
  updateUserMetadata: vi.fn(),
  auth: vi.fn(),
  cancelBillingKeySchedules: vi.fn(),
  deleteBillingKey: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  database: {
    // plan-grant serializes per-user Clerk writes in an advisory-lock transaction.
    $transaction: async (
      fn: (tx: { $executeRaw: () => Promise<number> }) => unknown
    ) => fn({ $executeRaw: async () => 1 }),
    organization: {
      findMany: mocks.orgFindMany,
      findUnique: mocks.orgFindUnique,
      update: mocks.orgUpdate,
      updateMany: mocks.orgUpdateMany,
    },
    user: { findMany: mocks.userFindMany },
  },
}));

// plan-grant 와 @repo/auth/server 가 함께 쓰는 Clerk 복사본을 가로챈다.
vi.mock(
  "../../../packages/auth/node_modules/@clerk/nextjs/dist/esm/server/index.js",
  () => ({
    auth: mocks.auth,
    currentUser: vi.fn(),
    clerkClient: vi.fn(async () => ({
      users: {
        getUser: mocks.getUser,
        getUserList: mocks.getUserList,
        updateUserMetadata: mocks.updateUserMetadata,
      },
    })),
  })
);

vi.mock("@repo/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/payments")>();
  return {
    ...actual,
    cancelBillingKeySchedules: mocks.cancelBillingKeySchedules,
    deleteBillingKey: mocks.deleteBillingKey,
  };
});

const { expireCancelledSubscriptions, expireOneOffPaymentGrants } =
  await import("../lib/billing/period-end-expiry");
const { unsubscribe } = await import("../app/actions/billing/subscription");

const DAY = 24 * 60 * 60 * 1000;
const SUBSCRIBER = "user_sub1";
const BUYER = "user_buy1";
const NOW = new Date("2026-10-05T00:00:00.000Z");

const PAID_AT = new Date("2026-08-20T00:00:00.000Z");
const PERIOD_END = nextBillingDate(PAID_AT); // 2026-09-20 (지남)
const SUB_PAYMENT_ID = buildPaymentId("starter", SUBSCRIBER, PAID_AT.getTime());

const OLD_ONE_OFF = buildPaymentId("growth", BUYER, NOW.getTime() - 40 * DAY);
const FRESH_ONE_OFF = buildPaymentId(
  "starter",
  BUYER,
  NOW.getTime() - 10 * DAY
);

const grantMetadata = (
  entries: Array<{ paymentId: string | null; plan: string }>
) => ({
  findablePaymentId: entries[0]?.paymentId ?? null,
  findablePaymentGrantStack: entries,
});

const clerkUser = (
  id: string,
  plan: string,
  privateMetadata: Record<string, unknown> | null
) => ({ id, publicMetadata: { plan }, privateMetadata });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.orgFindMany.mockResolvedValue([]);
  mocks.orgUpdateMany.mockResolvedValue({ count: 1 });
  mocks.userFindMany.mockResolvedValue([]);
  mocks.getUserList.mockResolvedValue({ data: [], totalCount: 0 });
  mocks.updateUserMetadata.mockResolvedValue({});
});

describe("(a) 해지한 구독", () => {
  it("해지가 이용 기간 끝(paid-through) 증거를 지우지 않는다", async () => {
    mocks.auth.mockResolvedValue({ userId: SUBSCRIBER, orgId: "org-sub" });
    mocks.orgFindUnique.mockResolvedValue({
      billingCustomerId: "billing-key-test",
      // 해지는 결제한 멤버 본인 또는 관리자만 가능하다(G7 정책).
      billingLastPaymentId: SUB_PAYMENT_ID,
      billingProvider: "portone",
    });
    mocks.cancelBillingKeySchedules.mockResolvedValue(undefined);
    mocks.deleteBillingKey.mockResolvedValue(undefined);

    expect(await unsubscribe()).toEqual({ ok: true });
    const [args] = mocks.orgUpdate.mock.calls[0] ?? [];
    expect(args.data).toMatchObject({
      billingStatus: "canceled",
      billingNextPaymentId: null,
    });
    expect(args.data).not.toHaveProperty("billingLastPaymentId");
    expect(args.data).not.toHaveProperty("billingNextPaymentAt");
  });

  it("이용 기간이 끝난 해지 조직만 조회한다(유예 없음)", async () => {
    await expireCancelledSubscriptions(NOW);
    const [args] = mocks.orgFindMany.mock.calls[0] ?? [];
    expect(args.where).toEqual({
      id: { notIn: ["f1dab1e0-5a1e-4000-8000-00000000a001"] },
      billingStatus: "canceled",
      billingLastPaymentId: { not: null },
      billingNextPaymentAt: { lte: NOW },
    });
  });

  it("기간이 끝나면 Clerk 결제 권한과 DB 상태를 함께 닫는다", async () => {
    mocks.orgFindMany.mockResolvedValue([
      {
        id: "org-sub",
        billingLastPaymentId: SUB_PAYMENT_ID,
        billingNextPaymentAt: PERIOD_END,
      },
    ]);
    mocks.getUser.mockResolvedValue(
      clerkUser(
        SUBSCRIBER,
        "starter",
        grantMetadata([
          { paymentId: SUB_PAYMENT_ID, plan: "starter" },
          { paymentId: null, plan: "free" },
        ])
      )
    );

    const result = await expireCancelledSubscriptions(NOW);

    expect(result).toEqual({ expired: 1, scanned: 1, failed: 0 });
    expect(mocks.updateUserMetadata).toHaveBeenCalledWith(SUBSCRIBER, {
      publicMetadata: { plan: "free" },
      privateMetadata: {
        findablePaymentId: null,
        findablePaymentGrantStack: null,
      },
    });
    expect(mocks.orgUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "org-sub",
        billingStatus: "canceled",
        billingLastPaymentId: SUB_PAYMENT_ID,
        billingNextPaymentAt: PERIOD_END,
      },
      data: { billingStatus: "expired" },
    });
  });

  it("다시 실행해도 Clerk 를 또 쓰지 않는다(멱등)", async () => {
    mocks.orgFindMany.mockResolvedValue([
      {
        id: "org-sub",
        billingLastPaymentId: SUB_PAYMENT_ID,
        billingNextPaymentAt: PERIOD_END,
      },
    ]);
    // 직전 실행에서 Clerk 는 정리됐지만 DB 갱신 전에 끊긴 상황.
    mocks.getUser.mockResolvedValue(clerkUser(SUBSCRIBER, "free", {}));

    const result = await expireCancelledSubscriptions(NOW);

    expect(mocks.updateUserMetadata).not.toHaveBeenCalled();
    expect(result.expired).toBe(1);
  });

  it("Clerk 반영이 실패하면 DB 를 canceled 로 남겨 다음 실행이 다시 시도한다", async () => {
    mocks.orgFindMany.mockResolvedValue([
      {
        id: "org-sub",
        billingLastPaymentId: SUB_PAYMENT_ID,
        billingNextPaymentAt: PERIOD_END,
      },
    ]);
    mocks.getUser.mockResolvedValue(
      clerkUser(
        SUBSCRIBER,
        "starter",
        grantMetadata([{ paymentId: SUB_PAYMENT_ID, plan: "starter" }])
      )
    );
    mocks.updateUserMetadata.mockRejectedValue(new Error("clerk down"));

    const result = await expireCancelledSubscriptions(NOW);

    expect(result).toEqual({ expired: 0, scanned: 1, failed: 1 });
    expect(mocks.orgUpdateMany).not.toHaveBeenCalled();
  });
});

describe("(b) 1회 결제", () => {
  beforeEach(() => {
    mocks.userFindMany.mockResolvedValue([{ id: BUYER }]);
  });

  it("결제 후 1개월이 지난 1회 결제 권한을 회수한다", async () => {
    const metadata = grantMetadata([
      { paymentId: OLD_ONE_OFF, plan: "growth" },
      { paymentId: null, plan: "free" },
    ]);
    mocks.getUserList.mockResolvedValue({
      data: [clerkUser(BUYER, "growth", metadata)],
    });
    mocks.getUser.mockResolvedValue(clerkUser(BUYER, "growth", metadata));

    const result = await expireOneOffPaymentGrants(NOW);

    expect(result).toMatchObject({ expired: 1, failed: 0 });
    expect(mocks.updateUserMetadata).toHaveBeenCalledWith(BUYER, {
      publicMetadata: { plan: "free" },
      privateMetadata: {
        findablePaymentId: null,
        findablePaymentGrantStack: null,
      },
    });
  });

  it("아직 1개월이 안 된 결제는 그대로 둔다", async () => {
    const metadata = grantMetadata([
      { paymentId: FRESH_ONE_OFF, plan: "starter" },
      { paymentId: null, plan: "free" },
    ]);
    mocks.getUserList.mockResolvedValue({
      data: [clerkUser(BUYER, "starter", metadata)],
    });

    const result = await expireOneOffPaymentGrants(NOW);

    expect(result.expired).toBe(0);
    expect(mocks.updateUserMetadata).not.toHaveBeenCalled();
  });

  it("유효한 결제와 만료된 결제를 함께 가진 사용자는 유효한 것만 남긴다", async () => {
    const metadata = grantMetadata([
      { paymentId: OLD_ONE_OFF, plan: "growth" },
      { paymentId: FRESH_ONE_OFF, plan: "starter" },
      { paymentId: null, plan: "free" },
    ]);
    mocks.getUserList.mockResolvedValue({
      data: [clerkUser(BUYER, "growth", metadata)],
    });
    mocks.getUser.mockResolvedValue(clerkUser(BUYER, "growth", metadata));

    await expireOneOffPaymentGrants(NOW);

    expect(mocks.updateUserMetadata).toHaveBeenCalledWith(BUYER, {
      publicMetadata: { plan: "starter" },
      privateMetadata: {
        findablePaymentId: FRESH_ONE_OFF,
        findablePaymentGrantStack: [
          { paymentId: FRESH_ONE_OFF, plan: "starter" },
          { paymentId: null, plan: "free" },
        ],
      },
    });
  });

  it("두 번째 실행은 아무것도 쓰지 않는다(멱등)", async () => {
    const metadata = grantMetadata([
      { paymentId: OLD_ONE_OFF, plan: "growth" },
      { paymentId: null, plan: "free" },
    ]);
    mocks.getUserList.mockResolvedValueOnce({
      data: [clerkUser(BUYER, "growth", metadata)],
    });
    mocks.getUser.mockResolvedValueOnce(clerkUser(BUYER, "growth", metadata));
    await expireOneOffPaymentGrants(NOW);

    mocks.getUserList.mockResolvedValueOnce({
      data: [clerkUser(BUYER, "free", null)],
    });
    const second = await expireOneOffPaymentGrants(NOW);

    expect(second.expired).toBe(0);
    expect(mocks.updateUserMetadata).toHaveBeenCalledTimes(1);
  });

  it("파트너·초대·관리자 권한(결제 출처 없음)은 건드리지 않는다", async () => {
    mocks.getUserList.mockResolvedValue({
      data: [clerkUser(BUYER, "growth", null)],
    });

    await expireOneOffPaymentGrants(NOW);

    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.updateUserMetadata).not.toHaveBeenCalled();
  });

  it("살아 있는 구독(active·유예 중 past_due·기간 남은 해지) 사용자는 건너뛴다", async () => {
    mocks.orgFindMany.mockResolvedValue([
      { ownerId: BUYER, billingLastPaymentId: null, users: [] },
    ]);
    mocks.getUserList.mockResolvedValue({
      data: [
        clerkUser(
          BUYER,
          "growth",
          grantMetadata([{ paymentId: OLD_ONE_OFF, plan: "growth" }])
        ),
      ],
    });

    await expireOneOffPaymentGrants(NOW);

    const [protectedArgs] = mocks.orgFindMany.mock.calls[0] ?? [];
    expect(protectedArgs.where).toEqual({
      id: { notIn: ["f1dab1e0-5a1e-4000-8000-00000000a001"] },
      OR: [
        { billingStatus: "active" },
        { billingStatus: "past_due", billingNextPaymentId: { not: null } },
        { billingStatus: "canceled", billingNextPaymentAt: { gt: NOW } },
      ],
    });
    expect(mocks.getUserList).not.toHaveBeenCalled();
    expect(mocks.updateUserMetadata).not.toHaveBeenCalled();
  });

  it("Clerk 목록 조회가 실패하면 아무것도 쓰지 않고 다음 실행으로 넘긴다", async () => {
    mocks.getUserList.mockRejectedValue(new Error("clerk down"));

    const result = await expireOneOffPaymentGrants(NOW);

    expect(result).toMatchObject({ expired: 0, failed: 1 });
    expect(mocks.updateUserMetadata).not.toHaveBeenCalled();
  });

  it("Clerk 쓰기가 실패하면 실패로 세고 권한을 늘리지 않는다", async () => {
    const metadata = grantMetadata([
      { paymentId: OLD_ONE_OFF, plan: "growth" },
    ]);
    mocks.getUserList.mockResolvedValue({
      data: [clerkUser(BUYER, "growth", metadata)],
    });
    mocks.getUser.mockResolvedValue(clerkUser(BUYER, "growth", metadata));
    mocks.updateUserMetadata.mockRejectedValue(new Error("clerk down"));

    const result = await expireOneOffPaymentGrants(NOW);

    expect(result).toMatchObject({ expired: 0, failed: 1 });
  });
});

describe("배포 경로", () => {
  it("스케줄된 apps/app auto-refresh cron 이 두 만료 단계를 측정 선정 전에 호출한다", () => {
    const source = readFileSync(
      join(process.cwd(), "app/api/cron/auto-refresh-tracking/route.ts"),
      "utf8"
    );
    const cancelled = source.indexOf("await expireCancelledSubscriptions(");
    const oneOff = source.indexOf("await expireOneOffPaymentGrants(");
    const selection = source.indexOf("await loadAutoRefreshOrganizations(");
    expect(cancelled).toBeGreaterThan(0);
    expect(oneOff).toBeGreaterThan(0);
    expect(selection).toBeGreaterThan(Math.max(cancelled, oneOff));
  });
});
