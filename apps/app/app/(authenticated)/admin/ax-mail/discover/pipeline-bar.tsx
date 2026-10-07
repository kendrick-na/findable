import Link from "next/link";
import {
  type DiscoverParams,
  discoverHref,
  PIPELINE_GROUPS,
  type PipelineGroupId,
} from "@/lib/ax-mail/discovery/view";
import type { AppDictionary } from "@/lib/i18n";

/** 화면 아래 영업 파이프라인 — 칸을 누르면 표가 그 단계 회사로 걸러진다(다시 누르면 해제). */
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
    <section className="rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-sm">{labels.pipelineTitle}</h2>
        {params.stage && (
          <Link
            className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs underline underline-offset-2"
            href={allHref}
            scroll={false}
          >
            {labels.pipelineAll}
          </Link>
        )}
      </div>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {PIPELINE_GROUPS.map((group, index) => {
          const active = params.stage === group.id;
          return (
            <li key={group.id}>
              <Link
                aria-pressed={active}
                className={`flex h-full flex-col gap-1 rounded-lg border px-3 py-2.5 transition ${
                  active
                    ? "border-emerald-400 bg-emerald-400/10"
                    : "border-[color:var(--findable-hairline,#23252a)] hover:border-emerald-400/60"
                }`}
                href={discoverHref(params, {
                  stage: active ? null : group.id,
                })}
                scroll={false}
              >
                <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                  {index + 1}. {labels.pipeline[group.id]}
                </span>
                <span className="font-semibold text-xl tabular-nums">
                  {counts[group.id].toLocaleString()}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
