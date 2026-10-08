import Link from "next/link";
import {
  type DiscoverParams,
  discoverHref,
  PIPELINE_GROUPS,
  type PipelineGroupId,
} from "@/lib/ax-mail/discovery/view";
import type { AppDictionary } from "@/lib/i18n";

/**
 * 영업 파이프라인 — 화면 맨 위 요약 한 줄(2026-10-08 대표 승인).
 * 숫자는 지금 걸린 조건(저장한 조건 + 칩) 기준이고, 칸을 누르면 표가 그 단계로 걸러진다(다시 누르면 해제).
 */
export function PipelineBar({
  allHref,
  counts,
  labels,
  params,
}: {
  allHref: string;
  counts: Record<PipelineGroupId, number>;
  labels: AppDictionary["salesDiscover"];
  params: DiscoverParams;
}) {
  return (
    <nav
      aria-label={labels.pipelineTitle}
      className="flex flex-wrap items-center gap-x-1 gap-y-1.5 rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] px-4 py-2.5 text-sm"
      data-testid="pipeline-bar"
    >
      <span className="mr-2 font-semibold">{labels.pipelineTitle}</span>
      <span className="mr-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
        {labels.pipelineScope}
      </span>
      {PIPELINE_GROUPS.map((group, index) => {
        const active = params.stage === group.id;
        return (
          <span className="inline-flex items-center gap-1" key={group.id}>
            {index > 0 && (
              <span
                aria-hidden="true"
                className="text-[color:var(--findable-ink-subtle,#8a8f98)]"
              >
                →
              </span>
            )}
            <Link
              aria-current={active ? "true" : undefined}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 transition ${
                active
                  ? "bg-emerald-400/10 text-emerald-200"
                  : "hover:bg-white/[0.04]"
              }`}
              href={discoverHref(params, {
                stage: active ? null : group.id,
              })}
              scroll={false}
            >
              <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                {labels.pipeline[group.id]}
              </span>
              <span className="font-semibold tabular-nums">
                {counts[group.id].toLocaleString()}
              </span>
            </Link>
          </span>
        );
      })}
      {params.stage && (
        <Link
          className="ml-auto text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs underline underline-offset-2"
          href={allHref}
          scroll={false}
        >
          {labels.pipelineAll}
        </Link>
      )}
    </nav>
  );
}
