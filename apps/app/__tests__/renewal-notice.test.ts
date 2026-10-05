/**
 * 정기결제 갱신 사전 안내 메일 선정·발송 (방판법 제31조·전상법 제13조 취지, 2026-10-05).
 *
 * 계약:
 *   ① `FINDABLE_RENEWAL_NOTICE_ENABLED` 가 정확히 "true" 가 아니면 DB 조회도 발송도 없다.
 *   ② Preview(메일 클라이언트 없음)에서는 보내지 않는다 — 실제 createResendClient 로 확인.
 *   ③ 다음 결제가 지금부터 3일 안(현재 이후)에 예약된 활성 정기결제만 대상이다.
 *   ④ 예약 결제(billingNextPaymentId) 1건당 1통. 두 번 돌아도 한 번만 보낸다.
 *   ⑤ 실행당 상한을 넘겨 보내지 않는다.
 *   ⑥ 발송 실패는 선점을 풀어 다음 실행에서 다시 시도한다.
 *   ⑦ 금액은 예약 결제 ID 의 plan → 서버 카탈로그(VAT 포함)에서 온다.
 * @vitest-environment node
 */

import { createResendClient } from "@repo/email";
import { buildPaymentId } from "@repo/payments/catalog";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-10-05T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const fx = vi.hoisted(() => {
  interface Org {
    billingCustomerId: string | null;
    billingNextPaymentAt: Date | null;
    billingNextPaymentId: string | null;
    billingProvider: string | null;
    billingStatus: string;
    id: string;
    name: string;
  }
  interface Notice {
    organizationId: string;
    paymentId: string;
    scheduledAt: Date;
    userId: string;
  }
  type Cond = Record<string, unknown>;
  const matchValue = (value: unknown, condition: unknown): boolean => {
    if (
      condition &&
      typeof condition === "object" &&
      !(condition instanceof Date)
    ) {
      const c = condition as Cond;
      if ("not" in c && value === c.not) {
        return false;
      }
      if ("gt" in c && !(value instanceof Date && value > (c.gt as Date))) {
        return false;
      }
      if ("lte" in c && !(value instanceof Date && value <= (c.lte as Date))) {
        return false;
      }
      if ("in" in c && !(c.in as unknown[]).includes(value)) {
        return false;
      }
      return true;
    }
    return value === condition;
  };
  const matches = (row: object, where: Cond) =>
    Object.entries(where).every(([k, c]) =>
      matchValue((row as Record<string, unknown>)[k], c)
    );
  return {
    orgs: [] as Org[],
    notices: [] as Notice[],
    users: new Map<string, string>(),
    missingLedger: { on: false },
    matches,
    log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    orgFindMany: vi.fn(),
  };
});

vi.mock("@repo/observability/log", () => ({ log: fx.log }));
vi.mock("@repo/observability/error", () => ({
  parseError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
vi.mock("@repo/database", () => ({
  database: {
    organization: {
      findMany: fx.orgFindMany.mockImplementation(
        ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
          Promise.resolve(
            fx.orgs
              .filter((o) => fx.matches(o, where))
              .sort(
                (a, b) =>
                  (a.billingNextPaymentAt?.getTime() ?? 0) -
                  (b.billingNextPaymentAt?.getTime() ?? 0)
              )
              .slice(0, take ?? 1000)
              .map((o) => ({ ...o }))
          )
      ),
    },
    user: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => {
        const email = fx.users.get(where.id);
        return Promise.resolve(email ? { email } : null);
      }),
    },
    renewalNotice: {
      findMany: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        if (fx.missingLedger.on) {
          return Promise.reject(
            Object.assign(new Error("RenewalNotice does not exist"), {
              code: "P2021",
            })
          );
        }
        return Promise.resolve(
          fx.notices
            .filter((n) => fx.matches(n, where))
            .map((n) => ({ paymentId: n.paymentId }))
        );
      }),
      create: vi.fn(({ data }: { data: (typeof fx.notices)[number] }) => {
        if (fx.notices.some((n) => n.paymentId === data.paymentId)) {
          return Promise.reject(
            Object.assign(new Error("Unique constraint failed"), {
              code: "P2002",
            })
          );
        }
        fx.notices.push({ ...data });
        return Promise.resolve({ id: `n-${fx.notices.length}` });
      }),
      deleteMany: vi.fn(({ where }: { where: { paymentId: string } }) => {
        const before = fx.notices.length;
        fx.notices = fx.notices.filter((n) => n.paymentId !== where.paymentId);
        return Promise.resolve({ count: before - fx.notices.length });
      }),
    },
  },
}));

import {
  isRenewalNoticeEnabled,
  MAX_RENEWAL_NOTICES_PER_RUN,
  type RenewalNoticeMailer,
  sendRenewalNotices,
} from "@/lib/billing/renewal-notice";

const ENABLED = { FINDABLE_RENEWAL_NOTICE_ENABLED: "true" };

const makeClient = () => {
  const send = vi.fn(
    (_payload: Record<string, unknown>, _options?: Record<string, unknown>) =>
      Promise.resolve({ data: { id: "email-1" }, error: null })
  );
  return { send, client: { emails: { send } } };
};

const addOrg = (
  id: string,
  dueInMs: number,
  overrides: Partial<(typeof fx.orgs)[number]> = {},
  plan: "starter" | "growth" | "scale" = "starter"
) => {
  const userId = `user_${id}`;
  const at = new Date(NOW.getTime() + dueInMs);
  fx.users.set(userId, `${id}@example.test`);
  fx.orgs.push({
    id,
    name: `조직 ${id}`,
    billingStatus: "active",
    billingProvider: "portone",
    billingCustomerId: `billing-key-${id}`,
    billingNextPaymentId: buildPaymentId(plan, userId, at.getTime()),
    billingNextPaymentAt: at,
    ...overrides,
  });
};

const run = (
  client: RenewalNoticeMailer | undefined,
  env: Record<string, string | undefined> = ENABLED
) =>
  sendRenewalNotices({
    now: NOW,
    client,
    from: "billing@findable.test",
    appUrl: "https://app.findable.test",
    termsUrl: "https://findable.test/ko/legal/terms",
    env,
  });

beforeEach(() => {
  fx.orgs = [];
  fx.notices = [];
  fx.users.clear();
  fx.missingLedger.on = false;
  vi.clearAllMocks();
});

describe("스위치", () => {
  it('정확히 "true" 일 때만 켜진다', () => {
    expect(isRenewalNoticeEnabled({})).toBe(false);
    expect(
      isRenewalNoticeEnabled({ FINDABLE_RENEWAL_NOTICE_ENABLED: "1" })
    ).toBe(false);
    expect(
      isRenewalNoticeEnabled({ FINDABLE_RENEWAL_NOTICE_ENABLED: "TRUE" })
    ).toBe(false);
    expect(
      isRenewalNoticeEnabled({ FINDABLE_RENEWAL_NOTICE_ENABLED: " true" })
    ).toBe(false);
    expect(isRenewalNoticeEnabled(ENABLED)).toBe(true);
  });

  it("🔴 꺼져 있으면 DB 조회도 발송도 없다", async () => {
    addOrg("a", 2 * DAY);
    const { client, send } = makeClient();
    const result = await run(client, {});
    expect(result.status).toBe("disabled");
    expect(fx.orgFindMany).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("🔴 Preview 에서는 메일 클라이언트가 없어 보내지 않는다", async () => {
    addOrg("a", 2 * DAY);
    const previewClient = createResendClient("re_test_token", {
      VERCEL_ENV: "preview",
    });
    expect(previewClient).toBeUndefined();
    const result = await run(previewClient, ENABLED);
    expect(result.status).toBe("not_configured");
    expect(result.sent).toBe(0);
    expect(fx.notices).toHaveLength(0);
  });
});

describe("대상 선정", () => {
  it("3일 안에 결제가 예약된 활성 정기결제만 고른다", async () => {
    addOrg("in-window", 2 * DAY);
    addOrg("edge", 3 * DAY);
    addOrg("too-far", 4 * DAY);
    addOrg("past", -1 * 60 * 60 * 1000);
    addOrg("canceled", 1 * DAY, {
      billingStatus: "canceled",
      billingCustomerId: null,
      billingNextPaymentId: null,
    });
    addOrg("past-due", 1 * DAY, { billingStatus: "past_due" });
    addOrg("no-key", 1 * DAY, { billingCustomerId: null });

    const { client, send } = makeClient();
    const result = await run(client);

    expect(result).toMatchObject({ status: "ran", sent: 2, failed: 0 });
    const recipients = send.mock.calls.map((c) => c[0].to).sort();
    expect(recipients).toEqual(["edge@example.test", "in-window@example.test"]);
  });

  it("🔴 같은 예약 결제에는 한 번만 보낸다(두 번 실행)", async () => {
    addOrg("a", 2 * DAY);
    const { client, send } = makeClient();
    await run(client);
    const second = await run(client);
    expect(send).toHaveBeenCalledTimes(1);
    expect(second.sent).toBe(0);
    expect(fx.notices).toHaveLength(1);
  });

  it("다음 회차(새 예약 결제 ID)에는 다시 보낸다", async () => {
    addOrg("a", 2 * DAY);
    const { client, send } = makeClient();
    await run(client);
    const org = fx.orgs[0];
    if (!org) {
      throw new Error("fixture");
    }
    const nextAt = new Date(NOW.getTime() + DAY);
    org.billingNextPaymentAt = nextAt;
    org.billingNextPaymentId = buildPaymentId(
      "starter",
      "user_a",
      nextAt.getTime()
    );
    await run(client);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("실행당 상한을 넘겨 보내지 않는다", async () => {
    for (let i = 0; i < MAX_RENEWAL_NOTICES_PER_RUN + 5; i += 1) {
      addOrg(`o${i}`, DAY + i * 60_000);
    }
    const { client, send } = makeClient();
    const result = await run(client);
    expect(send).toHaveBeenCalledTimes(MAX_RENEWAL_NOTICES_PER_RUN);
    expect(result.sent).toBe(MAX_RENEWAL_NOTICES_PER_RUN);
  });

  it("발송 실패는 선점을 풀어 다음 실행에서 다시 보낸다", async () => {
    addOrg("a", 2 * DAY);
    const { client, send } = makeClient();
    send.mockResolvedValueOnce({
      data: null,
      error: { message: "rate limited" },
    } as never);
    const first = await run(client);
    expect(first).toMatchObject({ sent: 0, failed: 1 });
    expect(fx.notices).toHaveLength(0);
    const second = await run(client);
    expect(second.sent).toBe(1);
  });

  it("🔴 발송 기록 테이블이 없으면 아무것도 보내지 않는다", async () => {
    addOrg("a", 2 * DAY);
    fx.missingLedger.on = true;
    const { client, send } = makeClient();
    const result = await run(client);
    expect(result.status).toBe("ledger_missing");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("메일 내용", () => {
  it("금액(VAT 포함)·결제일·결제수단·해지 방법과 멱등 키를 담는다", async () => {
    addOrg("a", 2 * DAY, {}, "growth");
    const { client, send } = makeClient();
    await run(client);

    const [payload, options] = send.mock.calls[0] ?? [];
    expect(payload?.to).toBe("a@example.test");
    expect(String(payload?.subject)).toContain("정기결제 예정 안내");
    expect(options?.idempotencyKey).toBe(
      `renewal-notice/${fx.orgs[0]?.billingNextPaymentId}`
    );
    const html = JSON.stringify(payload?.react);
    expect(html).toContain("429,000");
    expect(html).toContain("2026년 10월 7일");
    expect(html).toContain("간편결제");
    expect(html).toContain("https://app.findable.test/billing");
  });

  it("plan 을 읽을 수 없는 결제 ID 는 보내지 않는다", async () => {
    addOrg("a", 2 * DAY, { billingNextPaymentId: "unknown-format" });
    const { client, send } = makeClient();
    const result = await run(client);
    expect(send).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });
});
