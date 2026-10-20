/**
 * Clerk 웹훅 개인정보 — 2026-10-20 대표 결정 ①③.
 *  ① user.deleted 가 실제로 회원 정보 삭제를 부르고, 실패하면 500(Clerk 재시도)을 돌려준다.
 *  ③ PostHog 로 이메일·이름·전화번호·사진 주소를 보내지 않는다(내부 id 만).
 * 진짜 route 를 import 해서 POST 를 호출한다(서명 검증·DB·PostHog 는 가짜). 운영 호출 0.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  event: { type: "", data: {} } as { type: string; data: object },
  identify: vi.fn(),
  groupIdentify: vi.fn(),
  capture: vi.fn(),
  erase: vi.fn(),
  presence: vi.fn(),
  userUpsert: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@/env", () => ({ env: { CLERK_WEBHOOK_SECRET: "whsec_test" } }));
vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve(
      new Headers({
        "svix-id": "msg_1",
        "svix-timestamp": "1",
        "svix-signature": "v1,sig",
      })
    ),
}));
vi.mock("svix", () => ({
  Webhook: class {
    verify() {
      return h.event;
    }
  },
}));
vi.mock("@repo/analytics/server", () => ({
  analytics: {
    identify: h.identify,
    groupIdentify: h.groupIdentify,
    capture: h.capture,
    shutdown: () => Promise.resolve(),
  },
}));
vi.mock("@repo/database", () => ({
  database: {
    user: { upsert: h.userUpsert },
    organization: { upsert: vi.fn(() => Promise.resolve({})) },
  },
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: h.logWarn, error: h.logError },
}));
vi.mock("@/lib/privacy/erase-deleted-user", () => ({
  eraseDeletedUser: h.erase,
}));
vi.mock("@/lib/privacy/clerk-user-presence", () => ({
  clerkUserPresence: h.presence,
}));

const { POST } = await import("../app/webhooks/auth/route");

const post = (type: string, data: object) => {
  h.event = { type, data };
  return POST(
    new Request("https://app.test/webhooks/auth", {
      method: "POST",
      body: JSON.stringify({ type, data }),
    })
  );
};

const PII_KEYS = [
  "email",
  "firstName",
  "lastName",
  "name",
  "avatar",
  "phoneNumber",
  "image_url",
];
const PII_VALUES = [
  "kim@example.com",
  "길동",
  "홍",
  "+821012345678",
  "https://img.clerk.com/me.png",
];

const clerkUser = {
  id: "user_1",
  email_addresses: [{ email_address: "kim@example.com" }],
  first_name: "길동",
  last_name: "홍",
  created_at: 1_760_000_000_000,
  image_url: "https://img.clerk.com/me.png",
  phone_numbers: [{ phone_number: "+821012345678" }],
};

const erased = {
  userFound: true,
  usersDeleted: 1,
  partnerApplicationsDeleted: 0,
  mailboxConnectionsRevoked: 0,
  actionCompletionsUnlinked: 0,
  annotationsUnlinked: 0,
  contentReviewEventsUnlinked: 0,
  contentRevisionsUnlinked: 0,
  auditJobEmailsErased: 0,
  leadEmailsErased: 0,
  searchConnectionsRevoked: 0,
  outreachDraftSendersCleared: 0,
  emailHoldReason: null as "role_address" | "shared_with_other_user" | null,
  heldAuditJobIds: [] as string[],
  heldLeadIds: [] as string[],
  ownershipTransfers: [] as { orgId: string; newOwnerId: string }[],
  soleOwnerOrgIds: [] as string[],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.presence.mockResolvedValue("exists");
  h.userUpsert.mockResolvedValue({});
});

describe("② 늦은 가입·수정 웹훅이 탈퇴자를 되살리지 않는다", () => {
  it.each([
    "user.created",
    "user.updated",
  ])("%s: Clerk 에 있으면 평소대로 적재한다", async (type) => {
    const res = await post(type, clerkUser);
    expect(h.presence).toHaveBeenCalledWith("user_1");
    expect(h.userUpsert).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(201);
  });

  it.each([
    "user.created",
    "user.updated",
  ])("🔴 삭제 뒤 늦게 온 %s: Clerk 에 없으면(404) 행을 만들지 않고 PostHog 에도 안 보낸다", async (type) => {
    h.erase.mockResolvedValueOnce(erased);
    await post("user.deleted", { id: "user_1", deleted: true });
    vi.clearAllMocks();
    h.presence.mockResolvedValueOnce("gone");

    const res = await post(type, clerkUser);
    expect(h.userUpsert).not.toHaveBeenCalled();
    expect(h.identify).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("🔴 Clerk 조회가 실패하면 500 — 모르는 채로 적재하지 않고 Clerk 재시도를 기다린다", async () => {
    h.presence.mockRejectedValueOnce(new Error("network down"));
    const res = await post("user.updated", clerkUser);
    expect(res.status).toBe(500);
    expect(h.userUpsert).not.toHaveBeenCalled();
    expect(h.logError).toHaveBeenCalledWith(
      "webhook.user.clerk_lookup_failed",
      expect.objectContaining({ userId: "user_1" })
    );
  });
});

describe("이메일 보류 로그에는 id·건수만 남는다", () => {
  it("보류 사유·건수·id 를 남기고 이메일 원문은 없다", async () => {
    h.erase.mockResolvedValueOnce({
      ...erased,
      emailHoldReason: "role_address",
      heldAuditJobIds: ["job_1", "job_2"],
      heldLeadIds: ["lead_1"],
    });
    await post("user.deleted", { id: "user_1", deleted: true });
    expect(h.logWarn).toHaveBeenCalledWith("privacy.user_erase.email_held", {
      userId: "user_1",
      reason: "role_address",
      auditJobCount: 2,
      auditJobIds: ["job_1", "job_2"],
      leadCount: 1,
      leadIds: ["lead_1"],
    });
    expect(JSON.stringify(h.logWarn.mock.calls)).not.toContain("@");
  });
});

describe("③ PostHog 로 개인 식별 정보를 보내지 않는다", () => {
  it.each([
    "user.created",
    "user.updated",
  ])("%s: identify 는 내부 id 와 가입 시각만 보낸다", async (type) => {
    await post(type, clerkUser);
    expect(h.identify).toHaveBeenCalledTimes(1);
    const call = h.identify.mock.calls[0][0] as {
      distinctId: string;
      properties: Record<string, unknown>;
    };
    expect(call.distinctId).toBe("user_1");
    expect(Object.keys(call.properties)).toEqual(["createdAt"]);
    const sent = JSON.stringify(h.identify.mock.calls);
    for (const key of PII_KEYS) {
      expect(call.properties, key).not.toHaveProperty(key);
    }
    for (const value of PII_VALUES) {
      expect(sent, value).not.toContain(value);
    }
  });

  it.each([
    "organization.created",
    "organization.updated",
  ])("%s: 조직 사진 주소를 보내지 않는다", async (type) => {
    await post(type, {
      id: "org_1",
      name: "회사",
      created_by: "user_1",
      image_url: "https://img.clerk.com/org.png",
    });
    const sent = JSON.stringify(h.groupIdentify.mock.calls);
    expect(h.groupIdentify).toHaveBeenCalledTimes(1);
    expect(sent).not.toContain("img.clerk.com");
    expect(sent).not.toContain("avatar");
  });
});

describe("① user.deleted 가 회원 정보를 지운다", () => {
  it("삭제를 부르고 성공하면 201", async () => {
    h.erase.mockResolvedValueOnce(erased);
    const res = await post("user.deleted", { id: "user_1", deleted: true });
    expect(h.erase).toHaveBeenCalledWith(expect.anything(), "user_1");
    expect(res.status).toBe(201);
  });

  it("🔴 삭제가 실패하면 500 — Clerk 가 다시 보내게 한다(삼키지 않는다)", async () => {
    h.erase.mockRejectedValueOnce(new Error("db down"));
    const res = await post("user.deleted", { id: "user_1", deleted: true });
    expect(res.status).toBe(500);
    expect(h.logError).toHaveBeenCalledWith(
      "privacy.user_erase.failed",
      expect.objectContaining({ userId: "user_1" })
    );
  });

  it("🟡 혼자 쓰던 조직은 지우지 않고 경고 로그로 조직 id 만 남긴다", async () => {
    h.erase.mockResolvedValueOnce({ ...erased, soleOwnerOrgIds: ["org_solo"] });
    const res = await post("user.deleted", { id: "user_1", deleted: true });
    expect(res.status).toBe(201);
    expect(h.logWarn).toHaveBeenCalledWith(
      "privacy.user_erase.sole_owner_orgs",
      { userId: "user_1", orgIds: ["org_solo"] }
    );
  });

  it("id 가 없는 이벤트는 아무것도 지우지 않는다", async () => {
    const res = await post("user.deleted", { deleted: true });
    expect(h.erase).not.toHaveBeenCalled();
    expect(res.status).toBe(201);
  });
});
