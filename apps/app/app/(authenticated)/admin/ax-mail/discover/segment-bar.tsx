"use client";

import { Button } from "@repo/design-system/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveSegment } from "@/app/actions/admin/sales-discovery";
import type { SegmentFilter } from "@/lib/ax-mail/discovery/segment-query";
import {
  CLEAR_CHIPS,
  type DiscoverParams,
  discoverHref,
  filterFromParams,
  isEmptyFilter,
} from "@/lib/ax-mail/discovery/view";
import type { AppDictionary } from "@/lib/i18n";

type Labels = AppDictionary["salesDiscover"];

export interface SegmentChipView {
  companyCount: number | null;
  filter: unknown;
  href: string;
  id: string;
  name: string;
}

const chipClass = (active: boolean) =>
  `inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition ${
    active
      ? "border-emerald-400 bg-emerald-400/10 text-emerald-200"
      : "border-[color:var(--findable-hairline,#23252a)] text-[color:var(--findable-ink-subtle,#8a8f98)] hover:text-[color:var(--findable-ink,#f7f8f8)]"
  }`;

function asFilter(value: unknown): SegmentFilter | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as SegmentFilter)
    : null;
}

/**
 * 위 줄 — 저장한 조건(세그먼트) 칩 + 「새 조건」/「조건 수정」.
 * 2026-10-08 대표 승인: 창에서는 **이름만** 받는다. 조건은 지금 고른 칩(+열려 있는 저장 조건)으로 자동 저장.
 *   JSON 입력·고급 편집은 없다. 저장할 조건은 사람 말 요약(conditionSummary)으로만 보여 준다.
 */
export function SegmentBar({
  activeId,
  allHref,
  conditionSummary,
  currentFilter,
  labels,
  params,
  segments,
}: {
  activeId: string | null;
  allHref: string;
  /** 사람이 읽는 조건 요약 줄들(서버가 사전 라벨로 만든다) */
  conditionSummary: string[];
  currentFilter: unknown;
  labels: Labels;
  params: DiscoverParams;
  segments: SegmentChipView[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const active = segments.find((s) => s.id === activeId) ?? null;
  const filter = filterFromParams(params, asFilter(currentFilter));
  const empty = isEmptyFilter(filter);

  const openDialog = (segment: SegmentChipView | null) => {
    setEditId(segment?.id ?? null);
    setName(segment?.name ?? "");
    setError(null);
    setOpen(true);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (empty) {
      setError(labels.errors.empty_filter);
      return;
    }
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof saveSegment>>;
      try {
        result = await saveSegment({
          filter,
          id: editId ?? undefined,
          name,
        });
      } catch {
        setError(labels.errors.unexpected);
        return;
      }
      if (!result.ok) {
        setError(labels.errors[result.error]);
        return;
      }
      setOpen(false);
      // 저장한 조건을 연다 — 칩은 저장한 조건 안에 들어갔으므로 비운다.
      router.push(
        discoverHref({ ...params, ...CLEAR_CHIPS }, { segmentId: result.id })
      );
      router.refresh();
    });
  };

  return (
    <section className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
        {labels.segments}
      </span>
      <Link
        aria-current={activeId ? undefined : "true"}
        className={chipClass(!activeId)}
        href={allHref}
        scroll={false}
      >
        {labels.segmentAll}
      </Link>
      {segments.map((s) => (
        <Link
          aria-current={s.id === activeId ? "true" : undefined}
          className={chipClass(s.id === activeId)}
          href={s.href}
          key={s.id}
          scroll={false}
        >
          {s.name}
          {s.companyCount === null ? null : (
            <span className="tabular-nums opacity-60">
              {s.companyCount.toLocaleString()}
            </span>
          )}
        </Link>
      ))}
      <Button
        onClick={() => openDialog(null)}
        size="sm"
        type="button"
        variant="outline"
      >
        + {labels.segmentNew}
      </Button>
      {active && (
        <Button
          onClick={() => openDialog(active)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {labels.segmentEdit}
        </Button>
      )}

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="sm:max-w-md">
          <form
            className="space-y-4"
            data-testid="segment-dialog"
            onSubmit={submit}
          >
            <DialogHeader>
              <DialogTitle>
                {editId ? labels.segmentEdit : labels.segmentNew}
              </DialogTitle>
              <DialogDescription>{labels.segmentNameHelp}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="segment-name">{labels.segmentName}</Label>
              <Input
                autoFocus
                id="segment-name"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </div>
            <div className="space-y-1">
              <p className="font-medium text-sm">{labels.segmentSummary}</p>
              {empty ? (
                <p className="text-amber-300 text-sm">
                  {labels.segmentSummaryEmpty}
                </p>
              ) : (
                <ul
                  className="space-y-0.5 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm"
                  data-testid="segment-summary"
                >
                  {conditionSummary.map((line) => (
                    <li key={line}>· {line}</li>
                  ))}
                </ul>
              )}
            </div>
            {error && (
              <p className="text-amber-300 text-sm" role="alert">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                onClick={() => setOpen(false)}
                type="button"
                variant="ghost"
              >
                {labels.segmentCancel}
              </Button>
              <Button disabled={pending || !name.trim() || empty} type="submit">
                {labels.segmentSave}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
