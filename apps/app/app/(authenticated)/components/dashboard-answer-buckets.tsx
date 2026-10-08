import {
  type AnswerBucketSummary,
  answerBucketCopy,
  bucketCount,
  bucketRate,
  HEADLINE_BUCKETS,
  summarizeAnswerBuckets,
} from "@repo/audit/answer-buckets";
import type { BrandNameCheck } from "@repo/audit/brand-name-check";
import { engineDisplayName } from "@repo/audit/engine-labels";
import type { AppDictionary } from "@/lib/i18n";

/**
 * 대시보드 헤드라인 4분류 (2026-09-29) — 공개 리포트 히어로와 **같은 함수·같은 문구**.
 *
 * 입력은 이 대시보드가 보여주는 **현재 회차의 AuditJob 결과**(`withRecomputedAuditMetrics`
 * 를 거친 값)다. Tracking 에는 판정(mentionQuality)이 저장되지 않아 「다른 회사로 앎」을
 * 셀 수 없다 — 그래서 회차 원본에서 센다.
 */
function readSummary(result: unknown): AnswerBucketSummary | null {
  if (!(result && typeof result === "object")) {
    return null;
  }
  const record = result as {
    engineResponses?: unknown;
    metrics?: { answerBuckets?: AnswerBucketSummary };
  };
  if (record.metrics?.answerBuckets?.version === 1) {
    return record.metrics.answerBuckets;
  }
  return Array.isArray(record.engineResponses)
    ? summarizeAnswerBuckets(
        record.engineResponses.filter(
          (row): row is { engineId: string } =>
            Boolean(row) &&
            typeof row === "object" &&
            typeof (row as { engineId?: unknown }).engineId === "string"
        )
      )
    : null;
}

function readBrandNameCheck(result: unknown): BrandNameCheck | null {
  if (!(result && typeof result === "object")) {
    return null;
  }
  const check = (
    result as { measurementContext?: { brandNameCheck?: BrandNameCheck } }
  ).measurementContext?.brandNameCheck;
  return check && typeof check.status === "string" ? check : null;
}

const TONE: Record<(typeof HEADLINE_BUCKETS)[number], string> = {
  // ⚠️ 실존 토큰만 쓴다(globals.css 에 success 만 있다 · danger/warning 은 미정의).
  confirmed: "text-[color:var(--findable-success)]",
  different_entity: "text-red-400",
  unknown: "text-amber-300",
  engine_error: "text-[color:var(--findable-ink-subtle,#8a8f98)]",
};

export function DashboardAnswerBuckets({
  isKo = true,
  result,
  t,
}: {
  /** 공용 패키지 문구(`answerBucketCopy`·엔진 이름)의 언어. */
  isKo?: boolean;
  result: unknown;
  t: AppDictionary["answerBuckets"];
}) {
  const summary = readSummary(result);
  const nameCheck = readBrandNameCheck(result);
  if (!summary || summary.ai.total === 0) {
    return null;
  }
  const { ai } = summary;
  return (
    <section
      className="findable-card p-5"
      data-testid="dashboard-answer-buckets"
    >
      {nameCheck?.status === "mismatch" ? (
        <p
          className="mb-4 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-amber-100 text-sm"
          role="alert"
        >
          {nameCheck.siteNames[0]
            ? t.nameMismatchWithSite
                .replace("{input}", nameCheck.inputName)
                .replace("{site}", nameCheck.siteNames[0])
            : t.nameMismatch.replace("{input}", nameCheck.inputName)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-base">
          {t.title}
        </h2>
        <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
          {t.basis.replace("{n}", String(ai.total))}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {HEADLINE_BUCKETS.map((bucket) => {
          const count = bucketCount(ai, bucket);
          const failure = bucket === "engine_error";
          const rate = failure
            ? bucketRate(count, ai.total)
            : bucketRate(count, ai.adjudicated);
          const copy = answerBucketCopy(bucket, isKo);
          return (
            <div
              className="rounded-lg border border-[color:var(--findable-hairline,#2d3035)] p-3"
              data-bucket={bucket}
              key={bucket}
            >
              <div className={`font-medium text-xs ${TONE[bucket]}`}>
                {copy.label}
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tabular-nums">
                  {count}
                </span>
                <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                  {t.countUnit}
                </span>
                <span className="ml-auto text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm tabular-nums">
                  {rate === null ? "—" : `${rate}%`}
                </span>
              </div>
              <p className="mt-1 break-keep text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs leading-relaxed">
                {failure
                  ? t.ofAttempts.replace("{n}", String(ai.total))
                  : t.ofJudged.replace("{n}", String(ai.adjudicated))}
                {" · "}
                {copy.explain}
              </p>
            </div>
          );
        })}
      </div>
      <ul className="mt-3 space-y-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
        {ai.unverified > 0 ? (
          <li>
            {t.pending.replace("{n}", String(ai.unverified))}{" "}
            {answerBucketCopy("unverified", isKo).explain}
          </li>
        ) : null}
        {summary.discovery ? (
          <li>
            {t.discovery
              .replace("{recommended}", String(summary.discovery.recommended))
              .replace("{adjudicated}", String(summary.discovery.adjudicated))}
          </li>
        ) : null}
        {Object.entries(summary.searchByEngine ?? {}).length > 0 ? (
          <li>
            {Object.entries(summary.searchByEngine ?? {})
              .map(
                ([id, g]) =>
                  `${engineDisplayName(id, isKo)} ${g.confirmed}/${g.adjudicated}`
              )
              .join(" · ")}{" "}
            {t.searchNote}
          </li>
        ) : null}
        <li>
          {t.engines
            .replace("{confirmed}", String(summary.engines.confirmed))
            .replace("{measured}", String(summary.engines.measured))}
        </li>
      </ul>
    </section>
  );
}
