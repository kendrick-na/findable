import {
  DEFAULT_ASSUMPTIONS,
  estimateRevenueImpact,
  inferBrandSize,
  SIZE_PRESETS,
} from "@repo/audit/revenue-impact";
import { Info, TrendingUp } from "lucide-react";
import Link from "next/link";

export function DashboardImpactEstimate({
  coverage,
  sov,
}: {
  coverage: { mentioned: number; total: number };
  sov: number;
}) {
  const recognitionRate =
    coverage.total > 0 ? coverage.mentioned / coverage.total : 0;
  const sizeKey = inferBrandSize(recognitionRate, sov);
  const preset = SIZE_PRESETS[sizeKey];
  const estimate = estimateRevenueImpact(sov, {
    ...DEFAULT_ASSUMPTIONS,
    monthlyAiQueries: preset.monthlyAiQueries,
    cpcKrw: preset.cpcKrw,
  });

  return (
    <section className="findable-card overflow-hidden p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[color:var(--findable-primary,#ff7a4d)] text-xs">
            <TrendingUp aria-hidden="true" className="size-3.5" />
            비즈니스 영향 추정
          </div>
          <h2 className="mt-2 font-semibold text-lg text-[color:var(--findable-ink,#f7f8f8)]">
            AI 답변에서 놓치고 있을 수 있는 유입
          </h2>
          <p className="mt-1 text-sm text-[color:var(--findable-ink-subtle,#8a8f98)]">
            이번 회차의 AI 등장률을 바탕으로 한 월간 방문 추정치입니다.
          </p>
        </div>
        <div className="rounded-lg bg-[color:var(--findable-primary,#ff7a4d)]/10 px-4 py-3">
          <p className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tabular-nums">
            {estimate.missedSessionsPerMonth.toLocaleString()}
          </p>
          <p className="mt-0.5 text-xs text-[color:var(--findable-ink-subtle,#8a8f98)]">
            세션 / 월 (추정)
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-[color:var(--findable-hairline,#2d3035)] border-t pt-3">
        <p className="flex max-w-2xl items-start gap-1.5 text-xs text-[color:var(--findable-ink-subtle,#8a8f98)]">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          AI {coverage.total}곳 중 {coverage.mentioned}곳에서 확인된 등장률과 공개 연구 기반 기본 가정을 사용합니다. 실측 유입·매출이 아닙니다.
        </p>
        <Link className="shrink-0 text-sm text-[color:var(--findable-primary,#ff7a4d)] hover:underline" href="/actions">
          개선 우선순위 보기 →
        </Link>
      </div>
    </section>
  );
}
