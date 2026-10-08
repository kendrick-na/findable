/**
 * 앱 내 환불·청약철회 요청 (이용약관 제4조의3 초안 제5항, 전상법 제5조 제4항, 2026-10-05).
 *
 * 계약: ① 로그인·조직이 있어야 접수 ② 요청 1건 기록(조직·요청자·마지막 결제 ID·내용)
 *   ③ 운영자 알림(Sentry ops-alert)에 이메일·내용 같은 개인정보를 넣지 않는다
 *   ④ **고객에게 메일을 보내지 않는다** ⑤ 처리 대기 요청이 있으면 새로 만들지 않는다
 *   ⑥ 테이블이 없으면(migration 전 배포) 접수했다고 말하지 않고 이메일을 안내한다
 *   ⑦ 관리자만 목록을 본다.
 * DB·Clerk·Sentry 는 대역이고, 서버 액션은 실제 코드다.
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => {
  interface Row {
    createdAt: Date;
    id: string;
    message: string | null;
    organizationId: string;
    paymentId: string | null;
    resolvedAt: Date | null;
    status: "pending" | "resolved";
    userId: string;
  }
  const rows: Row[] = [];
  return {
    rows,
    session: {
      orgId: "org-1" as string | null,
      userId: "user_abc" as string | null,
    },
    admin: { ok: true },
    missingTable: { on: false },
    org: {
      billingLastPaymentId: "fdbl-starter-abc-mg0x1a2b" as string | null,
      name: "테스트 조직",
    },
    captureOpsAlert: vi.fn(),
    sendEmail: vi.fn(),
    log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  };
});

const missingTableError = () =>
  Object.assign(new Error("The table `public.RefundRequest` does not exist"), {
    code: "P2021",
  });

vi.mock("@repo/auth/server", () => ({
  auth: () => Promise.resolve(fx.session),
}));
vi.mock("@repo/auth/admin", () => ({
  requireAdmin: () =>
    fx.admin.ok
      ? Promise.resolve("user_admin")
      : Promise.reject(new Error("FORBIDDEN: admin only")),
}));
vi.mock("@repo/observability/ops-alert", () => ({
  captureOpsAlert: fx.captureOpsAlert,
}));
vi.mock("@repo/observability/log", () => ({ log: fx.log }));
vi.mock("@repo/observability/error", () => ({
  parseError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
vi.mock("@repo/email", () => ({ resend: { emails: { send: fx.sendEmail } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@repo/database", () => ({
  database: {
    organization: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === "org-1" ? { ...fx.org } : null)
      ),
      findMany: vi.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          where.id.in.includes("org-1") ? [{ id: "org-1", ...fx.org }] : []
        )
      ),
    },
    refundRequest: {
      findFirst: vi.fn(
        ({
          where,
        }: {
          where: { organizationId: string; status: "pending" };
        }) => {
          if (fx.missingTable.on) {
            return Promise.reject(missingTableError());
          }
          return Promise.resolve(
            fx.rows.find(
              (r) =>
                r.organizationId === where.organizationId &&
                r.status === where.status
            ) ?? null
          );
        }
      ),
      create: vi.fn(
        ({
          data,
        }: {
          data: Omit<
            (typeof fx.rows)[number],
            "createdAt" | "id" | "resolvedAt" | "status"
          >;
        }) => {
          if (fx.missingTable.on) {
            return Promise.reject(missingTableError());
          }
          const row: (typeof fx.rows)[number] = {
            ...data,
            id: `req-${fx.rows.length + 1}`,
            createdAt: new Date("2026-10-05T03:00:00.000Z"),
            resolvedAt: null,
            status: "pending",
          };
          fx.rows.push(row);
          return Promise.resolve({ ...row });
        }
      ),
      findMany: vi.fn(() => {
        if (fx.missingTable.on) {
          return Promise.reject(missingTableError());
        }
        return Promise.resolve(fx.rows.map((r) => ({ ...r })));
      }),
    },
  },
}));

import { listRefundRequests } from "@/app/actions/admin/refund-requests";
import { requestRefund } from "@/app/actions/billing/refund-request";

beforeEach(() => {
  fx.rows.length = 0;
  fx.session.orgId = "org-1";
  fx.session.userId = "user_abc";
  fx.admin.ok = true;
  fx.missingTable.on = false;
  vi.clearAllMocks();
});

describe("환불·청약철회 요청 접수", () => {
  it("요청을 기록하고 운영자에게 알리며, 고객에게 메일을 보내지 않는다", async () => {
    const result = await requestRefund({ message: "7일 안이라 철회합니다" });

    expect(result).toEqual({ ok: true, status: "created" });
    expect(fx.rows).toHaveLength(1);
    expect(fx.rows[0]).toMatchObject({
      organizationId: "org-1",
      userId: "user_abc",
      paymentId: "fdbl-starter-abc-mg0x1a2b",
      message: "7일 안이라 철회합니다",
      status: "pending",
    });

    expect(fx.captureOpsAlert).toHaveBeenCalledTimes(1);
    const [, context] = fx.captureOpsAlert.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(context).toMatchObject({
      requestId: "req-1",
      organizationId: "org-1",
    });
    // 개인정보·자유 입력은 알림에 싣지 않는다.
    expect(JSON.stringify(context)).not.toContain("철회합니다");
    expect(JSON.stringify(context)).not.toContain("@");

    expect(fx.sendEmail).not.toHaveBeenCalled();
  });

  it("빈 내용은 null 로, 500자를 넘는 내용은 잘라 저장한다", async () => {
    await requestRefund({ message: "   " });
    expect(fx.rows[0]?.message).toBeNull();

    fx.rows.length = 0;
    await requestRefund({ message: "가".repeat(800) });
    expect(fx.rows[0]?.message).toHaveLength(500);
  });

  it("처리 대기 요청이 이미 있으면 새로 만들지 않고 알리지 않는다", async () => {
    await requestRefund({});
    fx.captureOpsAlert.mockClear();

    const again = await requestRefund({ message: "다시" });
    expect(again).toEqual({ ok: true, status: "already_pending" });
    expect(fx.rows).toHaveLength(1);
    expect(fx.captureOpsAlert).not.toHaveBeenCalled();
  });

  it("로그인·조직이 없으면 거절한다", async () => {
    fx.session.orgId = null;
    const result = await requestRefund({});
    expect(result).toMatchObject({ ok: false });
    expect(fx.rows).toHaveLength(0);
    expect(fx.captureOpsAlert).not.toHaveBeenCalled();
  });

  it("🔴 테이블이 없으면 접수했다고 말하지 않고 이메일을 안내한다(운영자에겐 알린다)", async () => {
    fx.missingTable.on = true;
    const result = await requestRefund({ message: "철회" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("kendrick@indigochild.kr");
    }
    expect(fx.captureOpsAlert).toHaveBeenCalledTimes(1);
    expect(fx.sendEmail).not.toHaveBeenCalled();
  });
});

describe("관리자 환불 요청 목록", () => {
  it("관리자는 요청과 조직 이름을 본다", async () => {
    await requestRefund({ message: "철회 요청" });
    const rows = await listRefundRequests();
    expect(rows).toEqual([
      expect.objectContaining({
        id: "req-1",
        organizationId: "org-1",
        organizationName: "테스트 조직",
        paymentId: "fdbl-starter-abc-mg0x1a2b",
        message: "철회 요청",
        status: "pending",
      }),
    ]);
  });

  it("관리자가 아니면 throw", async () => {
    fx.admin.ok = false;
    await expect(listRefundRequests()).rejects.toThrow("FORBIDDEN");
  });

  it("테이블이 없으면 빈 목록", async () => {
    fx.missingTable.on = true;
    await expect(listRefundRequests()).resolves.toEqual([]);
  });
});
