"use client";

import { useState } from "react";
import {
  COSMETICS_OWNERSHIP_SOURCE,
  COSMETICS_PROSPECTS,
  prospectDraft,
} from "@/lib/ax-mail/cosmetics-prospects";
import { DraftComposer } from "./draft-composer";

interface Labels {
  body: string;
  campaignDescription: string;
  campaignTitle: string;
  company: string;
  connectToSave: string;
  contactRoute: string;
  contactSource: string;
  domesticMarket: string;
  draftId: string;
  draftPreview: string;
  failed: string;
  globalMarket: string;
  ownershipSource: string;
  recipient: string;
  reviewRequired: string;
  salesHypothesis: string;
  saveDraft: string;
  saved: string;
  saving: string;
  source: string;
  subject: string;
  verifiedFact: string;
}

export function CosmeticsWorkbench({
  connected,
  labels,
}: {
  connected: boolean;
  labels: Labels;
}) {
  const [selectedId, setSelectedId] = useState(COSMETICS_PROSPECTS[0].id);
  const selected =
    COSMETICS_PROSPECTS.find((prospect) => prospect.id === selectedId) ??
    COSMETICS_PROSPECTS[0];

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 font-medium text-emerald-400 text-xs uppercase tracking-[0.18em]">
            BEAUTY / PIPELINE 01
          </p>
          <h2 className="font-semibold text-2xl tracking-tight">
            {labels.campaignTitle}
          </h2>
          <p className="mt-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            {labels.campaignDescription}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(230px,0.8fr)_minmax(0,1.2fr)]">
        <div className="overflow-hidden rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)]">
          {COSMETICS_PROSPECTS.map((prospect, index) => (
            <button
              aria-pressed={prospect.id === selected.id}
              className={`flex w-full items-center justify-between border-[color:var(--findable-hairline,#23252a)] border-b px-4 py-4 text-left transition last:border-b-0 hover:bg-white/5 ${prospect.id === selected.id ? "bg-emerald-400/10" : ""}`}
              key={prospect.id}
              onClick={() => setSelectedId(prospect.id)}
              type="button"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="w-5 shrink-0 font-mono text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-sm">
                    {prospect.brand}
                  </span>
                  <span className="block truncate text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                    {prospect.company}
                  </span>
                </span>
              </span>
              <span className="ml-2 shrink-0 rounded-full border border-white/10 px-2 py-1 text-[10px] text-[color:var(--findable-ink-subtle,#8a8f98)]">
                {prospect.market === "global"
                  ? labels.globalMarket
                  : labels.domesticMarket}
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-5 rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-5 md:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-xl tracking-tight">
                {selected.brand}
              </h3>
              <p className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
                {labels.company} · {selected.company}
              </p>
            </div>
            <a
              className="shrink-0 text-emerald-300 text-xs underline-offset-4 hover:underline"
              href={selected.website}
              rel="noopener noreferrer"
              target="_blank"
            >
              {labels.source} ↗
            </a>
          </div>

          {selected.parentGroup && (
            <div className="rounded-lg border border-amber-700/40 bg-amber-950/25 px-3 py-2 text-amber-200 text-xs leading-5">
              {selected.parentGroup} ·{" "}
              <a
                className="underline underline-offset-4"
                href={COSMETICS_OWNERSHIP_SOURCE}
                rel="noopener noreferrer"
                target="_blank"
              >
                {labels.ownershipSource}
              </a>
            </div>
          )}

          <dl className="space-y-5 text-sm">
            <div>
              <dt className="mb-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                {labels.contactRoute}
              </dt>
              <dd className="break-all font-medium">{selected.contactEmail}</dd>
              <dd className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                {selected.contactRole} ·{" "}
                <a
                  className="underline underline-offset-4 hover:text-emerald-300"
                  href={selected.contactSource}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {labels.contactSource}
                </a>
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                {labels.verifiedFact}
              </dt>
              <dd className="leading-6">
                {selected.fact} ·{" "}
                <a
                  className="text-emerald-300 underline underline-offset-4"
                  href={selected.factSource}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {labels.source}
                </a>
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                {labels.salesHypothesis}
              </dt>
              <dd className="leading-6">{selected.opportunity}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="font-semibold text-lg">{labels.draftPreview}</h3>
          <p className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs leading-5">
            {labels.reviewRequired}
          </p>
        </div>
        <DraftComposer
          connected={connected}
          initialDraft={prospectDraft(selected)}
          key={selected.id}
          labels={labels}
        />
      </div>
    </section>
  );
}
