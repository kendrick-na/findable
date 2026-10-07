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
import { Textarea } from "@repo/design-system/components/ui/textarea";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveSegment } from "@/app/actions/admin/sales-discovery";
import type { SegmentFilter } from "@/lib/ax-mail/discovery/segment-query";
import {
  type DiscoverParams,
  discoverHref,
  filterFromParams,
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

/** 위 줄 — 저장한 조건(세그먼트) 칩 + 「새 조건」(이름 + 필터 JSON 저장/수정). */
export function SegmentBar({
  activeId,
  allHref,
  currentFilter,
  labels,
  params,
  segments,
}: {
  activeId: string | null;
  allHref: string;
  currentFilter: unknown;
  labels: Labels;
  params: DiscoverParams;
  segments: SegmentChipView[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [json, setJson] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const active = segments.find((s) => s.id === activeId) ?? null;

  const openNew = () => {
    setEditId(null);
    setName("");
    setJson(
      JSON.stringify(filterFromParams(params, asFilter(currentFilter)), null, 2)
    );
    setError(null);
    setOpen(true);
  };
  const openEdit = () => {
    if (!active) {
      return;
    }
    setEditId(active.id);
    setName(active.name);
    setJson(JSON.stringify(active.filter ?? {}, null, 2));
    setError(null);
    setOpen(true);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let filter: unknown;
    try {
      filter = JSON.parse(json);
    } catch {
      setError(labels.segmentInvalidJson);
      return;
    }
    startTransition(async () => {
      const result = await saveSegment({
        filter,
        id: editId ?? undefined,
        name,
      });
      if (!result.ok) {
        setError(
          result.error === "invalid"
            ? labels.segmentInvalidJson
            : labels.errors[result.error]
        );
        return;
      }
      setOpen(false);
      // 새로 만든 조건은 바로 연다(칩은 지우고 저장한 조건만).
      router.push(
        editId
          ? discoverHref(params, {})
          : discoverHref(
              {
                ...params,
                growing: false,
                hasMail: false,
                hasSite: false,
                industries: [],
                regions: [],
                sizes: [],
                tags: [],
              },
              { segmentId: result.id }
            )
      );
      router.refresh();
    });
  };

  return (
    <section className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
        {labels.segments}
      </span>
      <Link className={chipClass(!activeId)} href={allHref} scroll={false}>
        {labels.segmentAll}
      </Link>
      {segments.map((s) => (
        <Link
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
      <Button onClick={openNew} size="sm" type="button" variant="outline">
        + {labels.segmentNew}
      </Button>
      {active && (
        <Button onClick={openEdit} size="sm" type="button" variant="ghost">
          {labels.segmentEdit}
        </Button>
      )}

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="sm:max-w-lg">
          <form className="space-y-4" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>
                {editId ? labels.segmentEdit : labels.segmentNew}
              </DialogTitle>
              <DialogDescription>{labels.segmentFilterHelp}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="segment-name">{labels.segmentName}</Label>
              <Input
                id="segment-name"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="segment-filter">{labels.segmentFilter}</Label>
              <Textarea
                className="min-h-48 font-mono text-xs"
                id="segment-filter"
                onChange={(event) => setJson(event.target.value)}
                value={json}
              />
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
              <Button disabled={pending || !name.trim()} type="submit">
                {labels.segmentSave}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
