"use client";

import type { AnswerBucketSummary } from "@repo/audit/answer-buckets";
import {
  AnswerBucketBoard,
  type MatrixAnswer,
  QuestionEngineMatrix,
} from "./answer-buckets";

/** A provisional run exposes channel evidence, never the blended GEO score. */
export function ProvisionalEvidenceView({
  brandName,
  discoveryPromptCount,
  domain,
  isKo,
  rows,
  summary,
}: {
  brandName: string;
  discoveryPromptCount?: number;
  domain: string;
  isKo: boolean;
  rows: MatrixAnswer[];
  summary: AnswerBucketSummary;
}) {
  const searchCount = summary.search?.adjudicated ?? 0;
  return (
    <section
      className="mx-auto max-w-5xl space-y-8 pb-24 lg:pb-12"
      data-testid="provisional-evidence-view"
    >
      <div className="rounded-2xl border border-amber-400/30 bg-zinc-900/80 p-6 md:p-10">
        <div className="font-medium text-amber-300 text-xs uppercase tracking-[0.16em]">
          {isKo ? "잠정 결과 · 점수 보류" : "Provisional · score withheld"}
        </div>
        <h1 className="mt-3 font-semibold text-2xl text-zinc-50 md:text-4xl">
          {isKo
            ? `${brandName}의 이번 AI 점수는 확정하지 않습니다.`
            : `The AI score for ${brandName} is not final.`}
        </h1>
        <p className="mt-4 text-sm text-zinc-300 leading-relaxed">
          {isKo
            ? `브랜드 질문 AI 확정 답변 ${summary.ai.adjudicated}건 · 검색 노출 ${searchCount}건. 검색 결과는 AI 답변과 분리해 보여드립니다.`
            : `${summary.ai.adjudicated} adjudicated brand-question AI answers · ${searchCount} search results. Search exposure is shown separately from AI answers.`}
        </p>
        <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
          {isKo
            ? "이번 회차의 혼합 종합 점수·개선 처방·PDF는 공개하지 않습니다. 아래 분류와 원문은 측정 근거로 확인할 수 있습니다."
            : "The blended composite score, recommendations and PDF are withheld for this run. The categories and saved answers remain available as evidence."}
        </p>
      </div>
      <AnswerBucketBoard
        discoveryPromptCount={discoveryPromptCount}
        isKo={isKo}
        summary={summary}
      />
      <QuestionEngineMatrix brandDomain={domain} isKo={isKo} rows={rows} />
    </section>
  );
}
