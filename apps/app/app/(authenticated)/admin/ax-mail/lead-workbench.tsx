"use client";

import { useMemo, useState } from "react";
import type {
  Blocker,
  Lead,
  LeadIndustry,
  LeadReadiness,
} from "@/lib/ax-mail/leads";
import { DraftComposer, type DraftComposerLabels } from "./draft-composer";

export type SenderState =
  | { kind: "not_configured" }
  | { kind: "not_connected" }
  | { kind: "token_expired"; account: string }
  | { kind: "alias_missing"; account: string }
  | { kind: "ok"; account: string; smtpHost: string | null };

export interface WorkbenchLead {
  draft: { body: string; recipient: string; subject: string } | null;
  drafted: boolean;
  lead: Lead;
  readiness: LeadReadiness;
}

type Labels = DraftComposerLabels & {
  answers: string;
  blockerInbound: string;
  blockerJudgesDisagree: string;
  blockerNoContact: string;
  blockerNoContactBasis: string;
  blockerNoDate: string;
  blockerNoObservation: string;
  blockerNoReport: string;
  blockerNotMeasured: string;
  citedDenominator: string;
  connect: string;
  connectFailed: string;
  connectedAccount: string;
  contact: string;
  contactSource: string;
  description: string;
  empty: string;
  engines: string;
  independentCorrect: string;
  industryAll: string;
  industryB2b: string;
  industryBeauty: string;
  industryExisting: string;
  industryFinance: string;
  industryPartner: string;
  legalBody: string;
  legalTitle: string;
  measuredOn: string;
  noneSelected: string;
  observationCitation: string;
  observationRecognition: string;
  observationUsed: string;
  officialCited: string;
  onlyReady: string;
  productConfirmed: string;
  reconnect: string;
  reportLink: string;
  reportNone: string;
  senderAliasMissing: string;
  senderNotConfigured: string;
  senderNotConnected: string;
  senderOk: string;
  senderOtherSmtp: string;
  senderTitle: string;
  senderTokenExpired: string;
  senderViaGmail: string;
  senderViaSmtp: string;
  statusBlocked: string;
  statusDrafted: string;
  statusInbound: string;
  statusNeedsBasis: string;
  statusReady: string;
  title: string;
};

const INDUSTRIES: readonly (LeadIndustry | "all")[] = [
  "all",
  "beauty",
  "existing",
  "b2b",
  "finance",
  "partner",
];

function industryLabel(labels: Labels, value: LeadIndustry | "all"): string {
  const map: Record<LeadIndustry | "all", string> = {
    all: labels.industryAll,
    beauty: labels.industryBeauty,
    b2b: labels.industryB2b,
    existing: labels.industryExisting,
    finance: labels.industryFinance,
    partner: labels.industryPartner,
  };
  return map[value];
}

function blockerLabel(labels: Labels, blocker: Blocker): string {
  const map: Record<Blocker, string> = {
    inbound: labels.blockerInbound,
    not_measured: labels.blockerNotMeasured,
    no_date: labels.blockerNoDate,
    no_observation: labels.blockerNoObservation,
    judges_disagree: labels.blockerJudgesDisagree,
    no_contact: labels.blockerNoContact,
    no_report: labels.blockerNoReport,
    no_contact_basis: labels.blockerNoContactBasis,
  };
  return map[blocker];
}

/** SPF(v=spf1 include:spf.improvmx.com) 기준 — 2026-09-29 DNS 실측. */
function smtpVerdict(host: string | null): "improvmx" | "gmail" | "other" {
  if (!host) {
    return "gmail";
  }
  return host.toLowerCase().includes("improvmx") ? "improvmx" : "other";
}

function StatusBadge({
  item,
  labels,
}: {
  item: WorkbenchLead;
  labels: Labels;
}) {
  if (item.lead.track === "inbound") {
    return (
      <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-400">
        {labels.statusInbound}
      </span>
    );
  }
  if (item.drafted) {
    return (
      <span className="rounded border border-sky-800 bg-sky-950/40 px-1.5 py-0.5 text-[11px] text-sky-300">
        {labels.statusDrafted}
      </span>
    );
  }
  if (item.readiness.ready) {
    return (
      <span className="rounded border border-emerald-800 bg-emerald-950/40 px-1.5 py-0.5 text-[11px] text-emerald-300">
        {labels.statusReady}
      </span>
    );
  }
  // 문안은 준비됐고 수신 근거만 남았다 — 작성기에서 입력하면 저장할 수 있다.
  return item.readiness.composable ? (
    <span className="rounded border border-emerald-900 px-1.5 py-0.5 text-[11px] text-emerald-200/80">
      {labels.statusNeedsBasis}
    </span>
  ) : (
    <span className="rounded border border-amber-900 bg-amber-950/30 px-1.5 py-0.5 text-[11px] text-amber-300">
      {labels.statusBlocked}
    </span>
  );
}

function SenderPanel({
  labels,
  sender,
  senderEmail,
  connectFailed,
}: {
  connectFailed: boolean;
  labels: Labels;
  sender: SenderState;
  senderEmail: string;
}) {
  const canConnect = sender.kind !== "not_configured";
  const account = "account" in sender ? sender.account : null;
  let message: { tone: "ok" | "warn"; text: string };
  switch (sender.kind) {
    case "not_configured":
      message = { tone: "warn", text: labels.senderNotConfigured };
      break;
    case "not_connected":
      message = { tone: "warn", text: labels.senderNotConnected };
      break;
    case "token_expired":
      message = { tone: "warn", text: labels.senderTokenExpired };
      break;
    case "alias_missing":
      message = {
        tone: "warn",
        text: `${labels.senderAliasMissing} ${senderEmail}`,
      };
      break;
    default:
      message = { tone: "ok", text: `${labels.senderOk}: ${senderEmail}` };
  }
  const verdict = sender.kind === "ok" ? smtpVerdict(sender.smtpHost) : null;

  return (
    <section className="rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5 text-sm">
          <p className="font-semibold">{labels.senderTitle}</p>
          <p
            className={
              message.tone === "ok" ? "text-emerald-300" : "text-amber-300"
            }
          >
            {message.text}
          </p>
          {account && (
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
              {labels.connectedAccount}: {account}
            </p>
          )}
          {sender.kind === "ok" && verdict && (
            <p
              className={`text-xs ${verdict === "improvmx" ? "text-[color:var(--findable-ink-subtle,#8a8f98)]" : "text-amber-300"}`}
            >
              {verdict === "gmail"
                ? labels.senderViaGmail
                : `${labels.senderViaSmtp}: ${sender.smtpHost}${verdict === "other" ? ` — ${labels.senderOtherSmtp}` : ""}`}
            </p>
          )}
        </div>
        {canConnect && (
          <a
            className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-md border border-[color:var(--findable-hairline,#23252a)] px-3 font-medium text-sm transition hover:border-emerald-400 hover:text-emerald-300"
            href="/api/ax-mail/google/connect"
          >
            {sender.kind === "not_connected"
              ? labels.connect
              : labels.reconnect}
          </a>
        )}
      </div>
      {connectFailed && (
        <p
          className="mt-3 rounded-md border border-amber-800/60 bg-amber-950/30 p-2.5 text-amber-300 text-sm"
          role="alert"
        >
          {labels.connectFailed}
        </p>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
        {label}
      </dt>
      <dd className="font-medium text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function LeadDetail({
  item,
  labels,
  canSave,
}: {
  canSave: boolean;
  item: WorkbenchLead;
  labels: Labels;
}) {
  const { lead, readiness, draft } = item;
  const m = lead.measurement;
  const o = readiness.observation;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="font-semibold text-lg">{lead.brand}</h2>
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
              {lead.company} · {lead.segment} ·{" "}
              <a
                className="underline-offset-2 hover:underline"
                href={`https://${lead.domain}`}
                rel="noopener noreferrer"
                target="_blank"
              >
                {lead.domain}
              </a>
            </p>
          </div>
          <StatusBadge item={item} labels={labels} />
        </div>

        {m && (
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label={labels.measuredOn} value={m.measuredOn ?? "—"} />
            <Fact
              label={labels.answers}
              value={`${m.answers} · ${m.engines.join("·")}`}
            />
            <Fact
              label={labels.productConfirmed}
              value={`${m.productConfirmed} / ${m.answers}`}
            />
            <Fact
              label={labels.independentCorrect}
              value={
                m.hook?.independentCorrect == null
                  ? "—"
                  : `${m.hook.independentCorrect} / ${m.answers}`
              }
            />
            <Fact
              label={labels.officialCited}
              value={`${m.officialCited} / ${m.answersWithCitations} (${labels.citedDenominator})`}
            />
          </dl>
        )}

        {readiness.blockers.length > 0 && (
          <ul className="mt-4 space-y-1">
            {readiness.blockers.map((b) => (
              <li className="text-amber-300 text-sm" key={b}>
                · {blockerLabel(labels, b)}
              </li>
            ))}
          </ul>
        )}

        {o && (
          <div className="mt-4 rounded-md border border-[color:var(--findable-hairline,#23252a)] bg-black/20 p-3 text-sm">
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
              {labels.observationUsed} ·{" "}
              {o.kind === "recognition"
                ? labels.observationRecognition
                : labels.observationCitation}
            </p>
            <p className="mt-1 tabular-nums">
              {o.kind === "recognition"
                ? `${o.confirmed} / ${o.answers}`
                : `${o.officialCited} / ${o.answersWithCitations}`}
            </p>
            {o.kind === "recognition" && o.excerpt && (
              <blockquote className="mt-2 border-emerald-800 border-l-2 pl-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                {o.excerptEngine}: “{o.excerpt}”
              </blockquote>
            )}
          </div>
        )}

        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-0.5">
            <dt className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
              {labels.contact}
            </dt>
            <dd className="text-sm">
              {lead.contact ? (
                <>
                  {lead.contact.email}{" "}
                  <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                    ({lead.contact.role} ·{" "}
                    <a
                      className="underline underline-offset-2"
                      href={lead.contact.sourceUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {labels.contactSource}
                    </a>{" "}
                    {lead.contact.checkedOn})
                  </span>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
              {labels.reportLink}
            </dt>
            <dd className="text-sm">
              {lead.reportUrl ? (
                <a
                  className="underline underline-offset-2"
                  href={lead.reportUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {lead.reportUrl}
                </a>
              ) : (
                <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                  {labels.reportNone}
                </span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      {draft && (
        <DraftComposer
          canSave={canSave}
          initialBasis={lead.contact?.contactBasis ?? null}
          initialDraft={draft}
          key={lead.id}
          labels={labels}
          leadId={lead.id}
        />
      )}
    </div>
  );
}

export function LeadWorkbench({
  leads,
  labels,
  sender,
  senderEmail,
  connectFailed,
}: {
  connectFailed: boolean;
  labels: Labels;
  leads: WorkbenchLead[];
  sender: SenderState;
  senderEmail: string;
}) {
  const [industry, setIndustry] = useState<LeadIndustry | "all">("beauty");
  const [onlyReady, setOnlyReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const result = new Map<LeadIndustry | "all", number>();
    for (const item of leads) {
      result.set(item.lead.industry, (result.get(item.lead.industry) ?? 0) + 1);
    }
    result.set("all", leads.length);
    return result;
  }, [leads]);

  const visible = useMemo(
    () =>
      leads
        .filter(
          (item) =>
            (industry === "all" || item.lead.industry === industry) &&
            (!onlyReady || item.readiness.composable)
        )
        .sort(
          (a, b) =>
            Number(b.readiness.ready) - Number(a.readiness.ready) ||
            Number(b.readiness.composable) - Number(a.readiness.composable) ||
            Number(Boolean(b.lead.measurement)) -
              Number(Boolean(a.lead.measurement)) ||
            a.lead.priority - b.lead.priority
        ),
    [leads, industry, onlyReady]
  );
  const selected =
    visible.find((item) => item.lead.id === selectedId) ?? visible[0] ?? null;

  return (
    <>
      <div className="space-y-2">
        <p className="font-medium text-emerald-400 text-xs uppercase tracking-[0.2em]">
          AX / OUTREACH
        </p>
        <h1 className="font-semibold text-3xl tracking-tight">
          {labels.title}
        </h1>
        <p className="max-w-3xl text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-6">
          {labels.description}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SenderPanel
          connectFailed={connectFailed}
          labels={labels}
          sender={sender}
          senderEmail={senderEmail}
        />
        <section className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-4 text-sm">
          <p className="font-semibold text-amber-200">{labels.legalTitle}</p>
          <p className="mt-1.5 text-amber-100/80 text-xs leading-5">
            {labels.legalBody}
          </p>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {INDUSTRIES.map((value) => (
          <button
            aria-pressed={industry === value}
            className={`min-h-9 rounded-full border px-3 text-sm transition ${
              industry === value
                ? "border-emerald-400 bg-emerald-400/10 text-emerald-200"
                : "border-[color:var(--findable-hairline,#23252a)] text-[color:var(--findable-ink-subtle,#8a8f98)] hover:text-[color:var(--findable-ink,#f7f8f8)]"
            }`}
            key={value}
            onClick={() => {
              setIndustry(value);
              setSelectedId(null);
            }}
            type="button"
          >
            {industryLabel(labels, value)}{" "}
            <span className="tabular-nums opacity-60">
              {counts.get(value) ?? 0}
            </span>
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input
            checked={onlyReady}
            onChange={(event) => setOnlyReady(event.target.checked)}
            type="checkbox"
          />
          {labels.onlyReady}
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="overflow-hidden rounded-xl border border-[color:var(--findable-hairline,#23252a)]">
          {visible.length === 0 ? (
            <p className="p-5 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              {labels.empty}
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--findable-hairline,#23252a)]">
              {visible.map((item) => {
                const active = selected?.lead.id === item.lead.id;
                return (
                  <li key={item.lead.id}>
                    <button
                      aria-current={active}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition ${
                        active ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"
                      }`}
                      onClick={() => setSelectedId(item.lead.id)}
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-sm">
                          {item.lead.brand}
                        </span>
                        <span className="block truncate text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                          {item.lead.domain}
                          {item.lead.measurement
                            ? ` · ${labels.officialCited} ${item.lead.measurement.officialCited}/${item.lead.measurement.answersWithCitations}`
                            : ""}
                        </span>
                      </span>
                      <StatusBadge item={item} labels={labels} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div>
          {selected ? (
            <LeadDetail
              canSave={sender.kind === "ok"}
              item={selected}
              labels={labels}
            />
          ) : (
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              {labels.noneSelected}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
