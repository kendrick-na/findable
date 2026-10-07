import Link from "next/link";
import { SUB_INDUSTRIES } from "@/lib/ax-mail/discovery/sub-industry";
import {
  INDUSTRIES,
  REGIONS,
  SIZE_BUCKETS,
} from "@/lib/ax-mail/discovery/taxonomy";
import {
  CLEAR_CHIPS,
  DISCOVER_TAGS,
  type DiscoverParams,
  discoverHref,
  hasChips,
  toggle,
} from "@/lib/ax-mail/discovery/view";
import type { AppDictionary } from "@/lib/i18n";
import { CollapsibleRow } from "./collapsible-row";

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
      aria-current={active ? "true" : undefined}
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

function RowLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="w-16 shrink-0 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
      {children}
    </span>
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
      <RowLabel>{label}</RowLabel>
      {children}
    </div>
  );
}

/**
 * 칩 줄(2026-10-08 대표 승인 정리): 업종(+세부 분야 펼치기) · 태그 · 지역 · 직원 수 · 조건 = 5줄.
 *   - 세부 분야 21개는 접어 두고 「세부 분야 21개 펼치기」로 연다(고른 칩이 있으면 펼친 채).
 *   - 「커머스」는 태그에서 빼고 세부 분야 「커머스·온라인 판매」 하나로 합쳤다.
 *   - 성장 중·사이트 있음·메일 있음은 「조건」 줄로 따로 뺐다.
 */
export function FilterBar({
  labels,
  params,
  total,
}: {
  labels: Labels;
  params: DiscoverParams;
  total: number;
}) {
  return (
    <section
      className="space-y-2 rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-4"
      data-testid="filter-bar"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <CollapsibleRow
            closeLabel={labels.subToggleClose}
            defaultOpen={params.subs.length > 0}
            header={
              <>
                <RowLabel>{labels.filterIndustry}</RowLabel>
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
              </>
            }
            openLabel={labels.subToggleOpen.replace(
              "{count}",
              String(SUB_INDUSTRIES.length)
            )}
          >
            <Row label={labels.filterSub}>
              {SUB_INDUSTRIES.map((sub) => (
                <Chip
                  active={params.subs.includes(sub)}
                  href={discoverHref(params, {
                    subs: toggle(params.subs, sub),
                  })}
                  key={sub}
                >
                  {labels.subIndustries[sub]}
                </Chip>
              ))}
            </Row>
          </CollapsibleRow>
        </div>
        <p
          className="shrink-0 font-semibold text-lg tabular-nums"
          data-testid="result-count"
        >
          {labels.resultCount.replace("{count}", total.toLocaleString())}
        </p>
      </div>
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
      </Row>
      <Row label={labels.filterConditions}>
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
        {hasChips(params) ? (
          <Link
            className="ml-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs underline underline-offset-2"
            href={discoverHref(params, CLEAR_CHIPS)}
            scroll={false}
          >
            {labels.filterClear}
          </Link>
        ) : null}
      </Row>
    </section>
  );
}
