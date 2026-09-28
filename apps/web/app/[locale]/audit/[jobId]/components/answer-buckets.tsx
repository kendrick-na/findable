"use client";

// 답변 4분류 화면 조각 (2026-09-29)
//
//   · AnswerBucketBoard     — 히어로 맨 위 4칸(제대로 앎/다른 회사로 앎/모름/측정 실패)
//   · BrandNameMismatchNotice — 입력 브랜드명이 사이트 표기와 다를 때 경고
//   · QuestionEngineMatrix  — 「질문 × 엔진」 표(4분류 배지 + 짧은 발췌 + 사유)
//   · RevenueImpactOptIn    — 놓치는 유입 추정은 고객이 직접 숫자를 넣었을 때만
//
// 계산은 전부 `@repo/audit/answer-buckets` 한 곳에서 한다(화면은 세지 않는다).

import {
  type AnswerBucket,
  type AnswerBucketSummary,
  answerBucketCopy,
  answerGroup,
  answerReason,
  bucketCount,
  bucketRate,
  classifyAnswer,
  HEADLINE_BUCKETS,
  isDiscoveryAnswer,
  isLegacyNaverSynthesis,
  officialDomainExposed,
  type PromptKind,
} from "@repo/audit/answer-buckets";
import type { BrandNameCheck } from "@repo/audit/brand-name-check";
import { engineDisplayName, engineNote } from "@repo/audit/engine-labels";
import { stripMarkdown } from "@repo/audit/strip-markdown";
import { AlertCircle, ChevronDown } from "lucide-react";
import { useState } from "react";
import { RevenueImpactCard } from "./revenue-impact-card";

const BUCKET_TONE: Record<AnswerBucket, string> = {
  confirmed:
    "border-[var(--signal-good)]/30 bg-[var(--signal-good)]/10 text-[var(--signal-good)]",
  different_entity:
    "border-[var(--signal-bad)]/30 bg-[var(--signal-bad)]/10 text-[var(--signal-bad)]",
  unknown:
    "border-[var(--signal-warn)]/30 bg-[var(--signal-warn)]/10 text-[var(--signal-warn)]",
  engine_error: "border-white/10 bg-white/5 text-zinc-400",
  unverified: "border-white/10 bg-white/5 text-zinc-400",
};

/** 답변 1개의 4분류 배지 — 「미언급」 한 단어로 뭉개지 않는다. */
export function AnswerBucketPill({
  bucket,
  isKo,
}: {
  bucket: AnswerBucket;
  isKo: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center self-start whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-xs ${BUCKET_TONE[bucket]}`}
      data-bucket={bucket}
    >
      {answerBucketCopy(bucket, isKo).label}
    </span>
  );
}

function unitLabel(count: number, isKo: boolean): string {
  if (isKo) {
    return "개";
  }
  return count === 1 ? "answer" : "answers";
}

function denominatorLabel(
  isFailure: boolean,
  ai: AnswerBucketSummary["ai"],
  isKo: boolean
): string {
  if (isFailure) {
    return isKo
      ? `시도 ${ai.total}개 중 · 비율 계산 제외`
      : `of ${ai.total} attempts · excluded`;
  }
  return isKo
    ? `판정 끝난 ${ai.adjudicated}개 중`
    : `of ${ai.adjudicated} adjudicated`;
}

function toggleCopy(open: boolean, isKo: boolean): string {
  if (open) {
    return isKo ? "접기" : "Collapse";
  }
  return isKo ? "원문 전체 보기" : "Show full answer";
}

export function AnswerBucketBoard({
  summary,
  isKo,
  discoveryPromptCount,
}: {
  summary: AnswerBucketSummary;
  isKo: boolean;
  /** 러너가 만든 이름 없는 질문 수. undefined = 그 기능 이전 회차(말하지 않는다). */
  discoveryPromptCount?: number;
}) {
  const { ai } = summary;
  return (
    <div className="mt-6" data-testid="answer-bucket-board">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-semibold text-base text-zinc-100">
          {isKo ? "AI가 우리를 어떻게 알고 있나" : "How AI knows you"}
        </h2>
        <span className="text-xs text-zinc-400">
          {isKo
            ? `답변 기준 · 브랜드 이름으로 물은 AI 답변 ${ai.total}개`
            : `Per answer · ${ai.total} AI answers asked by brand name`}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {HEADLINE_BUCKETS.map((bucket) => {
          const count = bucketCount(ai, bucket);
          const copy = answerBucketCopy(bucket, isKo);
          const isFailure = bucket === "engine_error";
          // 비율 = 판정이 끝난 답변 기준. 측정 실패는 분모 밖이라 「시도 중」 비율로 따로 말한다.
          const rate = isFailure
            ? bucketRate(count, ai.total)
            : bucketRate(count, ai.adjudicated);
          return (
            <div
              className="flex min-w-0 flex-col rounded-xl border border-white/10 bg-white/[0.03] p-3"
              data-bucket={bucket}
              key={bucket}
            >
              <AnswerBucketPill bucket={bucket} isKo={isKo} />
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="font-semibold text-2xl text-zinc-50 tabular-nums">
                  {count}
                </span>
                <span className="text-xs text-zinc-400">
                  {unitLabel(count, isKo)}
                </span>
                <span className="ml-auto text-sm text-zinc-300 tabular-nums">
                  {rate === null ? "—" : `${rate}%`}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {denominatorLabel(isFailure, ai, isKo)}
              </p>
              <p className="mt-2 break-keep text-xs text-zinc-400 leading-relaxed">
                {copy.explain}
              </p>
            </div>
          );
        })}
      </div>

      <ul className="mt-3 space-y-1.5 text-xs text-zinc-400 leading-relaxed">
        {ai.unverified > 0 && (
          <li className="break-keep">
            <span className="font-medium text-zinc-300">
              {answerBucketCopy("unverified", isKo).label} {ai.unverified}
              {isKo ? "개" : ""}
            </span>{" "}
            — {answerBucketCopy("unverified", isKo).explain}
          </li>
        )}
        {summary.discovery ? (
          <li className="break-keep" data-testid="discovery-line">
            <span className="font-medium text-zinc-300">
              {isKo
                ? `이름 없이 물었을 때 추천됨 ${summary.discovery.recommended}/${summary.discovery.adjudicated}`
                : `Recommended without your name ${summary.discovery.recommended}/${summary.discovery.adjudicated}`}
            </span>{" "}
            —{" "}
            {isKo
              ? "업종·문제로만 물었을 때(브랜드 이름 없이) 우리를 추천한 답변 수예요. 위 4칸에는 넣지 않았어요."
              : "Answers that recommended you when asked only about your category or problem. Not included in the four boxes above."}
            {summary.discovery.engineError > 0 &&
              (isKo
                ? ` 측정 실패 ${summary.discovery.engineError}개는 뺐어요.`
                : ` ${summary.discovery.engineError} failed answers excluded.`)}
          </li>
        ) : (
          discoveryPromptCount === 0 && (
            <li className="break-keep" data-testid="discovery-line">
              {isKo
                ? "이름 없이 묻는 질문 — 공식 사이트 제목·설명에서 업종 단서를 찾지 못해 이번엔 만들지 않았어요."
                : "Unbranded questions — none this run: no category cue was found in the official site's title or description."}
            </li>
          )
        )}
        {Object.entries(summary.searchByEngine ?? {}).length > 0 && (
          <li className="break-keep" data-testid="search-exposure-line">
            <span className="font-medium text-zinc-300">
              {Object.entries(summary.searchByEngine ?? {})
                .map(
                  ([id, g]) =>
                    `${engineDisplayName(id, isKo)} ${g.confirmed}/${g.adjudicated}`
                )
                .join(" · ")}
            </span>{" "}
            —{" "}
            {isKo
              ? "AI 답변이 아니라 검색 결과에 우리 브랜드·공식 도메인이 나왔는지 본 값이라 AI 비율과 따로 셌어요."
              : "Whether search results show your brand or official domain — not AI answers, so counted separately."}
          </li>
        )}
      </ul>
    </div>
  );
}

export function BrandNameMismatchNotice({
  check,
  isKo,
}: {
  check: BrandNameCheck | null | undefined;
  isKo: boolean;
}) {
  if (check?.status !== "mismatch") {
    return null;
  }
  const siteName = check.siteNames[0];
  return (
    <div
      className="flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-amber-100 text-sm"
      data-testid="brand-name-mismatch"
      role="alert"
    >
      <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="break-keep leading-relaxed">
        {isKo
          ? `측정한 브랜드명 「${check.inputName}」이 공식 사이트 표기${siteName ? ` 「${siteName}」` : ""}와 달라요. AI는 입력한 이름 그대로 질문받았기 때문에 아래 결과가 실제 인지도와 다를 수 있어요. 브랜드명을 사이트 표기로 고친 뒤 다시 측정해 주세요.`
          : `The measured brand name "${check.inputName}" differs from the official site's name${siteName ? ` "${siteName}"` : ""}. AI engines were asked with the name as entered, so results below may not reflect real awareness. Fix the name and measure again.`}
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 질문 × 엔진 표
// ──────────────────────────────────────────────────────────────────

export interface MatrixAnswer {
  brandMentioned: boolean;
  citedSources?: Array<{ domain?: string | null; url?: string | null }> | null;
  engineId: string;
  errorMessage: string | null;
  excerpt: string;
  isStub: boolean;
  mentionQuality?: string | null;
  naverSource?: string | null;
  promptKind?: PromptKind | null;
  promptText?: string | null;
  verdictReason?: string | null;
}

const EXCERPT_PREVIEW_CHARS = 140;

interface QuestionGroup {
  kind: PromptKind;
  rows: Array<MatrixAnswer & { rowKey: string }>;
  text: string | null;
}

function groupByQuestion(rows: MatrixAnswer[]): QuestionGroup[] {
  const groups = new Map<string, QuestionGroup>();
  for (const row of rows) {
    if (answerGroup(row.engineId) === "briefing") {
      continue;
    }
    const text = row.promptText ?? null;
    const key = text ?? "__unknown__";
    const group = groups.get(key) ?? {
      text,
      kind: isDiscoveryAnswer(row) ? "discovery" : "brand",
      rows: [],
    };
    // 질문 원문이 없던 이전 회차는 한 묶음에 같은 엔진이 여러 번 들어온다 → 엔진별 순번.
    const seen = group.rows.filter((r) => r.engineId === row.engineId).length;
    group.rows.push({ ...row, rowKey: `${row.engineId}#${seen}` });
    groups.set(key, group);
  }
  // 브랜드 이름 질문 먼저, 이름 없는 질문은 뒤(헤드라인 4칸과 같은 순서로 읽히게).
  return [...groups.values()].sort(
    (a, b) => Number(a.kind === "discovery") - Number(b.kind === "discovery")
  );
}

function preview(excerpt: string): string {
  const text = stripMarkdown(excerpt).replace(/\s+/g, " ").trim();
  return text.length > EXCERPT_PREVIEW_CHARS
    ? `${text.slice(0, EXCERPT_PREVIEW_CHARS).trimEnd()}…`
    : text;
}

/**
 * 과거 네이버 행 — Findable 이 검색 결과로 만든 요약이라 판정 배지를 달지 않는다(2026-09-29).
 * 회색 표기 + 공식 도메인이 검색 결과에 있었는지만 보여준다. 요약 문장은 눌러야 보인다.
 */
function LegacyNaverRow({
  row,
  isKo,
  brandDomain,
}: {
  row: MatrixAnswer;
  isKo: boolean;
  brandDomain?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const failed = Boolean(row.errorMessage || row.isStub);
  const exposed = officialDomainExposed(row, brandDomain);
  let exposure = isKo
    ? "검색 노출: 공식 도메인 없음"
    : "Search exposure: official domain absent";
  if (failed) {
    exposure = isKo ? "검색 노출: 측정 실패" : "Search exposure: failed";
  } else if (exposed) {
    exposure = isKo
      ? "검색 노출: 공식 도메인 나옴"
      : "Search exposure: official domain shown";
  }
  return (
    <li
      className="grid gap-2 border-white/5 border-t px-4 py-3 first:border-t-0 sm:grid-cols-[12rem_1fr] sm:gap-4"
      data-bucket="legacy_naver"
    >
      <div className="flex flex-wrap items-center gap-1.5 sm:flex-col sm:items-start">
        <span className="font-medium text-sm text-zinc-100">
          {engineDisplayName(row.engineId, isKo)}
        </span>
        <span className="inline-flex self-start whitespace-nowrap rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-medium text-xs text-zinc-300">
          {exposure}
        </span>
      </div>
      <div className="min-w-0">
        <p className="break-keep text-xs text-zinc-500">
          {isKo
            ? "이전 측정: Findable이 검색 결과로 만든 요약(현재 미사용) — 네이버가 한 답이 아니라서 판정하지 않았어요."
            : "Earlier run: a summary Findable built from search results (no longer used) — not Naver's answer, so not judged."}
        </p>
        {row.excerpt && !failed && (
          <button
            aria-expanded={open}
            className="mt-1 text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
            onClick={() => setOpen((v) => !v)}
            type="button"
          >
            {open
              ? isKo
                ? "요약 접기"
                : "Hide summary"
              : isKo
                ? "당시 요약 보기"
                : "Show that summary"}
          </button>
        )}
        {open && (
          <p className="mt-1 whitespace-pre-line text-sm text-zinc-500 leading-relaxed [overflow-wrap:anywhere]">
            {stripMarkdown(row.excerpt)}
          </p>
        )}
      </div>
    </li>
  );
}

function MatrixRow({
  row,
  isKo,
  brandDomain,
}: {
  row: MatrixAnswer;
  isKo: boolean;
  brandDomain?: string | null;
}) {
  if (isLegacyNaverSynthesis(row)) {
    return <LegacyNaverRow brandDomain={brandDomain} isKo={isKo} row={row} />;
  }
  return (
    <CurrentMatrixRow
      isKo={isKo}
      retired={answerGroup(row.engineId) === "retired"}
      row={row}
    />
  );
}

function CurrentMatrixRow({
  row,
  isKo,
  retired = false,
}: {
  row: MatrixAnswer;
  isKo: boolean;
  /** 서비스가 끝난 엔진의 과거 원문 — 판정 배지 대신 「집계 제외」만 단다. */
  retired?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const bucket = classifyAnswer(row);
  const isSearch = answerGroup(row.engineId) === "search";
  const hasText = bucket !== "engine_error" && Boolean(row.excerpt);
  const full = hasText ? stripMarkdown(row.excerpt) : "";
  const short = hasText ? preview(row.excerpt) : "";
  return (
    <li
      className="grid gap-2 border-white/5 border-t px-4 py-3 first:border-t-0 sm:grid-cols-[12rem_1fr] sm:gap-4"
      data-bucket={retired ? "retired" : bucket}
    >
      <div className="flex flex-wrap items-center gap-1.5 sm:flex-col sm:items-start">
        <span className="font-medium text-sm text-zinc-100">
          {engineDisplayName(row.engineId, isKo)}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {retired ? (
            <span className="inline-flex self-start whitespace-nowrap rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-medium text-xs text-zinc-400">
              {isKo ? "집계 제외 · 서비스 종료" : "Excluded · service ended"}
            </span>
          ) : (
            <AnswerBucketPill bucket={bucket} isKo={isKo} />
          )}
          {isSearch && (
            <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {isKo ? "검색 결과" : "Search"}
            </span>
          )}
        </div>
      </div>
      <div className="min-w-0">
        <p className="break-keep text-xs text-zinc-400">
          {answerReason(row, isKo)}
        </p>
        {hasText && (
          <p className="mt-1 whitespace-pre-line text-sm text-zinc-300 leading-relaxed [overflow-wrap:anywhere]">
            {open ? full : short}
          </p>
        )}
        {hasText && full.length > short.length && (
          <button
            aria-expanded={open}
            className="mt-1 text-[var(--brand-2)] text-xs underline underline-offset-2 hover:text-zinc-200"
            onClick={() => setOpen((v) => !v)}
            type="button"
          >
            {toggleCopy(open, isKo)}
          </button>
        )}
      </div>
    </li>
  );
}

/** 이름만으로는 오해할 수 있는 엔진의 한 줄 설명 — 이번 회차에 나온 엔진만. */
function EngineLegend({ rows, isKo }: { rows: MatrixAnswer[]; isKo: boolean }) {
  const notes = [...new Set(rows.map((r) => r.engineId))]
    .map((id) => engineNote(id, isKo))
    .filter((note): note is string => Boolean(note));
  if (notes.length === 0) {
    return null;
  }
  return (
    <ul
      className="mb-3 space-y-1 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-zinc-400 leading-relaxed"
      data-testid="engine-legend"
    >
      {notes.map((note) => (
        <li className="break-keep" key={note}>
          {note}
        </li>
      ))}
    </ul>
  );
}

export function QuestionEngineMatrix({
  rows,
  isKo,
  brandDomain,
}: {
  rows: MatrixAnswer[];
  isKo: boolean;
  /** 과거 네이버 행의 공식 도메인 노출 판정에 쓴다. */
  brandDomain?: string | null;
}) {
  const groups = groupByQuestion(rows);
  if (groups.length === 0) {
    return null;
  }
  return (
    <section data-testid="question-engine-matrix">
      <div className="mb-4">
        <div className="font-medium text-xs text-zinc-400">
          {isKo
            ? "측정 원문 · 질문 × 엔진"
            : "Measurement evidence · question × engine"}
        </div>
        <p className="mt-1.5 break-keep text-xs text-zinc-500 leading-relaxed">
          {isKo
            ? `이번 측정에서 던진 질문 ${groups.length}개와 엔진별 답변 전부예요. 답변마다 위 4가지 중 어디에 들어갔는지와 그 이유를 적었어요. 날짜별 변화는 대시보드의 ‘추적 질문’에서 볼 수 있어요.`
            : `All ${groups.length} questions from this run and every engine's answer, each with its category and reason. Track changes over time in the dashboard.`}
        </p>
      </div>
      <EngineLegend isKo={isKo} rows={rows} />
      <div className="space-y-3">
        {groups.map((group, index) => (
          <details
            className="group overflow-hidden rounded-xl border border-white/10 bg-zinc-900/60"
            key={group.text ?? `unknown-${index}`}
            open={index === 0}
          >
            <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="mt-0.5 shrink-0 font-mono text-xs text-zinc-500 tabular-nums">
                Q{index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-keep font-medium text-sm text-zinc-100 leading-snug">
                  {group.text ??
                    (isKo
                      ? "질문 원문이 저장되지 않은 이전 측정"
                      : "Earlier run without stored question text")}
                </span>
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {group.kind === "discovery" && (
                    <span className="rounded border border-[var(--brand-2)]/30 bg-[var(--brand-2)]/10 px-1.5 py-0.5 text-[10px] text-[var(--brand-2)]">
                      {isKo ? "이름 없이 물음" : "Unbranded"}
                    </span>
                  )}
                  {HEADLINE_BUCKETS.map((bucket) => {
                    const n = group.rows.filter(
                      (r) =>
                        answerGroup(r.engineId) === "ai" &&
                        classifyAnswer(r) === bucket
                    ).length;
                    return n > 0 ? (
                      <span className="text-[11px] text-zinc-400" key={bucket}>
                        {answerBucketCopy(bucket, isKo).label} {n}
                      </span>
                    ) : null;
                  })}
                </span>
              </span>
              <ChevronDown
                aria-hidden
                className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 transition-transform group-open:rotate-180"
              />
            </summary>
            <ul className="border-white/10 border-t">
              {group.rows.map((row) => (
                <MatrixRow
                  brandDomain={brandDomain}
                  isKo={isKo}
                  key={row.rowKey}
                  row={row}
                />
              ))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────
// 놓치는 유입 — 고객이 직접 숫자를 넣었을 때만
// ──────────────────────────────────────────────────────────────────

/**
 * 🔴 기본 가정(규모 프리셋)으로 만든 「놓치는 유입 N세션/월」이 결과 2번째 자리에 있었다.
 *   고객이 준 숫자가 하나도 없는 추정을 측정 결과처럼 크게 보여준 것이다.
 *   → 고객이 자기 검색량·객단가를 넣어야만 계산한다. 넣기 전엔 링크 한 줄뿐이다.
 */
export function RevenueImpactOptIn({
  isKo,
  sov,
  attemptedEngines,
  measuredEngines,
}: {
  isKo: boolean;
  sov: number;
  attemptedEngines: number;
  measuredEngines: number;
}) {
  const [queries, setQueries] = useState("");
  const [revenue, setRevenue] = useState("");
  const monthlyAiQueries = Number(queries.replaceAll(",", ""));
  const revenuePerConversion = Number(revenue.replaceAll(",", ""));
  const ready =
    Number.isFinite(monthlyAiQueries) &&
    monthlyAiQueries > 0 &&
    Number.isFinite(revenuePerConversion) &&
    revenuePerConversion > 0;
  return (
    <details className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm">
      <summary
        className="cursor-pointer text-[var(--brand-2)] text-xs underline-offset-2 hover:underline"
        data-testid="revenue-opt-in"
      >
        {isKo
          ? "놓치는 유입이 궁금하다면 — 직접 입력하면 계산해 드려요"
          : "Curious about missed traffic? Enter your own numbers to calculate"}
      </summary>
      <p className="mt-3 break-keep text-xs text-zinc-400 leading-relaxed">
        {isKo
          ? "우리 숫자 없이 기본 가정으로 만든 추정은 보여드리지 않아요. 내 검색량과 고객당 매출을 넣으면 그 값으로만 계산해요."
          : "We don't show estimates built only on default assumptions. Enter your search volume and revenue per customer to calculate."}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-zinc-300">
          {isKo
            ? "월 AI 답변 노출 수(내 브랜드 관련 검색량)"
            : "Monthly AI answer views (your search volume)"}
          <input
            className="mt-1 w-full rounded-md border border-white/10 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 tabular-nums"
            inputMode="numeric"
            onChange={(e) => setQueries(e.target.value)}
            placeholder={isKo ? "예: 20000" : "e.g. 20000"}
            value={queries}
          />
        </label>
        <label className="block text-xs text-zinc-300">
          {isKo ? "고객당 매출(원)" : "Revenue per customer (KRW)"}
          <input
            className="mt-1 w-full rounded-md border border-white/10 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 tabular-nums"
            inputMode="numeric"
            onChange={(e) => setRevenue(e.target.value)}
            placeholder={isKo ? "예: 50000" : "e.g. 50000"}
            value={revenue}
          />
        </label>
      </div>
      {ready && (
        <div className="mt-4">
          <RevenueImpactCard
            attemptedEngines={attemptedEngines}
            customerInput={{ monthlyAiQueries, revenuePerConversion }}
            isKo={isKo}
            key={`${monthlyAiQueries}-${revenuePerConversion}`}
            measuredEngines={measuredEngines}
            sov={sov}
          />
        </div>
      )}
    </details>
  );
}
