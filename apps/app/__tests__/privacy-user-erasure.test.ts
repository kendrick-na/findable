/**
 * 탈퇴 회원 정보 삭제(`eraseDeletedUser`) — 2026-10-20 대표 결정 ①, 2차(코덱스 검토 반영).
 *
 * 메모리 DB(트랜잭션 실패 시 되돌림까지 흉내) 위에서 **결과 상태**를 본다:
 *  - 회원 정보는 지워지고, 조직 공유 데이터·결제 기록은 그대로인가
 *  - 역할 주소·다른 회원과 같은 이메일이면 무료 진단·리드 이메일을 바꾸지 않고 보류하는가
 *  - 조직 소유권이 가장 먼저 가입한 남은 구성원에게 넘어가는가
 *  - 탈퇴자의 GSC·GA4 토큰, 초안 보낸사람 주소가 지워지는가
 *  - 두 번 돌려도 같은가(멱등) · 중간에 실패하면 아무것도 안 바뀌는가(트랜잭션)
 * 운영 DB 접속 0.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  ERASED_EMAIL,
  eraseDeletedUser,
  isRoleEmail,
  OWNER_DELETED_ERROR_CODE,
  REVOKED_MAILBOX_STATUS,
} from "@/lib/privacy/erase-deleted-user";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const USER = "user_gone";
const OLDEST = "user_oldest";
const NEWER = "user_newer";

const d = (iso: string) => new Date(iso);

const seed = (goneEmail = "Gone@Example.com"): Tables => ({
  user: [
    {
      id: USER,
      email: goneEmail,
      name: "탈퇴자",
      organizationId: "org_shared",
      createdAt: d("2026-01-01T00:00:00Z"),
    },
    {
      id: NEWER,
      email: "newer@example.com",
      name: "나중 가입",
      organizationId: "org_shared",
      createdAt: d("2026-05-01T00:00:00Z"),
    },
    {
      id: OLDEST,
      email: "oldest@example.com",
      name: "먼저 가입",
      organizationId: "org_shared",
      createdAt: d("2026-02-01T00:00:00Z"),
    },
  ],
  organization: [
    { id: "org_shared", ownerId: USER, name: "함께 쓰는 회사" },
    { id: "org_solo", ownerId: USER, name: "혼자 쓰던 회사" },
    { id: "org_other", ownerId: NEWER, name: "남의 회사" },
  ],
  brand: [{ id: "brand_1", organizationId: "org_shared", name: "브랜드" }],
  partnerApplication: [
    { id: "pa_1", userId: USER, reason: "개인 사정 적음" },
    { id: "pa_2", userId: NEWER, reason: "남는 사람 신청" },
  ],
  mailboxConnection: [
    {
      id: "mc_1",
      userId: USER,
      organizationId: "org_shared",
      email: "gone.personal@gmail.com",
      encryptedRefreshToken: "enc-token",
      scopes: ["gmail.compose"],
      status: "connected",
    },
  ],
  outreachDraft: [
    {
      id: "od_own",
      connectionId: "mc_1",
      userId: USER,
      sender: "Gone.Personal@gmail.com",
      recipient: "ceo@target.co.kr",
    },
    {
      id: "od_alias",
      connectionId: "mc_1",
      userId: USER,
      sender: "contact@findable.co.kr",
      recipient: "pr@target2.co.kr",
    },
  ],
  searchPerformanceConnection: [
    {
      id: "sp_gsc",
      createdBy: USER,
      provider: "google_search_console",
      encryptedRefreshToken: "enc-g",
      status: "connected",
      lastErrorCode: null,
    },
    {
      id: "sp_csv",
      createdBy: USER,
      provider: "naver_search_advisor_csv",
      encryptedRefreshToken: null,
      status: "connected",
      lastErrorCode: null,
    },
    {
      id: "sp_other",
      createdBy: NEWER,
      provider: "google_analytics_4",
      encryptedRefreshToken: "enc-o",
      status: "connected",
      lastErrorCode: null,
    },
  ],
  searchPerformanceDaily: [{ id: "spd_1", connectionId: "sp_gsc", clicks: 3 }],
  actionCompletion: [
    { id: "ac_1", completedBy: USER },
    { id: "ac_2", completedBy: NEWER },
  ],
  annotation: [{ id: "an_1", createdBy: USER, label: "보도자료" }],
  contentReviewEvent: [{ id: "re_1", actorId: USER }],
  contentRevision: [{ id: "rv_1", createdBy: USER }],
  auditJob: [
    { id: "job_free", email: "gone@example.com", domain: "a.com" },
    { id: "job_org", email: "org:org_shared", domain: "b.com" },
    { id: "job_other", email: "newer@example.com", domain: "c.com" },
  ],
  lead: [
    { id: "lead_1", email: "GONE@example.com", source: "free_audit" },
    { id: "lead_2", email: "newer@example.com", source: "free_audit" },
  ],
  paymentRefund: [{ id: "pr_1", userId: USER, amount: 9900 }],
  refundRequest: [{ id: "rr_1", userId: USER, message: "환불 요청" }],
  renewalNotice: [{ id: "rn_1", userId: USER }],
});

/** Prisma where 의 아주 작은 부분집합(이 기능이 쓰는 모양만): 값 일치·equals(+insensitive)·not. */
const matchOne = (value: unknown, cond: unknown): boolean => {
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    const c = cond as { equals?: string; mode?: string; not?: unknown };
    if ("equals" in c) {
      return c.mode === "insensitive"
        ? String(value).toLowerCase() === String(c.equals).toLowerCase()
        : value === c.equals;
    }
    if ("not" in c) {
      return value !== c.not;
    }
  }
  return value === cond;
};
const matches = (row: Row, where: Row = {}): boolean =>
  Object.entries(where).every(([key, cond]) => matchOne(row[key], cond));

function createMemoryDb(initial: Tables, failOn?: string) {
  let state: Tables = structuredClone(initial);
  const table = (s: Tables, name: string) => {
    s[name] ??= [];
    return s[name];
  };
  const fail = (op: string) => {
    if (failOn === op) {
      throw new Error(`injected failure: ${op}`);
    }
  };
  const model = (s: Tables, name: string) => ({
    findUnique: ({ where }: { where: Row }) =>
      Promise.resolve(
        structuredClone(table(s, name).find((r) => matches(r, where)) ?? null)
      ),
    findFirst: ({
      where,
      orderBy,
    }: {
      where: Row;
      orderBy?: Record<string, "asc" | "desc">[];
    }) => {
      const rows = table(s, name).filter((r) => matches(r, where));
      const keys = (orderBy ?? []).map((o) => Object.keys(o)[0]);
      const sortKey = (v: unknown) =>
        v instanceof Date ? v.toISOString() : String(v);
      rows.sort((a, b) => {
        for (const k of keys) {
          const av = sortKey(a[k]);
          const bv = sortKey(b[k]);
          if (av !== bv) {
            return av < bv ? -1 : 1;
          }
        }
        return 0;
      });
      // 실제 Prisma 처럼 사본을 돌려준다(나중 쓰기가 읽은 값을 바꾸지 않게).
      return Promise.resolve(structuredClone(rows[0] ?? null));
    },
    findMany: ({ where, take }: { where: Row; take?: number }) =>
      Promise.resolve(
        table(s, name)
          .filter((r) => matches(r, where))
          .slice(0, take ?? Number.POSITIVE_INFINITY)
          .map((r) => structuredClone(r))
      ),
    count: ({ where }: { where: Row }) =>
      Promise.resolve(table(s, name).filter((r) => matches(r, where)).length),
    deleteMany: ({ where }: { where: Row }) => {
      fail(`${name}.deleteMany`);
      const before = table(s, name).length;
      s[name] = table(s, name).filter((r) => !matches(r, where));
      return Promise.resolve({ count: before - s[name].length });
    },
    update: ({ where, data }: { where: Row; data: Row }) => {
      fail(`${name}.update`);
      const row = table(s, name).find((r) => matches(r, where));
      if (!row) {
        throw new Error("not found");
      }
      Object.assign(row, data);
      return Promise.resolve(row);
    },
    updateMany: ({ where, data }: { where: Row; data: Row }) => {
      fail(`${name}.updateMany`);
      let count = 0;
      for (const r of table(s, name)) {
        if (matches(r, where)) {
          Object.assign(r, data);
          count += 1;
        }
      }
      return Promise.resolve({ count });
    },
  });
  const txFor = (s: Tables) =>
    new Proxy({}, { get: (_t, name: string) => model(s, name) });

  const client = {
    // 실패하면 작업본을 버린다 = 실제 트랜잭션 롤백과 같은 결과.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const draft = structuredClone(state);
      const out = await fn(txFor(draft));
      state = draft;
      return out;
    },
  };
  return {
    // 테스트 전용 가짜 Prisma 클라이언트(이 기능이 쓰는 메서드만 구현).
    client: client as unknown as Parameters<typeof eraseDeletedUser>[0],
    snapshot: () => structuredClone(state),
  };
}

const byId = (rows: Row[], id: string) => rows.find((r) => r.id === id);

describe("eraseDeletedUser — 탈퇴 회원 정보 삭제", () => {
  let db: ReturnType<typeof createMemoryDb>;
  beforeEach(() => {
    db = createMemoryDb(seed());
  });

  it("회원 행·파트너 신청을 지우고, 남는 사람 것은 그대로 둔다", async () => {
    await eraseDeletedUser(db.client, USER);
    const s = db.snapshot();
    expect(s.user.map((u) => u.id).sort()).toEqual([NEWER, OLDEST]);
    expect(s.partnerApplication.map((p) => p.id)).toEqual(["pa_2"]);
  });

  it("메일함 연결은 주소·토큰을 비우고 끊김 처리하되, 영업 초안 기록은 남긴다", async () => {
    await eraseDeletedUser(db.client, USER);
    const s = db.snapshot();
    expect(s.mailboxConnection[0]).toMatchObject({
      email: "",
      encryptedRefreshToken: "",
      scopes: [],
      status: REVOKED_MAILBOX_STATUS,
    });
    expect(s.outreachDraft).toHaveLength(2);
  });

  it("초안 보낸사람이 탈퇴자 본인 주소면 비우고, 회사 별칭·받는 사람은 그대로 둔다", async () => {
    const r = await eraseDeletedUser(db.client, USER);
    const s = db.snapshot();
    expect(byId(s.outreachDraft, "od_own")).toMatchObject({
      sender: "",
      recipient: "ceo@target.co.kr",
    });
    expect(byId(s.outreachDraft, "od_alias")).toMatchObject({
      sender: "contact@findable.co.kr",
      recipient: "pr@target2.co.kr",
    });
    expect(r.outreachDraftSendersCleared).toBe(1);
  });

  it("탈퇴자가 연결한 GSC·GA4 는 토큰을 지우고 끊김 처리, 일별 수치·남의 연결·CSV 연결은 유지", async () => {
    const r = await eraseDeletedUser(db.client, USER);
    const s = db.snapshot();
    expect(byId(s.searchPerformanceConnection, "sp_gsc")).toMatchObject({
      encryptedRefreshToken: null,
      status: "error",
      lastErrorCode: OWNER_DELETED_ERROR_CODE,
    });
    expect(byId(s.searchPerformanceConnection, "sp_csv")).toMatchObject({
      status: "connected",
    });
    expect(byId(s.searchPerformanceConnection, "sp_other")).toMatchObject({
      encryptedRefreshToken: "enc-o",
      status: "connected",
    });
    expect(s.searchPerformanceDaily).toHaveLength(1);
    expect(r.searchConnectionsRevoked).toBe(1);
  });

  it("무료 진단·리드의 같은 이메일(대소문자 무시)만 자리표시로 바꾼다", async () => {
    const r = await eraseDeletedUser(db.client, USER);
    const s = db.snapshot();
    expect(byId(s.auditJob, "job_free")?.email).toBe(ERASED_EMAIL);
    expect(byId(s.auditJob, "job_org")?.email).toBe("org:org_shared");
    expect(byId(s.auditJob, "job_other")?.email).toBe("newer@example.com");
    expect(byId(s.lead, "lead_1")?.email).toBe(ERASED_EMAIL);
    expect(byId(s.lead, "lead_2")?.email).toBe("newer@example.com");
    expect(s.auditJob).toHaveLength(3); // 측정 결과 행 자체는 남는다
    expect(r).toMatchObject({
      auditJobEmailsErased: 1,
      leadEmailsErased: 1,
      emailHoldReason: null,
    });
  });

  it("🟡 역할 주소(info@ 등)면 바꾸지 않고 보류 — id 만 돌려준다", async () => {
    const tables = seed("Info@Gone-Company.kr");
    tables.auditJob.push({
      id: "job_role",
      email: "info@gone-company.kr",
      domain: "d.com",
    });
    tables.lead.push({
      id: "lead_role",
      email: "INFO@gone-company.kr",
      source: "free_audit",
    });
    const roleDb = createMemoryDb(tables);
    const r = await eraseDeletedUser(roleDb.client, USER);
    const s = roleDb.snapshot();
    expect(byId(s.auditJob, "job_role")?.email).toBe("info@gone-company.kr");
    expect(byId(s.lead, "lead_role")?.email).toBe("INFO@gone-company.kr");
    expect(r).toMatchObject({
      emailHoldReason: "role_address",
      heldAuditJobIds: ["job_role"],
      heldLeadIds: ["lead_role"],
      auditJobEmailsErased: 0,
      leadEmailsErased: 0,
    });
    // 보류 결과에 이메일 원문이 들어가지 않는다.
    expect(JSON.stringify(r)).not.toMatch(/gone-company/i);
    // 회원 행 자체는 그래도 지운다.
    expect(s.user.find((u) => u.id === USER)).toBeUndefined();
  });

  it("🟡 다른 회원이 같은 이메일(대소문자만 다름)을 쓰면 보류한다", async () => {
    const tables = seed();
    tables.user.push({
      id: "user_twin",
      email: "gone@example.com",
      organizationId: null,
      createdAt: d("2026-06-01T00:00:00Z"),
    });
    const twinDb = createMemoryDb(tables);
    const r = await eraseDeletedUser(twinDb.client, USER);
    const s = twinDb.snapshot();
    expect(byId(s.auditJob, "job_free")?.email).toBe("gone@example.com");
    expect(byId(s.lead, "lead_1")?.email).toBe("GONE@example.com");
    expect(r).toMatchObject({
      emailHoldReason: "shared_with_other_user",
      heldAuditJobIds: ["job_free"],
      heldLeadIds: ["lead_1"],
    });
  });

  it("isRoleEmail: 역할 주소와 개인 주소를 가른다", () => {
    expect(isRoleEmail("info@a.com")).toBe(true);
    expect(isRoleEmail("Sales+kr@a.com")).toBe(true);
    expect(isRoleEmail("cs@a.co.kr")).toBe(true);
    expect(isRoleEmail("kim.cs@a.com")).toBe(false);
    expect(isRoleEmail("gildong@a.com")).toBe(false);
  });

  it("조직 기록의 작성자 표시만 비우고 내용은 남긴다", async () => {
    await eraseDeletedUser(db.client, USER);
    const s = db.snapshot();
    expect(s.actionCompletion).toEqual([
      { id: "ac_1", completedBy: null },
      { id: "ac_2", completedBy: NEWER },
    ]);
    expect(s.annotation[0]).toEqual({
      id: "an_1",
      createdBy: null,
      label: "보도자료",
    });
    expect(s.contentReviewEvent[0].actorId).toBeNull();
    expect(s.contentRevision[0].createdBy).toBeNull();
  });

  it("조직 소유권은 가장 먼저 가입한 남은 구성원에게 넘어간다", async () => {
    const r = await eraseDeletedUser(db.client, USER);
    const s = db.snapshot();
    expect(byId(s.organization, "org_shared")?.ownerId).toBe(OLDEST);
    expect(byId(s.organization, "org_other")?.ownerId).toBe(NEWER);
    expect(r.ownershipTransfers).toEqual([
      { orgId: "org_shared", newOwnerId: OLDEST },
    ]);
  });

  it("🟡 혼자 쓰던 조직은 지우지 않고 id 만 돌려준다", async () => {
    const r = await eraseDeletedUser(db.client, USER);
    const s = db.snapshot();
    expect(r.soleOwnerOrgIds).toEqual(["org_solo"]);
    expect(byId(s.organization, "org_solo")).toMatchObject({ ownerId: USER });
  });

  it("⛔ 브랜드·결제·환불 기록은 한 줄도 건드리지 않는다", async () => {
    const before = db.snapshot();
    await eraseDeletedUser(db.client, USER);
    const s = db.snapshot();
    for (const name of [
      "brand",
      "paymentRefund",
      "refundRequest",
      "renewalNotice",
    ]) {
      expect(s[name], name).toEqual(before[name]);
    }
  });

  it("멱등: 두 번 돌려도 결과 상태가 같고 두 번째는 바뀐 것이 0건이다", async () => {
    await eraseDeletedUser(db.client, USER);
    const afterFirst = db.snapshot();
    const second = await eraseDeletedUser(db.client, USER);
    expect(db.snapshot()).toEqual(afterFirst);
    expect(second).toMatchObject({
      userFound: false,
      usersDeleted: 0,
      partnerApplicationsDeleted: 0,
      searchConnectionsRevoked: 0,
      outreachDraftSendersCleared: 0,
      auditJobEmailsErased: 0,
      leadEmailsErased: 0,
      ownershipTransfers: [],
    });
  });

  it("🔴 중간에 실패하면 아무것도 바뀌지 않고 오류를 던진다(웹훅이 500 → Clerk 재시도)", async () => {
    for (const op of ["auditJob.updateMany", "organization.update"]) {
      const failing = createMemoryDb(seed(), op);
      const before = failing.snapshot();
      await expect(eraseDeletedUser(failing.client, USER)).rejects.toThrow(
        "injected failure"
      );
      expect(failing.snapshot(), op).toEqual(before);
    }
    const r = await eraseDeletedUser(createMemoryDb(seed()).client, USER);
    expect(r.usersDeleted).toBe(1);
  });

  it("DB 에 회원 행이 없던 사람이면 이메일 기반 정리를 건너뛴다", async () => {
    const r = await eraseDeletedUser(db.client, "user_never_loaded");
    expect(r.userFound).toBe(false);
    expect(r.auditJobEmailsErased).toBe(0);
    expect(db.snapshot().auditJob.map((j) => j.email)).toContain(
      "gone@example.com"
    );
  });

  it("빈 id 는 거절한다(전체 삭제 사고 방지)", async () => {
    await expect(eraseDeletedUser(db.client, "")).rejects.toThrow();
  });
});
