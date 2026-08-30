"use client";

import { Bot, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

type CrewStatus = "not_requested" | "queued" | "processing" | "completed" | "failed";
type CrewResult = {
  strategist?: { output?: { executiveSummary?: string; topActions?: Array<{ title?: string }> } };
};

export function DashboardDeepAnalysis({
  crewResult,
  crewStatus,
  jobId,
}: {
  crewResult: CrewResult | null;
  crewStatus: CrewStatus;
  jobId: string | null;
}) {
  const [status, setStatus] = useState(crewStatus);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const output = crewResult?.strategist?.output;

  if (!jobId) return null;
  if (status === "completed" && output) {
    return (
      <section className="findable-card p-5 md:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--findable-primary,#ff7a4d)]/12 text-[color:var(--findable-primary,#ff7a4d)]"><Bot className="size-5" /></span>
          <div className="min-w-0">
            <p className="font-semibold text-[color:var(--findable-ink,#f7f8f8)]">심층 분석 결과</p>
            <p className="mt-1 text-sm text-[color:var(--findable-ink-subtle,#8a8f98)]">{output.executiveSummary ?? "이 회차의 측정 근거를 추가 분석했습니다."}</p>
            {output.topActions?.length ? <ol className="mt-3 space-y-1 text-sm text-[color:var(--findable-ink-subtle,#8a8f98)]">{output.topActions.slice(0, 3).map((action, index) => <li key={`${index}-${action.title}`}>{index + 1}. {action.title ?? "개선 과제"}</li>)}</ol> : null}
          </div>
        </div>
      </section>
    );
  }

  const busy = starting || status === "queued" || status === "processing";
  const start = async () => {
    setStarting(true);
    setError(null);
    const response = await fetch(`/api/audit/${jobId}/crew`, { method: "POST" });
    const body = (await response.json().catch(() => ({}))) as { error?: string; crewStatus?: CrewStatus };
    if (!response.ok && body.crewStatus !== "queued" && body.crewStatus !== "processing") {
      setError(body.error ?? "심층 분석을 시작하지 못했습니다.");
      setStarting(false);
      return;
    }
    setStatus(body.crewStatus ?? "queued");
    setStarting(false);
  };

  return (
    <section className="findable-card flex flex-wrap items-center justify-between gap-4 p-5 md:p-6">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--findable-primary,#ff7a4d)]/12 text-[color:var(--findable-primary,#ff7a4d)]"><Sparkles className="size-5" /></span>
        <div>
          <p className="font-semibold text-[color:var(--findable-ink,#f7f8f8)]">측정 근거로 심층 분석하기</p>
          <p className="mt-1 text-sm text-[color:var(--findable-ink-subtle,#8a8f98)]">실측 결과와 인용 근거를 바탕으로 개선 우선순위를 한 번 더 정리합니다.</p>
          {busy ? <p className="mt-2 text-xs text-[color:var(--findable-primary,#ff7a4d)]">분석 중입니다. 잠시 후 새로고침하면 결과가 표시됩니다.</p> : null}
          {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
        </div>
      </div>
      <button className="findable-btn-primary inline-flex shrink-0 items-center gap-2 rounded-md px-4 py-2 font-medium text-sm disabled:opacity-60" disabled={busy} onClick={start} type="button">
        {busy ? <><Loader2 className="size-4 animate-spin" /> 분석 중</> : "심층 분석 시작"}
      </button>
    </section>
  );
}
