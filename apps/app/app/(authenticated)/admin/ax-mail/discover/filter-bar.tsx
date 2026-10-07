import Link from "next/link";
import { SUB_INDUSTRIES } from "@/lib/ax-mail/discovery/sub-industry";
import {
  INDUSTRIES,
  REGIONS,
  SIZE_BUCKETS,
} from "@/lib/ax-mail/discovery/taxonomy";
import {
  DISCOVER_TAGS,
  type DiscoverParams,
  discoverHref,
  toggle,
} from "@/lib/ax-mail/discovery/view";
import type { AppDictionary } from "@/lib/i18n";

type Labels = AppDictionary["salesDiscover"];

/** 칩 = 링크(서버 컴포넌트). 누르면 URL 이 바뀌고 서버가 다시 거른다. */
export function Chip({
  active,
  href,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
  href: string;
}) {
  return (
    <Link
      aria-pressed={active}
      className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-3 text-sm transition ${
        active
          ? "border-emerald-400 bg-emerald-400/10 text-emerald-200"
          : "border-[color:var(--findable-hairline,#23252a)] text-[color:var(--findable-ink-subtle,#8a8f98)] hover:text-[color:var(--findable-ink,#f7f8f8)]"
      }`}
      href={href}
      scroll={false}
    >
      {children}
    </Link>
  );
}

function Row({
  label,
  children,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-16 shrink-0 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
        {label}
      </span>
      {children}
    </div>
  );
}

export function FilterBar({
  labels,
  params,
  total,
}: {
  labels: Labels;
  params: DiscoverParams;
  total: number;
}) {
  const anyChip =
    params.industries.length ||
    params.subs.length ||
    params.tags.length ||
    params.regions.length ||
    params.sizes.length ||
    params.growing ||
    params.hasSite ||
    params.hasMail;
  return (
    <section className="space-y-2 rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Row label={labels.filterIndustry}>
          {INDUSTRIES.map((ind) => (
            <Chip
              active={params.industries.includes(ind)}
              href={discoverHref(params, {
                industries: toggle(params.industries, ind),
              })}
              key={ind}
            >
              {labels.industries[ind]}
            </Chip>
          ))}
        </Row>
        <p
          className="ml-auto font-semibold text-lg tabular-nums"
          data-testid="result-count"
        >
          {labels.resultCount.replace("{count}", total.toLocaleString())}
        </p>
      </div>
      <Row label={labels.filterSub}>
        {SUB_INDUSTRIES.map((sub) => (
          <Chip
            active={params.subs.includes(sub)}
            href={discoverHref(params, { subs: toggle(params.subs, sub) })}
            key={sub}
          >
            {labels.subIndustries[sub]}
          </Chip>
        ))}
      </Row>
      <Row label={labels.filterTag}>
        {DISCOVER_TAGS.map((tag) => (
          <Chip
            active={params.tags.includes(tag)}
            href={discoverHref(params, { tags: toggle(params.tags, tag) })}
            key={tag}
          >
            {labels.tags[tag]}
          </Chip>
        ))}
      </Row>
      <Row label={labels.filterRegion}>
        {REGIONS.map((region) => (
          <Chip
            active={params.regions.includes(region)}
            href={discoverHref(params, {
              regions: toggle(params.regions, region),
            })}
            key={region}
          >
            {region}
          </Chip>
        ))}
      </Row>
      <Row label={labels.filterSize}>
        {SIZE_BUCKETS.map((size) => (
          <Chip
            active={params.sizes.includes(size)}
            href={discoverHref(params, { sizes: toggle(params.sizes, size) })}
            key={size}
          >
            {labels.sizeLabel.replace("{range}", size.replace("-", "~"))}
          </Chip>
        ))}
        <span className="mx-1 h-5 w-px bg-[color:var(--findable-hairline,#23252a)]" />
        <Chip
          active={params.growing}
          href={discoverHref(params, { growing: !params.growing })}
        >
          {labels.filterGrowing}
        </Chip>
        <Chip
          active={params.hasSite}
          href={discoverHref(params, { hasSite: !params.hasSite })}
        >
          {labels.filterHasSite}
        </Chip>
        <Chip
          active={params.hasMail}
          href={discoverHref(params, { hasMail: !params.hasMail })}
        >
          {labels.filterHasMail}
        </Chip>
        {anyChip ? (
          <Link
            className="ml-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs underline underline-offset-2"
            href={discoverHref(params, {
              growing: false,
              hasMail: false,
              hasSite: false,
              industries: [],
              regions: [],
              sizes: [],
              subs: [],
              tags: [],
            })}
            scroll={false}
          >
            {labels.filterClear}
          </Link>
        ) : null}
      </Row>
    </section>
  );
}
