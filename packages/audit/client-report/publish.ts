// 사람 판별(ReportReview@1) 검증 + 승인 게이트 + 발행본(Report.data v2) 조립.
//
// 흐름: ReportSource(사실, 앱이 만듦) + ReportReview(판단, 사람이 채움) → 검증 → v2 스냅숏.
// 🔴 계산식은 하나다: 여기서 **비교 범위(분모)의 답변만** 골라 기존 `computeClientReport`
//   (build.py 와 교차 검증된 함수)에 넘긴다. 웹 `/r/<토큰>` 과 PDF(`?print=1` 인쇄)는
//   이 스냅숏 하나를 그리므로 숫자가 갈라질 수 없다.
// 🔴 자동 판정(mentionQuality)은 초안일 뿐 — 발행에는 사람이 확정·승인한 labels 만 쓴다.

import { z } from "zod";
import {
  type ClientReportConfig,
  computeClientReport,
  ENGINE_NAMES,
  type EngineId,
} from "./compute";
import { renderStrings } from "./render-strings";
import {
  CLIENT_REPORT_SCHEMA,
  CLIENT_REPORT_TEMPLATE_VERSION,
  type ClientReportDataV2,
  clientReportConfigViewSchema,
} from "./report-data";
import type { ReportSource, ReportSourceAnswer } from "./source";

export const REPORT_REVIEW_CONTRACT = "findable.report-review@1";
/** 측정 후 이 일수가 지나면 발행 거부(v12 `release.stale_after_days`). */
export const DEFAULT_STALE_AFTER_DAYS = 14;

const engineIds = Object.keys(ENGINE_NAMES) as [EngineId, ...EngineId[]];
const labelId = z.enum(["ok", "other", "made", "generic", "unknown", "none"]);

export const reportReviewSchema = z.object({
  contract: z.literal(REPORT_REVIEW_CONTRACT),
  auditJobId: z.string().uuid(),
  resultSha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** 판별 기준 버전(예: brand-identity-v1). */
  rubric: z.string().min(1),
  /** 사람이 확정한 비교 범위 — v12 기본 AI 4곳 × 브랜드명 질문. */
  denominator: z.object({
    engines: z.array(z.enum(engineIds)).min(1),
    promptKinds: z.array(z.string().min(1)).min(1),
  }),
  /** 리포트에 싣는 질문(순서 = 리포트 질문 번호). promptText 는 원본과 글자까지 같아야 한다. */
  questions: z
    .array(
      z.object({ promptText: z.string().min(1), short: z.string().min(1) })
    )
    .min(1),
  /** answerKey → 판별. quote=원문 부분문자열(선택, 기계 검증) · summary=작성자 요약. */
  labels: z.record(
    z.string().regex(/^[0-9a-f]{40}$/),
    z.object({
      l: labelId,
      who: z.string(),
      summary: z.string(),
      quote: z.string().optional(),
      rationale: z.string().optional(),
    })
  ),
  officialDomains: z.array(z.string().min(1)).min(1),
  lookalikeDomains: z.array(z.string()).optional(),
  /** v12 config.json 의 문구 필드(brand·cover_title·why·causes·playbook …). 판별·질문·도메인은 위 필드가 정본. */
  copy: z.record(z.string(), z.unknown()),
  reviewer: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  status: z.enum(["draft", "approved"]),
});
export type ReportReview = z.infer<typeof reportReviewSchema>;

export type ReviewError =
  | { code: "review_invalid"; detail: string }
  | { code: "run_mismatch" }
  | { code: "hash_mismatch" }
  | { code: "question_not_in_source"; promptText: string }
  | { code: "question_without_answers"; promptText: string }
  | { code: "denominator_empty" }
  | { code: "label_missing"; answerKey: string }
  | { code: "label_unknown_key"; answerKey: string }
  | { code: "quote_not_in_raw"; answerKey: string }
  | { code: "copy_invalid"; detail: string }
  | { code: "not_approved" }
  | { code: "reviewer_missing" }
  | { code: "reviewed_before_measurement" }
  | { code: "stale_measurement"; days: number };

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** 분모에 들어가는 답변 — 사람이 고른 엔진 × 질문 종류 × 리포트 질문. 순서: 질문 → 엔진 → 반복. */
export function comparableAnswers(
  source: ReportSource,
  review: Pick<ReportReview, "denominator" | "questions">
): ReportSourceAnswer[] {
  const engines = new Set<string>(review.denominator.engines);
  const kinds = new Set(review.denominator.promptKinds);
  const qIndex = new Map(
    review.questions.map((q, i) => [q.promptText.trim(), i])
  );
  const order = Object.keys(ENGINE_NAMES);
  return source.answers
    .filter(
      (a) =>
        engines.has(a.engineId) &&
        kinds.has(a.promptKind) &&
        qIndex.has(a.promptText)
    )
    .sort(
      (a, b) =>
        (qIndex.get(a.promptText) ?? 0) - (qIndex.get(b.promptText) ?? 0) ||
        order.indexOf(a.engineId) - order.indexOf(b.engineId) ||
        a.repeat - b.repeat
    );
}

/**
 * 원본과 판별이 **같은 회차·같은 원본**을 가리키는지, 빠짐·남음이 없는지 검사한다.
 * `requireApproval` 이면 승인 게이트까지(발행용). 아니면 초안 점검용.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 발행 게이트 — 모든 거부 사유를 한 목록으로 모아 돌려준다(첫 오류에서 멈추면 사람이 여러 번 고쳐야 한다).
export function validateReview(
  source: ReportSource,
  reviewInput: unknown,
  opts: {
    now?: Date;
    requireApproval: boolean;
    staleAfterDays?: number;
  }
): { ok: true; review: ReportReview } | { ok: false; errors: ReviewError[] } {
  const parsed = reportReviewSchema.safeParse(reviewInput);
  if (!parsed.success) {
    return {
      ok: false,
      errors: [
        {
          code: "review_invalid",
          detail: parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join(" / "),
        },
      ],
    };
  }
  const review = parsed.data;
  const errors: ReviewError[] = [];
  if (review.auditJobId !== source.run.auditJobId) {
    errors.push({ code: "run_mismatch" });
  }
  if (review.resultSha256 !== source.run.resultSha256) {
    errors.push({ code: "hash_mismatch" });
  }
  const promptTexts = new Set(source.answers.map((a) => a.promptText));
  for (const q of review.questions) {
    if (!promptTexts.has(q.promptText.trim())) {
      errors.push({ code: "question_not_in_source", promptText: q.promptText });
    }
  }
  const comparable = comparableAnswers(source, review);
  if (comparable.length === 0) {
    errors.push({ code: "denominator_empty" });
  }
  for (const q of review.questions) {
    const text = q.promptText.trim();
    if (
      promptTexts.has(text) &&
      !comparable.some((a) => a.promptText === text)
    ) {
      errors.push({
        code: "question_without_answers",
        promptText: q.promptText,
      });
    }
  }
  const byKey = new Map(source.answers.map((a) => [a.answerKey, a]));
  for (const a of comparable) {
    if (!review.labels[a.answerKey]) {
      errors.push({ code: "label_missing", answerKey: a.answerKey });
    }
  }
  for (const [key, label] of Object.entries(review.labels)) {
    const answer = byKey.get(key);
    if (!answer) {
      errors.push({ code: "label_unknown_key", answerKey: key });
      continue;
    }
    if (
      label.quote &&
      !squash(answer.rawResponse).includes(squash(label.quote))
    ) {
      errors.push({ code: "quote_not_in_raw", answerKey: key });
    }
  }
  if (opts.requireApproval) {
    if (review.status !== "approved") {
      errors.push({ code: "not_approved" });
    }
    const reviewedAt = review.reviewedAt ? new Date(review.reviewedAt) : null;
    if (
      !(review.reviewer?.trim() && reviewedAt && !Number.isNaN(+reviewedAt))
    ) {
      errors.push({ code: "reviewer_missing" });
    } else if (reviewedAt < new Date(source.run.completedAt)) {
      errors.push({ code: "reviewed_before_measurement" });
    }
    const now = opts.now ?? new Date();
    const days = Math.floor(
      (now.getTime() - new Date(source.run.completedAt).getTime()) / 86_400_000
    );
    if (days > (opts.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS)) {
      errors.push({ code: "stale_measurement", days });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, review };
}

const kstDate = (d: Date) =>
  new Date(d.getTime() + 9 * 3_600_000)
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", ".");

/**
 * 검증된 원본 + 판별 → Report.data v2. `mode: "preview"` 는 승인 전 점검용(저장 금지).
 * 발행(`"issue"`)은 승인 게이트를 통과해야만 만든다.
 */
export function buildReportFromReview(input: {
  expiresAt?: Date | null;
  issuedAt: Date;
  mode: "preview" | "issue";
  review: unknown;
  slug: string;
  source: ReportSource;
  staleAfterDays?: number;
  version: number;
}):
  | { ok: true; data: ClientReportDataV2 }
  | { ok: false; errors: ReviewError[] } {
  const checked = validateReview(input.source, input.review, {
    requireApproval: input.mode === "issue",
    now: input.issuedAt,
    staleAfterDays: input.staleAfterDays,
  });
  if (!checked.ok) {
    return checked;
  }
  const review = checked.review;
  const { source } = input;
  const rows = comparableAnswers(source, review);
  const config: ClientReportConfig = {
    measured_at: kstDate(new Date(source.run.completedAt)),
    issued_at: kstDate(input.issuedAt),
    ...review.copy,
    slug: input.slug,
    domain: source.run.domain,
    audit_id: source.run.auditJobId,
    official_domains: review.officialDomains,
    lookalike_domains: review.lookalikeDomains ?? [],
    questions: review.questions.map((q) => q.promptText.trim()),
    question_short: review.questions.map((q) => q.short),
    labels: rows.map((a) => {
      const l = review.labels[a.answerKey];
      // 화면의 「답변 핵심 한 줄」은 작성자 요약(summary). 원문 인용(quote)은 evidence 로 따로 둔다.
      return { l: l.l, who: l.who, q: l.summary };
    }),
  };
  let computed: ReturnType<typeof computeClientReport>;
  let view: z.infer<typeof clientReportConfigViewSchema>;
  try {
    computed = computeClientReport(config, {
      result: {
        engineResponses: rows.map((a) => ({
          engineId: a.engineId,
          promptText: a.promptText,
          citedSources: a.citedSources,
        })),
      },
    });
    const parsedView = clientReportConfigViewSchema.safeParse(
      renderStrings(config, { s: computed.s, c: config })
    );
    if (!parsedView.success) {
      return {
        ok: false,
        errors: [
          {
            code: "copy_invalid",
            detail: parsedView.error.issues
              .slice(0, 5)
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join(" / "),
          },
        ],
      };
    }
    view = parsedView.data;
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          code: "copy_invalid",
          detail: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  return {
    ok: true,
    data: {
      schema: CLIENT_REPORT_SCHEMA,
      schemaVersion: 2,
      version: input.version,
      templateVersion: CLIENT_REPORT_TEMPLATE_VERSION,
      source: {
        auditId: source.run.auditJobId,
        auditJobId: source.run.auditJobId,
        clientSlug: input.slug,
        completedAt: source.run.completedAt,
        importedAt: input.issuedAt.toISOString(),
        resultSha256: source.run.resultSha256,
        verdictVersion: source.run.verdictVersion,
      },
      review: {
        status: review.status,
        reviewer: review.reviewer,
        reviewedAt: review.reviewedAt,
        rubric: review.rubric,
      },
      denominator: {
        engines: review.denominator.engines,
        promptKinds: review.denominator.promptKinds,
        n: rows.length,
      },
      evidence: rows.flatMap((a) => {
        const quote = review.labels[a.answerKey]?.quote;
        return quote ? [{ answerKey: a.answerKey, quote }] : [];
      }),
      release: {
        issuedAt: input.issuedAt.toISOString(),
        expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
      },
      config: view,
      computed,
    },
  };
}
