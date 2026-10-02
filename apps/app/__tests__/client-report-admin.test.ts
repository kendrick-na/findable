/** @vitest-environment node */
// 영업 리포트 발행 — 관리자 라우트(T2·T6)·영업 링크(T8) 동작 검증.
// DB·Clerk 는 가짜로 바꾼다. 운영 DB·네트워크를 부르지 않는다.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  auditJob: { findUnique: vi.fn() },
  report: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));
const admin = vi.hoisted(() => ({ requireAdmin: vi.fn(), isAdmin: vi.fn() }));

vi.mock("@repo/database", () => ({ database: db }));
vi.mock("@repo/auth/admin", () => admin);
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_WEB_URL: "https://www.example.test" },
}));

const { REPORT_REVIEW_CONTRACT } = await import(
  "@repo/audit/client-report/publish"
);
const { buildReportSource } = await import("@repo/audit/client-report/source");
const exportRoute = await import("@/app/api/admin/report-source/[jobId]/route");
const issueRoute = await import("@/app/api/admin/client-reports/route");
const revokeRoute = await import(
  "@/app/api/admin/client-reports/[reportId]/route"
);
const adminLib = await import("@/lib/client-report/admin");

const FIX = join(process.cwd(), "../web/__tests__/fixtures/client-report");
const read = <T>(n: string): T =>
  JSON.parse(readFileSync(join(FIX, n), "utf8")) as T;
const JOB_ID = "b7f319e1-1d96-4875-a1e1-e7f5e0e814c9";
const REPORT_ENGINES = new Set([
  "chatgpt",
  "claude",
  "perplexity",
  "gemini",
  "hyperclova",
  "naver",
  "daum",
]);

function knowverseJob() {
  const audit = read<{
    result: { engineResponses: Record<string, unknown>[] };
  }>("knowverse.audit.min.json");
  return {
    id: JOB_ID,
    status: "completed",
    domain: "knowverse.net",
    createdAt: new Date("2026-09-28T09:14:03.645Z"),
    completedAt: new Date("2026-09-28T09:15:45.936Z"),
    organizationId: "org_1",
    brandId: "brand_1",
    result: {
      mentionVerdictVersion: 2,
      engineResponses: audit.result.engineResponses.map((r, i) => ({
        ...r,
        rawResponse: `합성 답변 ${i}`,
      })),
    },
  };
}

function review(status: "approved" | "draft") {
  const built = buildReportSource(knowverseJob());
  if (!built.ok) {
    throw new Error("fixture");
  }
  const cfg = read<
    Record<string, unknown> & {
      labels: { l: string; q: string; who: string }[];
      official_domains: string[];
      question_short: string[];
      questions: string[];
    }
  >("knowverse.config.json");
  const rows = built.source.answers.filter((a) =>
    REPORT_ENGINES.has(a.engineId)
  );
  const labels: Record<string, unknown> = {};
  rows.forEach((a, i) => {
    labels[a.answerKey] = {
      l: cfg.labels[i].l,
      who: cfg.labels[i].who,
      summary: cfg.labels[i].q,
    };
  });
  const {
    labels: _l,
    questions,
    question_short,
    official_domains,
    ...copy
  } = cfg;
  return {
    contract: REPORT_REVIEW_CONTRACT,
    auditJobId: JOB_ID,
    resultSha256: built.source.run.resultSha256,
    rubric: "brand-identity-v1",
    denominator: {
      engines: ["chatgpt", "claude", "perplexity", "gemini"],
      promptKinds: ["brand"],
    },
    questions: questions.map((q, i) => ({
      promptText: q,
      short: question_short[i],
    })),
    labels,
    officialDomains: official_domains,
    copy,
    reviewer: status === "approved" ? "나현덕" : null,
    reviewedAt: status === "approved" ? new Date().toISOString() : null,
    status,
  };
}

const post = (body: unknown) =>
  issueRoute.POST(
    new Request("http://app.test/api/admin/client-reports", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  admin.requireAdmin.mockResolvedValue("user_admin");
  // 테스트용 측정은 2026-09-28 — 오늘 기준 14일 초과 거부를 피하려고 완료 시각을 최근으로 맞춘다.
  const job = knowverseJob();
  job.completedAt = new Date(Date.now() - 86_400_000);
  db.auditJob.findUnique.mockResolvedValue(job);
  db.report.findFirst.mockResolvedValue(null);
  db.report.create.mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
  });
});

const params = <T>(v: T) => ({ params: Promise.resolve(v) });

describe("권한 — 관리자만", () => {
  it("🔴 비관리자는 원본 내보내기·발행·목록·폐기 모두 403, DB 를 부르지 않는다", async () => {
    admin.requireAdmin.mockRejectedValue(new Error("forbidden"));
    const a = await exportRoute.GET(
      new Request("http://x"),
      params({ jobId: JOB_ID })
    );
    const b = await post({
      auditJobId: JOB_ID,
      review: {},
      version: 1,
      slug: "kv",
    });
    const c = await issueRoute.GET();
    const d = await revokeRoute.DELETE(
      new Request("http://x"),
      params({ reportId: "11111111-1111-4111-8111-111111111111" })
    );
    expect([a.status, b.status, c.status, d.status]).toEqual([
      403, 403, 403, 403,
    ]);
    expect(db.auditJob.findUnique).not.toHaveBeenCalled();
    expect(db.report.create).not.toHaveBeenCalled();
    expect(db.report.updateMany).not.toHaveBeenCalled();
  });
});

describe("T2 원본 내보내기", () => {
  it("완료 회차는 해시·answerKey 가 든 JSON 을 no-store 첨부로 준다", async () => {
    const res = await exportRoute.GET(
      new Request("http://x"),
      params({ jobId: JOB_ID })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.contract).toBe("findable.report-source@1");
    expect(body.run.resultSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.answers).toHaveLength(22);
  });

  it("🔴 원문 없는 옛 측정은 422 + 사유", async () => {
    const job = knowverseJob();
    const legacy = {
      ...job,
      result: {
        ...job.result,
        engineResponses: job.result.engineResponses.map(
          (row: Record<string, unknown>) => {
            const { rawResponse: _r, promptText: _p, ...rest } = row;
            return rest;
          }
        ),
      },
    };
    db.auditJob.findUnique.mockResolvedValue(legacy);
    const res = await exportRoute.GET(
      new Request("http://x"),
      params({ jobId: JOB_ID })
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.reasons).toEqual(
      expect.arrayContaining(["legacy_missing_raw", "legacy_missing_prompt"])
    );
  });

  it("잘못된 ID 형식은 400, 없는 회차는 404", async () => {
    const bad = await exportRoute.GET(
      new Request("http://x"),
      params({ jobId: "x" })
    );
    expect(bad.status).toBe(400);
    db.auditJob.findUnique.mockResolvedValue(null);
    const none = await exportRoute.GET(
      new Request("http://x"),
      params({ jobId: JOB_ID })
    );
    expect(none.status).toBe(404);
  });
});

describe("T5·T6 발행", () => {
  it("🔴 초안은 발행 거부(422), Report 를 만들지 않는다", async () => {
    const res = await post({
      auditJobId: JOB_ID,
      review: review("draft"),
      version: 1,
      slug: "knowverse",
      mode: "issue",
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.reasons.map((r: { code: string }) => r.code)).toContain(
      "not_approved"
    );
    expect(db.report.create).not.toHaveBeenCalled();
  });

  it("점검(preview)은 초안도 계산해 보여주되 저장하지 않는다 — 분모 16", async () => {
    const res = await post({
      auditJobId: JOB_ID,
      review: review("draft"),
      version: 1,
      slug: "knowverse",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.denominator.n).toBe(16);
    expect(body.summary.ok_n).toBe(5);
    expect(db.report.create).not.toHaveBeenCalled();
  });

  it("승인본은 256비트 토큰 Report 1행 + /r 링크, 데이터는 v2 승인본", async () => {
    const res = await post({
      auditJobId: JOB_ID,
      review: review("approved"),
      version: 1,
      slug: "knowverse",
      mode: "issue",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.url).toMatch(
      /^https:\/\/www\.example\.test\/r\/[A-Za-z0-9_-]{43}$/
    );
    expect(db.report.create).toHaveBeenCalledTimes(1);
    const arg = db.report.create.mock.calls[0][0].data;
    expect(arg).toMatchObject({
      type: "custom",
      organizationId: "org_1",
      brandId: "brand_1",
    });
    expect(arg.accessToken).toHaveLength(43);
    expect(body.url.endsWith(arg.accessToken)).toBe(true);
    expect(arg.data.schemaVersion).toBe(2);
    expect(arg.data.review.status).toBe("approved");
    expect(arg.data.denominator.n).toBe(16);
  });

  it("같은 회차·같은 판은 중복 발행 409", async () => {
    db.report.findFirst.mockResolvedValue({ id: "dup" });
    const res = await post({
      auditJobId: JOB_ID,
      review: review("approved"),
      version: 1,
      slug: "knowverse",
      mode: "issue",
    });
    expect(res.status).toBe(409);
    expect(db.report.create).not.toHaveBeenCalled();
  });

  it("폐기는 토큰만 지운다", async () => {
    db.report.updateMany.mockResolvedValue({ count: 1 });
    const res = await revokeRoute.DELETE(
      new Request("http://x"),
      params({ reportId: "11111111-1111-4111-8111-111111111111" })
    );
    expect(res.status).toBe(200);
    expect(db.report.updateMany.mock.calls[0][0].data).toEqual({
      accessToken: null,
    });
  });
});

const approval = {
  approvedAt: "2026-09-30T12:00:00.000Z",
  approvedBy: "user_admin",
  approverName: "나현덕",
};

async function issuedData() {
  const res = await post({
    auditJobId: JOB_ID,
    review: review("approved"),
    version: 1,
    slug: "knowverse",
    mode: "issue",
  });
  if (res.status !== 201) {
    throw new Error(`발행 실패 ${res.status}`);
  }
  return db.report.create.mock.calls[0][0].data.data;
}

describe("② 대표 고객 발송 최종 승인 — ① 판별 검토와 다른 단계", () => {
  it("발행 직후에는 발송 승인이 비어 있다(판별 검토 승인만 있음)", async () => {
    const data = await issuedData();
    expect(data.review.status).toBe("approved");
    expect(data.release.sendApproval).toBeNull();
  });

  it("🔴 링크를 직접 열어 봤다는 체크 없이는 승인 요청 자체가 400", async () => {
    const res = await revokeRoute.PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({
          action: "approve-send",
          approverName: "나현덕",
        }),
      }),
      params({ reportId: "11111111-1111-4111-8111-111111111111" })
    );
    expect(res.status).toBe(400);
    expect(db.report.update).not.toHaveBeenCalled();
  });

  it("살아 있는 v2 발행본만 승인 — 폐기·만료·이미 승인은 409, 없으면 404", async () => {
    const data = await issuedData();
    const patch = (rid = "11111111-1111-4111-8111-111111111111") =>
      revokeRoute.PATCH(
        new Request("http://x", {
          method: "PATCH",
          body: JSON.stringify({
            action: "approve-send",
            approverName: "나현덕",
            viewedLink: true,
          }),
        }),
        params({ reportId: rid })
      );
    db.report.findFirst.mockResolvedValueOnce(null);
    expect((await patch()).status).toBe(404);
    db.report.findFirst.mockResolvedValueOnce({
      id: "r",
      accessToken: null,
      data,
    });
    expect((await patch()).status).toBe(409);
    db.report.findFirst.mockResolvedValueOnce({
      id: "r",
      accessToken: "t".repeat(43),
      data: {
        ...data,
        release: { ...data.release, expiresAt: "2020-01-01T00:00:00.000Z" },
      },
    });
    expect((await patch()).status).toBe(409);
    db.report.findFirst.mockResolvedValueOnce({
      id: "r",
      accessToken: "t".repeat(43),
      data: { ...data, release: { ...data.release, sendApproval: approval } },
    });
    expect((await patch()).status).toBe(409);
    expect(db.report.update).not.toHaveBeenCalled();
    db.report.findFirst.mockResolvedValueOnce({
      id: "r",
      accessToken: "t".repeat(43),
      data,
    });
    db.report.update.mockResolvedValueOnce({});
    const ok = await patch();
    expect(ok.status).toBe(200);
    const saved = db.report.update.mock.calls[0][0].data.data;
    expect(saved.release.sendApproval).toMatchObject({
      approvedBy: "user_admin",
      approverName: "나현덕",
    });
    // 판별·계산 스냅숏은 그대로
    expect(saved.computed).toEqual(data.computed);
    expect(saved.review).toEqual(data.review);
  });

  it("비관리자는 발송 승인 403", async () => {
    admin.requireAdmin.mockRejectedValue(new Error("forbidden"));
    const res = await revokeRoute.PATCH(
      new Request("http://x", { method: "PATCH", body: "{}" }),
      params({ reportId: "11111111-1111-4111-8111-111111111111" })
    );
    expect(res.status).toBe(403);
  });
});

describe("T8 영업 reportUrl — 발송 승인까지 끝난 판만", () => {
  it("🔴 발송 승인 전·폐기·만료·v1·초안은 빠지고, 같은 도메인은 최신 판 링크만", async () => {
    const base = await issuedData();
    const approved = (v: number) => ({
      ...base,
      version: v,
      release: { ...base.release, sendApproval: approval },
    });
    const expired = {
      ...approved(3),
      release: {
        ...approved(3).release,
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
    };
    const draft = {
      ...approved(4),
      review: { ...base.review, status: "draft" },
    };
    const legacy = read<unknown>("knowverse.report.json");
    const tok = (c: string) => `tok_${c.repeat(39)}`;
    const views = adminLib.issuedReportViews(
      [
        {
          id: "a",
          accessToken: tok("a"),
          data: approved(1),
          generatedAt: new Date(),
        },
        {
          id: "b",
          accessToken: tok("b"),
          data: approved(2),
          generatedAt: new Date(),
        },
        {
          id: "c",
          accessToken: tok("c"),
          data: expired,
          generatedAt: new Date(),
        },
        {
          id: "d",
          accessToken: tok("d"),
          data: draft,
          generatedAt: new Date(),
        },
        {
          id: "e",
          accessToken: null,
          data: approved(9),
          generatedAt: new Date(),
        },
        {
          id: "f",
          accessToken: tok("f"),
          data: legacy,
          generatedAt: new Date(),
        },
        {
          id: "g",
          accessToken: tok("g"),
          data: { ...base, version: 7 },
          generatedAt: new Date(),
        },
      ],
      "https://www.example.test"
    );
    expect(views.map((v) => [v.id, v.state, Boolean(v.sendApproval)])).toEqual([
      ["a", "live", true],
      ["b", "live", true],
      ["c", "expired", true],
      ["e", "revoked", true],
      ["g", "live", false],
    ]);
    const urls = adminLib.approvedReportUrlByDomain(views);
    // v7(g) 이 가장 높은 판이지만 발송 승인 전이라 빠지고, 승인된 최신 판 v2(b)만 남는다
    expect([...urls]).toEqual([
      ["knowverse.net", `https://www.example.test/r/${tok("b")}`],
    ]);
  });
});
