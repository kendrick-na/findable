"use client";

import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import { Checkbox } from "@repo/design-system/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addCompaniesToSalesList } from "@/app/actions/admin/sales-discovery";
import type { CompanyRow } from "@/lib/ax-mail/discovery/screen";
import { DISCOVER_TAGS, type DiscoverSort } from "@/lib/ax-mail/discovery/view";
import type { AppDictionary } from "@/lib/i18n";
import { ExternalLink } from "./external-link";
import { MeasureButton } from "./measure-button";

type Labels = AppDictionary["salesDiscover"];

export type TableRowView = CompanyRow & { href: string };

const SORT_LABEL: Record<DiscoverSort, keyof Labels> = {
  employees: "sortEmployees",
  growth: "sortGrowth",
  recent: "sortRecent",
};

const subtle = "text-[color:var(--findable-ink-subtle,#8a8f98)]";

function growthClass(g: number): string {
  if (g > 0) {
    return "text-emerald-300";
  }
  return g < 0 ? "text-amber-300" : subtle;
}

function lookup(map: Record<string, string>, key: string | null): string {
  return key ? (map[key] ?? key) : "—";
}

/** 직원(증감) — 국민연금 비교 구간 변화율. 모르면 쓰지 않는다. */
function Employees({ row }: { row: CompanyRow }) {
  if (row.employeeCount === null) {
    return <span className={subtle}>—</span>;
  }
  const g = row.employeeGrowth;
  return (
    <span className="tabular-nums">
      {row.employeeCount.toLocaleString()}
      {g !== null && (
        <span className={`ml-1.5 text-xs ${growthClass(g)}`}>
          {g > 0 ? "+" : ""}
          {(g * 100).toFixed(1)}%
        </span>
      )}
    </span>
  );
}

export function CompanyTable({
  filtered,
  labels,
  nextHref,
  page,
  pages,
  prevHref,
  rows,
  segmentId,
  selectedId,
  sort,
  sortLinks,
}: {
  /** 조건(세그먼트·칩·단계)이 걸려 있나 — 0곳일 때 「적재 전」과 「조건에 맞는 곳 없음」을 가른다 */
  filtered: boolean;
  labels: Labels;
  nextHref: string | null;
  page: number;
  pages: number;
  prevHref: string | null;
  rows: TableRowView[];
  segmentId: string | null;
  selectedId: string | null;
  sort: DiscoverSort;
  sortLinks: { href: string; sort: DiscoverSort }[];
}) {
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.id));
  const tagSet = new Set<string>(DISCOVER_TAGS);

  const toggleRow = (id: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });

  const addSelected = () =>
    startTransition(async () => {
      const result = await addCompaniesToSalesList({
        companyIds: [...checked],
        segmentId,
      });
      if (result.ok) {
        setNotice(labels.addedCount.replace("{count}", String(result.added)));
        setChecked(new Set());
        router.refresh();
      } else {
        setNotice(labels.errors[result.error]);
      }
    });

  return (
    <section className="overflow-hidden rounded-xl border border-[color:var(--findable-hairline,#23252a)]">
      <div className="flex flex-wrap items-center gap-3 border-[color:var(--findable-hairline,#23252a)] border-b px-4 py-2.5">
        <Button
          disabled={checked.size === 0 || pending}
          onClick={addSelected}
          size="sm"
          type="button"
        >
          {labels.addSelected}
          {checked.size > 0 && (
            <span className="tabular-nums">({checked.size})</span>
          )}
        </Button>
        {notice && (
          <output className={`text-xs ${subtle}`} data-testid="bulk-notice">
            {notice}
          </output>
        )}
        <span className={`ml-auto text-xs ${subtle}`}>{labels.sort}</span>
        {sortLinks.map((s) => (
          <Link
            aria-pressed={s.sort === sort}
            className={`text-xs underline-offset-2 hover:underline ${
              s.sort === sort ? "text-emerald-300" : subtle
            }`}
            href={s.href}
            key={s.sort}
            scroll={false}
          >
            {labels[SORT_LABEL[s.sort]] as string}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className={`p-5 text-sm ${subtle}`}>
          {filtered ? labels.empty : labels.emptyNoData}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-4">
                <Checkbox
                  aria-label={labels.selectAll}
                  checked={allChecked}
                  onCheckedChange={(on) =>
                    setChecked(on ? new Set(rows.map((r) => r.id)) : new Set())
                  }
                />
              </TableHead>
              <TableHead>{labels.colCompany}</TableHead>
              <TableHead>{labels.colIndustry}</TableHead>
              <TableHead className="text-right">
                {labels.colEmployees}
              </TableHead>
              <TableHead>{labels.colStage}</TableHead>
              <TableHead className="pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const active = row.id === selectedId;
              return (
                <TableRow
                  className={`cursor-pointer ${active ? "bg-white/[0.04]" : ""}`}
                  data-state={active ? "selected" : undefined}
                  key={row.id}
                  onClick={() => router.push(row.href, { scroll: false })}
                >
                  <TableCell
                    className="pl-4"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Checkbox
                      aria-label={`${labels.selectRow} ${row.legalName}`}
                      checked={checked.has(row.id)}
                      onCheckedChange={(on) => toggleRow(row.id, on === true)}
                    />
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-normal">
                    <Link
                      className="font-medium hover:underline"
                      href={row.href}
                      onClick={(event) => event.stopPropagation()}
                      scroll={false}
                    >
                      {row.legalName}
                    </Link>
                    <span className={`block text-xs ${subtle}`}>
                      {row.domain ? (
                        <ExternalLink href={row.domain}>
                          {row.domain}
                        </ExternalLink>
                      ) : (
                        "—"
                      )}
                      {row.region ? ` · ${row.region}` : ""}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {row.sources.map((s) => (
                        <Badge key={`s-${s}`} variant="outline">
                          {lookup(labels.sourceShort, s)}
                        </Badge>
                      ))}
                      {row.tags
                        .filter((t) => tagSet.has(t))
                        .map((t) => (
                          <Badge key={`t-${t}`} variant="secondary">
                            {lookup(labels.tags, t)}
                          </Badge>
                        ))}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-56 whitespace-normal">
                    {lookup(labels.industries, row.industry)}
                    {row.industrySource && (
                      <span className={`block text-xs ${subtle}`}>
                        {lookup(labels.industryBasis, row.industrySource)}
                      </span>
                    )}
                    {row.subs.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {row.subs.map((sub) => (
                          <Badge key={sub} variant="outline">
                            {labels.subIndustries[sub]}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Employees row={row} />
                  </TableCell>
                  <TableCell>
                    {row.status ? (
                      <Badge variant="outline">
                        {lookup(labels.stages, row.status)}
                      </Badge>
                    ) : (
                      <span className={subtle}>—</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <MeasureButton
                      companyId={row.id}
                      disabled={!row.domain}
                      labels={labels}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <div className="flex items-center justify-end gap-3 border-[color:var(--findable-hairline,#23252a)] border-t px-4 py-2.5 text-sm">
        {prevHref ? (
          <Link className="hover:underline" href={prevHref} scroll={false}>
            {labels.prev}
          </Link>
        ) : (
          <span className={subtle}>{labels.prev}</span>
        )}
        <span className={`tabular-nums ${subtle}`}>
          {labels.pageOf
            .replace("{page}", String(page))
            .replace("{pages}", String(pages))}
        </span>
        {nextHref ? (
          <Link className="hover:underline" href={nextHref} scroll={false}>
            {labels.next}
          </Link>
        ) : (
          <span className={subtle}>{labels.next}</span>
        )}
      </div>
    </section>
  );
}
