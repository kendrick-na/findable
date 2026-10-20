/**
 * 탈퇴 회원 정보 삭제(`eraseDeletedUser`) — 2026-10-20 대표 결정 ①.
 *
 * 메모리 DB(트랜잭션 실패 시 되돌림까지 흉내) 위에서 **결과 상태**를 본다:
 *  - 회원 정보는 지워지고, 조직 공유 데이터·결제 기록은 그대로인가
 *  - 두 번 돌려도 같은가(멱등 — Clerk 재전송)
 *  - 중간에 실패하면 아무것도 안 바뀌는가(트랜잭션)
 *  - 혼자 쓰던 조직은 지우지 않고 id 만 알려주는가
 * 운영 DB 접속 0.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  ERASED_EMAIL,
  eraseDeletedUser,
  REVOKED_MAILBOX_STATUS,
} from "@/lib/privacy/erase-deleted-user";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const USER = "user_gone";
const OTHER = "user_stays";

const seed = (): Tables => ({
  user: [
    {
      id: USER,
      email: "Gone@Example.com",
      name: "탈퇴자",
      organizationId: "org_shared",
    },
    {
      id: OTHER,
      email: "stay@example.com",
      name: "남는 사람",
      organizationId: "org_shared",
    },
  ],
  organization: [
    { id: "org_shared", ownerId: USER, name: "함께 쓰는 회사" },
    { id: "org_solo", ownerId: USER, name: "혼자 쓰던 회사" },
    { id: "org_other", ownerId: OTHER, name: "남의 회사" },
  ],
  brand: [{ id: "brand_1", organizationId: "org_shared", name: "브랜드" }],
  partnerApplication: [
    { id: "pa_1", userId: USER, reason: "개인 사정 적음" },
    { id: "pa_2", userId: OTHER, reason: "남는 사람 신청" },
  ],
  mailboxConnection: [
    {
      id: "mc_1",
      userId: USER,
      organizationId: "org_shared",
      email: "gone@gmail.com",
      encryptedRefreshToken: "enc-token",
      scopes: ["gmail.compose"],
      status: "connected",
    },
  ],
  outreachDraft: [{ id: "od_1", connectionId: "mc_1", userId: USER }],
  actionCompletion: [
    { id: "ac_1", completedBy: USER },
    { id: "ac_2", completedBy: OTHER },
  ],
  annotation: [{ id: "an_1", createdBy: USER, label: "보도자료" }],
  contentReviewEvent: [{ id: "re_1", actorId: USER }],
  contentRevision: [{ id: "rv_1", createdBy: USER }],
  auditJob: [
    { id: "job_free", email: "gone@example.com", domain: "a.com" },
    { id: "job_org", email: "org:org_shared", domain: "b.com" },
    { id: "job_other", email: "stay@example.com", domain: "c.com" },
  ],
  lead: [
    { id: "lead_1", email: "GONE@example.com", source: "free_audit" },
    { id: "lead_2", email: "stay@example.com", source: "free_audit" },
  ],
  paymentRefund: [{ id: "pr_1", userId: USER, amount: 9900 }],
  refundRequest: [{ id: "rr_1", userId: USER, message: "환불 요청" }],
  renewalNotice: [{ id: "rn_1", userId: USER }],
});

/** Prisma where 의 아주 작은 부분집합(이 기능이 쓰는 모양만). */
const matches = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === "object" && "equals" in cond) {
      const c = cond as { equals: string; mode?: string };
      return c.mode === "insensitive"
        ? String(value).toLowerCase() === c.equals.toLowerCase()
        : value === c.equals;
    }
    return value === cond;
  });

function createMemoryDb(initial: Tables, failOn?: string) {
  let state: Tables = structuredClone(initial);
  const table = (s: Tables, name: string) => {
    s[name] ??= [];
    return s[name];
  };
  const model = (s: Tables, name: string) => ({
    findUnique: ({ where }: { where: Row }) =>
      Promise.resolve(table(s, name).find((r) => matches(r, where)) ?? null),
    deleteMany: ({ where }: { where: Row }) => {
      if (failOn === `${name}.deleteMany`) {
        throw new Error(`injected failure: ${name}.deleteMany`);
      }
      const before = table(s, name).length;
      s[name] = table(s, name).filter((r) => !matches(r, where));
      return Promise.resolve({ count: before - s[name].length });
    },
    updateMany: ({ where, data }: { where: Row; data: Row }) => {
      if (failOn === `${name}.updateMany`) {
        throw new Error(`injected failure: ${name}.updateMany`);
      }
      let count = 0;
      for (const r of table(s, name)) {
        if (matches(r, where)) {
          Object.assign(r, data);
          count += 1;
        }
      }
      return Promise.resolve({ count });
    },
    findMany: ({ where }: { where: Row }) =>
      Promise.resolve(
        table(s, name)
          .filter((r) => matches(r, where))
          .map((org) => ({
            id: org.id,
            _count: {
              users: table(s, "user").filter((u) => u.organizationId === org.id)
                .length,
            },
          }))
      ),
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

describe("eraseDeletedUser — 탈퇴 회원 정보 삭제", () => {
  let db: ReturnType<typeof createMemoryDb>;
  beforeEach(() => {
    db = createMemoryDb(seed());
  });

  it("회원 행·파트너 신청을 지우고, 남는 사람 것은 그대로 둔다", async () => {
    await eraseDeletedUser(db.client, USER);
    const s = db.snapshot();
    expect(s.user.map((u) => u.id)).toEqual([OTHER]);
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
    expect(s.outreachDraft).toHaveLength(1);
  });

  it("무료 진단·리드의 같은 이메일(대소문자 무시)만 자리표시로 바꾼다", async () => {
    const r = await eraseDeletedUser(db.client, USER);
    const s = db.snapshot();
    const emailOf = (rows: Row[], id: string) =>
      rows.find((x) => x.id === id)?.email;
    expect(emailOf(s.auditJob, "job_free")).toBe(ERASED_EMAIL);
    expect(emailOf(s.auditJob, "job_org")).toBe("org:org_shared");
    expect(emailOf(s.auditJob, "job_other")).toBe("stay@example.com");
    expect(emailOf(s.lead, "lead_1")).toBe(ERASED_EMAIL);
    expect(emailOf(s.lead, "lead_2")).toBe("stay@example.com");
    // 측정 결과 행 자체는 남는다.
    expect(s.auditJob).toHaveLength(3);
    expect(r.auditJobEmailsErased).toBe(1);
    expect(r.leadEmailsErased).toBe(1);
  });

  it("조직 기록의 작성자 표시만 비우고 내용은 남긴다", async () => {
    await eraseDeletedUser(db.client, USER);
    const s = db.snapshot();
    expect(s.actionCompletion).toEqual([
      { id: "ac_1", completedBy: null },
      { id: "ac_2", completedBy: OTHER },
    ]);
    expect(s.annotation[0]).toEqual({
      id: "an_1",
      createdBy: null,
      label: "보도자료",
    });
    expect(s.contentReviewEvent[0].actorId).toBeNull();
    expect(s.contentRevision[0].createdBy).toBeNull();
  });

  it("⛔ 조직·브랜드·결제·환불 기록은 한 줄도 건드리지 않는다", async () => {
    const before = db.snapshot();
    await eraseDeletedUser(db.client, USER);
    const s = db.snapshot();
    for (const name of [
      "organization",
      "brand",
      "paymentRefund",
      "refundRequest",
      "renewalNotice",
    ]) {
      expect(s[name], name).toEqual(before[name]);
    }
  });

  it("🟡 혼자 쓰던 조직은 지우지 않고 id 만 돌려준다(남은 구성원이 있는 조직은 빼고)", async () => {
    const r = await eraseDeletedUser(db.client, USER);
    expect(r.soleOwnerOrgIds).toEqual(["org_solo"]);
    expect(db.snapshot().organization.map((o) => o.id)).toContain("org_solo");
  });

  it("멱등: 두 번 돌려도 결과 상태가 같고 두 번째는 지운 것이 0건이다", async () => {
    await eraseDeletedUser(db.client, USER);
    const afterFirst = db.snapshot();
    const second = await eraseDeletedUser(db.client, USER);
    expect(db.snapshot()).toEqual(afterFirst);
    expect(second).toMatchObject({
      userFound: false,
      usersDeleted: 0,
      partnerApplicationsDeleted: 0,
      auditJobEmailsErased: 0,
      leadEmailsErased: 0,
    });
  });

  it("🔴 중간에 실패하면 아무것도 바뀌지 않고 오류를 던진다(웹훅이 500 → Clerk 재시도)", async () => {
    const failing = createMemoryDb(seed(), "auditJob.updateMany");
    const before = failing.snapshot();
    await expect(eraseDeletedUser(failing.client, USER)).rejects.toThrow(
      "injected failure"
    );
    expect(failing.snapshot()).toEqual(before);
    // 재시도(이번엔 성공)하면 정상 처리된다.
    const retried = createMemoryDb(before);
    const r = await eraseDeletedUser(retried.client, USER);
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
