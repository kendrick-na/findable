// 영업 리포트 발행 파이프라인 — 원본 고정(T2) · answerKey(T3) · 분모(T4) · 승인 게이트(T5).
//
// 입력: 기존 교차검증 fixture(노우버스 2026-09-28 측정, build.py 와 대조 완료)에
//   **합성 원문**을 붙여 쓴다(고객 AI 답변 원문을 저장소에 넣지 않는다).
// 기대값: v12 `tools/verify.py` EXPECT.knowverse (AI 4곳 × 질문 4개 = 16건).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ClientReportAudit, ClientReportConfig } from "./compute";
import {
  buildReportFromReview,
  comparableAnswers,
  REPORT_REVIEW_CONTRACT,
  type ReportReview,
  validateReview,
} from "./publish";
import {
  buildClientReportData,
  isClientReportExpired,
  parseClientReportData,
} from "./report-data";
import {
  type AuditJobRow,
  answerKeyOf,
  buildReportSource,
  canonicalJson,
  type ReportSource,
  resultSha256,
} from "./source";

const FIXTURES = join(
  import.meta.dirname,
  "../../../apps/web/__tests__/fixtures/client-report"
);
const read = <T>(name: string): T =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;

const JOB_ID = "b7f319e1-1d96-4875-a1e1-e7f5e0e814c9";
const COMPLETED = "2026-09-28T09:15:45.936Z";
const ISSUED = new Date("2026-09-30T12:00:00.000Z");
const REPORT_ENGINES = new Set([
  "chatgpt",
  "claude",
  "perplexity",
  "gemini",
  "hyperclova",
  "naver",
  "daum",
]);

interface MinAudit {
  result: {
    engineResponses: {
      citedSources?: unknown[];
      engineId: string;
      promptText?: string;
    }[];
  };
}

/** fixture 축약본 → 운영 AuditJob 행 모양(원문은 합성). */
function knowverseJob(
  mutate?: (rows: Record<string, unknown>[]) => void
): AuditJobRow {
  const audit = read<MinAudit>("knowverse.audit.min.json");
  const rows = audit.result.engineResponses.map((r, i) => ({
    ...r,
    rawResponse: `합성 답변 ${i}: ${r.engineId} 가 설명한 노우버스`,
  }));
  mutate?.(rows);
  return {
    id: JOB_ID,
    status: "completed",
    domain: "knowverse.net",
    createdAt: "2026-09-28T09:14:03.645Z",
    completedAt: COMPLETED,
    result: {
      mentionVerdictVersion: 2,
      brandName: "노우버스",
      measurementContext: { identityGrounded: true },
      engineResponses: rows,
    },
  };
}

function sourceOf(job: AuditJobRow): ReportSource {
  const built = buildReportSource(job);
  if (!built.ok) {
    throw new Error(`source: ${built.errors.join(",")}`);
  }
  return built.source;
}

/** v4 config 의 판별(배열 순서) → answerKey 로 옮긴 사람 판별. 이 변환이 곧 T3 이관 절차다. */
function knowverseReview(
  source: ReportSource,
  overrides: Partial<ReportReview> = {}
): ReportReview {
  const cfg = read<ClientReportConfig>("knowverse.config.json");
  const reportRows = source.answers.filter((a) =>
    REPORT_ENGINES.has(a.engineId)
  );
  if (reportRows.length !== cfg.labels.length) {
    throw new Error(
      `fixture: 답변 ${reportRows.length} ≠ 판별 ${cfg.labels.length}`
    );
  }
  const labels: ReportReview["labels"] = {};
  reportRows.forEach((a, i) => {
    const l = cfg.labels[i];
    labels[a.answerKey] = { l: l.l, who: l.who, summary: l.q };
  });
  const {
    labels: _l,
    questions: _q,
    question_short: _s,
    official_domains: _o,
    lookalike_domains: _k,
    audit_id: _a,
    ...copy
  } = cfg;
  return {
    contract: REPORT_REVIEW_CONTRACT,
    auditJobId: source.run.auditJobId,
    resultSha256: source.run.resultSha256,
    rubric: "brand-identity-v1",
    denominator: {
      engines: ["chatgpt", "claude", "perplexity", "gemini"],
      promptKinds: ["brand"],
    },
    questions: cfg.questions.map((q, i) => ({
      promptText: q,
      short: cfg.question_short[i],
    })),
    labels,
    officialDomains: cfg.official_domains,
    lookalikeDomains: cfg.lookalike_domains,
    copy,
    reviewer: "나현덕",
    reviewedAt: "2026-09-30T10:00:00.000Z",
    status: "approved",
    ...overrides,
  };
}

const issue = (
  source: ReportSource,
  review: unknown,
  mode: "issue" | "preview" = "issue"
) =>
  buildReportFromReview({
    source,
    review,
    mode,
    slug: "knowverse",
    version: 1,
    issuedAt: ISSUED,
    expiresAt: new Date("2026-10-30T00:00:00.000Z"),
  });

describe("T2 원본 고정 — ReportSource", () => {
  it("해시는 키 순서와 무관하고, 원문 한 글자만 바뀌어도 달라진다", () => {
    const a = { b: 1, a: [1, { y: 2, x: 1 }] };
    const b = { a: [1, { x: 1, y: 2 }], b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    const job = knowverseJob();
    const changed = knowverseJob((rows) => {
      rows[0].rawResponse = `${rows[0].rawResponse}!`;
    });
    expect(resultSha256(job.result)).not.toBe(resultSha256(changed.result));
  });

  it("naver-briefing 같은 비교 외 행은 빼고, 같은 엔진·질문의 반복은 repeat 로 가른다", () => {
    const source = sourceOf(knowverseJob());
    expect(source.answers).toHaveLength(22);
    expect(new Set(source.answers.map((a) => a.answerKey)).size).toBe(22);
    const dup = sourceOf(
      knowverseJob((rows) => {
        rows.push({ ...rows[0], rawResponse: "같은 질문 두 번째 답" });
      })
    );
    const firstKey = answerKeyOf(
      dup.answers[0].engineId,
      dup.answers[0].promptText,
      1
    );
    const second = dup.answers.find((a) => a.repeat === 2);
    expect(dup.answers[0].answerKey).toBe(firstKey);
    expect(second?.answerKey).not.toBe(firstKey);
  });

  it("🔴 원문·질문 원문이 없는 옛 측정(TechDD 2026-09-14 형식)은 거부한다", () => {
    const audit = read<MinAudit>("techdd.audit.min.json");
    const built = buildReportSource({
      id: "e395f16c-c4cc-4bab-a0b0-b16bc2f1a3f9",
      status: "completed",
      domain: "dd.knowverse.net",
      createdAt: "2026-09-14T17:00:54.683Z",
      completedAt: "2026-09-14T17:03:02.944Z",
      result: { engineResponses: audit.result.engineResponses },
    });
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.errors).toEqual(
        expect.arrayContaining([
          "no_verdict_version",
          "legacy_missing_prompt",
          "legacy_missing_raw",
        ])
      );
    }
  });

  it("원문만 빠진 경우도 거부, 실패 행(errorMessage)은 원문이 없어도 허용", () => {
    const noRaw = buildReportSource(
      knowverseJob((rows) => {
        rows[3].rawResponse = "";
      })
    );
    expect(noRaw.ok).toBe(false);
    const failed = buildReportSource(
      knowverseJob((rows) => {
        rows[3].rawResponse = "";
        rows[3].errorMessage = "429";
      })
    );
    expect(failed.ok).toBe(true);
  });

  it("완료되지 않은 회차는 거부", () => {
    const job = { ...knowverseJob(), status: "processing" };
    const built = buildReportSource(job);
    expect(built.ok).toBe(false);
  });
});

describe("T4 분모 — 16건(AI 4곳×질문 4개) vs 22건(7개 엔진)", () => {
  it("🔴 16건(v12) vs 22건(기존 v1 웹 경로) — 같은 판별이라도 숫자가 다르고, 22건 분모는 발행이 막힌다", () => {
    const source = sourceOf(knowverseJob());
    // 기존 v1 경로(/r 의 9/28 import 방식) = 7개 엔진 22건 그대로 계산
    const v1 = buildClientReportData({
      config: read<ClientReportConfig>("knowverse.config.json"),
      audit: read<ClientReportAudit>("knowverse.audit.min.json"),
      slug: "knowverse",
      version: 1,
      importedAt: ISSUED,
    });
    const ai4 = issue(source, knowverseReview(source));
    if (!ai4.ok) {
      throw new Error("발행 실패");
    }
    expect(v1.computed.s.n).toBe(22);
    expect(ai4.data.computed.s.n).toBe(16);
    expect(v1.computed.s.ok_n).toBe(ai4.data.computed.s.ok_n);
    expect(v1.computed.s.ok_rate).not.toBe(ai4.data.computed.s.ok_rate);
    // 7개 엔진을 분모로 두면 HyperCLOVA·네이버·다음이 비운 칸 때문에 새 경로에서는 거부된다
    const all7 = issue(
      source,
      knowverseReview(source, {
        denominator: {
          engines: [
            "chatgpt",
            "claude",
            "perplexity",
            "gemini",
            "hyperclova",
            "naver",
            "daum",
          ],
          promptKinds: ["brand"],
        },
      })
    );
    expect(all7.ok).toBe(false);
    if (!all7.ok) {
      expect(all7.errors.map((e) => e.code)).toContain(
        "denominator_cell_missing"
      );
    }
    expect(ai4.data.denominator).toEqual({
      engines: ["chatgpt", "claude", "perplexity", "gemini"],
      promptKinds: ["brand"],
      n: 16,
    });
  });

  it("16건 분모가 v12 verify.py 기대값과 전부 같다", () => {
    const source = sourceOf(knowverseJob());
    const r = issue(source, knowverseReview(source));
    if (!r.ok) {
      throw new Error(JSON.stringify(r.errors));
    }
    const s = r.data.computed.s;
    expect({
      n: s.n,
      ok_n: s.ok_n,
      bad_n: s.bad_n,
      other_n: s.other_n,
      made_n: s.made_n,
      generic_n: s.generic_n,
      unknown_n: s.unknown_n,
      engines_correct: s.engines_correct,
      off_ans: s.ok_with_official + s.bad_with_official,
      ok_with_official: s.ok_with_official,
      bad_with_official: s.bad_with_official,
    }).toEqual({
      n: 16,
      ok_n: 5,
      bad_n: 11,
      other_n: 5,
      made_n: 3,
      generic_n: 0,
      unknown_n: 3,
      engines_correct: 2,
      off_ans: 5,
      ok_with_official: 5,
      bad_with_official: 0,
    });
    expect(r.data.computed.s.engines_total).toBe(4);
    // v12 문장용 값 — 렌더러 out_v2 추적(numbers)과 같은 문자열
    expect(r.data.computed.s.off_ans).toBe(5);
    expect(r.data.computed.s.bad_parts).toBe(
      "다른 회사로 착각 5 · 지어낸 설명 3 · 모른다 3"
    );
    expect(r.data.computed.per_q).toHaveLength(4);
  });

  it("원본 배열 순서가 바뀌어도(answerKey 매칭) 결과가 같다 — 인덱스 매칭 폐기", () => {
    const source = sourceOf(knowverseJob());
    const review = knowverseReview(source);
    const shuffled: ReportSource = {
      ...source,
      answers: [...source.answers].reverse(),
    };
    const a = issue(source, review);
    const b = issue(shuffled, review);
    if (!(a.ok && b.ok)) {
      throw new Error("발행 실패");
    }
    expect(b.data.computed).toEqual(a.data.computed);
    expect(comparableAnswers(shuffled, review).map((x) => x.answerKey)).toEqual(
      comparableAnswers(source, review).map((x) => x.answerKey)
    );
  });
});

describe("T3·T5 판별 검증과 승인 게이트", () => {
  const source = sourceOf(knowverseJob());

  it("🔴 다른 회차의 판별(run-id 불일치)은 거부", () => {
    const r = issue(
      source,
      knowverseReview(source, {
        auditJobId: "e395f16c-c4cc-4bab-a0b0-b16bc2f1a3f9",
      })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toContain("run_mismatch");
    }
  });

  it("🔴 원본 해시 불일치(판별 후 원본이 바뀜)는 거부", () => {
    const review = knowverseReview(source);
    const changed = sourceOf(
      knowverseJob((rows) => {
        rows[1].rawResponse = "재판정 뒤 바뀐 원문";
      })
    );
    const r = issue(changed, review);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toContain("hash_mismatch");
    }
  });

  it("🔴 초안(draft)은 발행 거부, 미리보기는 허용하되 저장 형식 검사에서 떨어진다", () => {
    const draft = knowverseReview(source, {
      status: "draft",
      reviewer: null,
      reviewedAt: null,
    });
    const issued = issue(source, draft, "issue");
    expect(issued.ok).toBe(false);
    if (!issued.ok) {
      expect(issued.errors.map((e) => e.code)).toEqual(
        expect.arrayContaining(["not_approved", "reviewer_missing"])
      );
    }
    const preview = issue(source, draft, "preview");
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.data.computed.s.n).toBe(16);
      // 초안 미리보기가 실수로 저장돼도 /r 링크는 열리지 않는다.
      expect(parseClientReportData(preview.data)).toBeNull();
    }
  });

  it("판별 누락·모르는 키·원문에 없는 인용은 거부", () => {
    const review = knowverseReview(source);
    const firstKey = comparableAnswers(source, review)[0].answerKey;
    const { [firstKey]: _gone, ...rest } = review.labels;
    const missing = validateReview(
      source,
      { ...review, labels: rest },
      { requireApproval: true, now: ISSUED }
    );
    expect(missing.ok).toBe(false);
    const unknownKey = "0".repeat(40);
    const unknown = validateReview(
      source,
      {
        ...review,
        labels: {
          ...review.labels,
          [unknownKey]: { l: "ok", who: "", summary: "" },
        },
      },
      { requireApproval: true, now: ISSUED }
    );
    expect(unknown.ok).toBe(false);
    const badQuote = validateReview(
      source,
      {
        ...review,
        labels: {
          ...review.labels,
          [firstKey]: { ...review.labels[firstKey], quote: "원문에 없는 문장" },
        },
      },
      { requireApproval: true, now: ISSUED }
    );
    expect(badQuote.ok).toBe(false);
    if (!(missing.ok || unknown.ok || badQuote.ok)) {
      expect(missing.errors.map((e) => e.code)).toContain("label_missing");
      expect(unknown.errors.map((e) => e.code)).toContain("label_unknown_key");
      expect(badQuote.errors.map((e) => e.code)).toContain("quote_not_in_raw");
    }
  });

  it("원문 부분문자열 인용은 통과하고 evidence 로 따로 저장된다(요약과 분리)", () => {
    const review = knowverseReview(source);
    const first = comparableAnswers(source, review)[0];
    const quote = first.rawResponse.slice(0, 10);
    const r = issue(source, {
      ...review,
      labels: {
        ...review.labels,
        [first.answerKey]: { ...review.labels[first.answerKey], quote },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.evidence).toEqual([{ answerKey: first.answerKey, quote }]);
    }
  });

  it("오래된 측정(14일 초과)·측정 전 검토일은 발행 거부", () => {
    const stale = buildReportFromReview({
      source,
      review: knowverseReview(source),
      mode: "issue",
      slug: "knowverse",
      version: 1,
      issuedAt: new Date("2026-10-20T00:00:00.000Z"),
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.errors.map((e) => e.code)).toContain("stale_measurement");
    }
    const early = issue(
      source,
      knowverseReview(source, { reviewedAt: "2026-09-01T00:00:00.000Z" })
    );
    expect(early.ok).toBe(false);
  });

  it("승인본은 원본 지문·승인 기록·만료를 담고, 만료가 지나면 열리지 않는다", () => {
    const r = issue(source, knowverseReview(source));
    if (!r.ok) {
      throw new Error("발행 실패");
    }
    const stored = JSON.parse(JSON.stringify(r.data));
    const parsed = parseClientReportData(stored);
    expect(parsed?.schemaVersion).toBe(2);
    expect(r.data.source).toMatchObject({
      auditJobId: JOB_ID,
      completedAt: COMPLETED,
      resultSha256: source.run.resultSha256,
      verdictVersion: 2,
    });
    expect(r.data.review).toMatchObject({
      status: "approved",
      reviewer: "나현덕",
      rubric: "brand-identity-v1",
    });
    if (!parsed) {
      throw new Error("parse");
    }
    expect(isClientReportExpired(parsed, new Date("2026-10-01"))).toBe(false);
    expect(isClientReportExpired(parsed, new Date("2026-10-31"))).toBe(true);
  });
});

describe("리포트 세션 계약 보강 (06 계약 4절 요청)", () => {
  const source = sourceOf(knowverseJob());

  it("answersSha256 은 answers 만으로 재계산되고, provenance 는 app-export", () => {
    expect(source.run.answersSha256).toBe(resultSha256(source.answers));
    expect(source.provenance.kind).toBe("app-export");
  });

  it("🔴 분모 칸(엔진×질문)에 반복 답변이 2건이면 거부, 빈 칸도 거부", () => {
    const dup = sourceOf(
      knowverseJob((rows) => {
        rows.push({ ...rows[0], rawResponse: "같은 칸 두 번째" });
      })
    );
    const base = knowverseReview(source);
    const extra = dup.answers.find((a) => a.repeat === 2);
    if (!extra) {
      throw new Error("fixture");
    }
    const withDup = {
      ...base,
      resultSha256: dup.run.resultSha256,
      labels: {
        ...base.labels,
        [extra.answerKey]: { l: "ok" as const, who: "", summary: "" },
      },
    };
    const r = validateReview(dup, withDup, { requireApproval: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.code)).toContain(
        "denominator_cell_duplicate"
      );
    }
    const missingCell = validateReview(
      source,
      knowverseReview(source, {
        denominator: {
          engines: ["chatgpt", "claude", "perplexity", "gemini", "hyperclova"],
          promptKinds: ["brand"],
        },
      }),
      { requireApproval: false }
    );
    expect(missingCell.ok).toBe(false);
    if (!missingCell.ok) {
      expect(missingCell.errors.map((e) => e.code)).toContain(
        "denominator_cell_missing"
      );
    }
  });
});
