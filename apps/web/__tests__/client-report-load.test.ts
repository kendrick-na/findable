// 고객 웹 리포트 `/r/<토큰>` 로더 — 토큰 권한·승인본만 공개·만료 검증.
// DB 는 가짜. 형식이 틀린 토큰은 DB 조회 없이 거부되어야 한다.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildReportFromReview,
  REPORT_REVIEW_CONTRACT,
} from "@repo/audit/client-report/publish";
import { buildReportSource } from "@repo/audit/client-report/source";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  report: { findUnique: vi.fn() },
  reportView: { create: vi.fn() },
}));
vi.mock("server-only", () => ({}));
vi.mock("@repo/database", () => ({ database: db }));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { loadClientReport } = await import("../lib/client-report/load");

const FIX = join(import.meta.dirname, "fixtures/client-report");
const read = <T>(n: string): T =>
  JSON.parse(readFileSync(join(FIX, n), "utf8")) as T;
const TOKEN = "A".repeat(43);
const ENGINES = new Set([
  "chatgpt",
  "claude",
  "perplexity",
  "gemini",
  "hyperclova",
  "naver",
  "daum",
]);

function approvedV2(expiresAt: Date | null) {
  const audit = read<{
    result: { engineResponses: Record<string, unknown>[] };
  }>("knowverse.audit.min.json");
  const completedAt = new Date(Date.now() - 86_400_000);
  const built = buildReportSource({
    id: "b7f319e1-1d96-4875-a1e1-e7f5e0e814c9",
    status: "completed",
    domain: "knowverse.net",
    createdAt: completedAt,
    completedAt,
    result: {
      mentionVerdictVersion: 2,
      engineResponses: audit.result.engineResponses.map((r, i) => ({
        ...r,
        rawResponse: `합성 ${i}`,
      })),
    },
  });
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
  const labels: Record<string, unknown> = {};
  built.source.answers
    .filter((a) => ENGINES.has(a.engineId))
    .forEach((a, i) => {
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
  const r = buildReportFromReview({
    source: built.source,
    mode: "issue",
    slug: "knowverse",
    version: 1,
    issuedAt: new Date(),
    expiresAt,
    review: {
      contract: REPORT_REVIEW_CONTRACT,
      auditJobId: built.source.run.auditJobId,
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
      reviewer: "나현덕",
      reviewedAt: new Date().toISOString(),
      status: "approved",
    },
  });
  if (!r.ok) {
    throw new Error(JSON.stringify(r.errors));
  }
  return JSON.parse(JSON.stringify(r.data));
}

beforeEach(() => vi.clearAllMocks());

describe("/r/<토큰> 권한", () => {
  it("🔴 형식이 틀린 토큰(짧음·특수문자·경로)은 DB 조회 없이 null", async () => {
    for (const t of [
      "short",
      "a".repeat(31),
      `${"a".repeat(40)}/..`,
      "a".repeat(65),
    ]) {
      expect(await loadClientReport(t, undefined)).toBeNull();
    }
    expect(db.report.findUnique).not.toHaveBeenCalled();
  });

  it("🔴 측정 ID(UUID)로는 리포트를 열 수 없다 — accessToken 만 조회 키", async () => {
    db.report.findUnique.mockResolvedValue(null);
    expect(
      await loadClientReport("b7f319e1-1d96-4875-a1e1-e7f5e0e814c9", undefined)
    ).toBeNull();
    expect(db.report.findUnique.mock.calls[0][0].where).toEqual({
      accessToken: "b7f319e1-1d96-4875-a1e1-e7f5e0e814c9",
    });
  });

  it("없는(폐기된) 토큰은 null", async () => {
    db.report.findUnique.mockResolvedValue(null);
    expect(await loadClientReport(TOKEN, undefined)).toBeNull();
  });

  it("🔴 승인되지 않은 v2 데이터가 저장돼 있어도 열지 않는다", async () => {
    const data = approvedV2(null);
    data.review.status = "draft";
    db.report.findUnique.mockResolvedValue({ id: "r1", data, pdfUrl: null });
    expect(await loadClientReport(TOKEN, undefined)).toBeNull();
  });

  it("🔴 만료된 승인본은 null, 유효한 승인본은 연다(분모 16)", async () => {
    db.report.findUnique.mockResolvedValue({
      id: "r1",
      data: approvedV2(new Date("2020-01-01")),
      pdfUrl: null,
    });
    expect(await loadClientReport(TOKEN, undefined)).toBeNull();
    db.report.findUnique.mockResolvedValue({
      id: "r2",
      data: approvedV2(new Date(Date.now() + 86_400_000)),
      pdfUrl: null,
    });
    const ok = await loadClientReport(TOKEN, undefined);
    expect(ok?.data.schemaVersion).toBe(2);
    expect(ok?.data.computed.s.n).toBe(16);
  });

  it("기존 v1 리포트는 그대로 열린다(회귀 없음)", async () => {
    db.report.findUnique.mockResolvedValue({
      id: "r3",
      data: read("knowverse.report.json"),
      pdfUrl: null,
    });
    const v1 = await loadClientReport(TOKEN, undefined);
    expect(v1?.data.schemaVersion).toBe(1);
  });
});
