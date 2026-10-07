"use client";

import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import { Checkbox } from "@repo/design-system/components/ui/checkbox";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addCompaniesToSalesList,
  findCompanyContacts,
  setSalesLeadStatus,
} from "@/app/actions/admin/sales-discovery";
import type {
  CompanyCardData,
  ContactView,
  FactView,
} from "@/lib/ax-mail/discovery/screen";
import {
  DISCOVER_TAGS,
  SALES_LEAD_STATUSES,
  type SalesLeadStatusId,
  safeExternalUrl,
} from "@/lib/ax-mail/discovery/view";
import type { RecipientDraft } from "@/lib/ax-mail/draft-batch";
import type { AppDictionary } from "@/lib/i18n";
import { DraftComposer, type DraftComposerLabels } from "../draft-composer";
import { ExternalLink } from "./external-link";
import { MeasureButton } from "./measure-button";

type Labels = AppDictionary["salesDiscover"];

const subtle = "text-[color:var(--findable-ink-subtle,#8a8f98)]";
const panel =
  "rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-4";

/** 기본 정보에 보여 줄 사실 순서 — 나머지는 뒤에(원문 그대로). */
const FIELD_ORDER = [
  "legalName",
  "businessNumber",
  "industry",
  "address",
  "homepage",
  "storeUrl",
  "employeeCount",
  "foundedOn",
  "products",
];

function lookup(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

function seoulDate(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

const LINK_FIELDS = new Set(["homepage", "storeUrl"]);

function sourceLine(labels: Labels, f: FactView): string {
  return f.sources
    .map(
      (src) =>
        `${lookup(labels.sources, src.source)} (${
          src.asOf
            ? `${labels.asOf} ${src.asOf}`
            : `${labels.fetchedOn} ${seoulDate(src.fetchedAt)}`
        })`
    )
    .join(labels.sourcesJoiner);
}

/** 기본 정보 — 값이 같은 줄은 하나로, 출처는 여러 개 함께(screen.ts latestFacts). */
function Facts({ card, labels }: { card: CompanyCardData; labels: Labels }) {
  const facts = [...card.facts].sort((a, b) => {
    const ia = FIELD_ORDER.indexOf(a.field);
    const ib = FIELD_ORDER.indexOf(b.field);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return (
    <dl className="space-y-2.5" data-testid="company-facts">
      {facts.map((f) => (
        <div
          className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2"
          key={`${f.field}-${f.value}`}
        >
          <dt className={`text-xs ${subtle}`}>
            {lookup(labels.fields, f.field)}
          </dt>
          <dd className="min-w-0 text-sm">
            <span className="break-words">
              {LINK_FIELDS.has(f.field) ? (
                <ExternalLink href={f.value}>{f.value}</ExternalLink>
              ) : (
                f.value
              )}
            </span>
            <span className={`block text-xs ${subtle}`}>
              {labels.source}: {sourceLine(labels, f)}
            </span>
          </dd>
        </div>
      ))}
      {card.subIndustries.length > 0 && (
        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
          <dt className={`text-xs ${subtle}`}>{labels.fields.subIndustry}</dt>
          <dd className="min-w-0 text-sm">
            <span className="flex flex-wrap gap-1">
              {card.subIndustries.map((sub) => (
                <Badge key={sub.id} variant="outline">
                  {labels.subIndustries[sub.id]} ·{" "}
                  {lookup(labels.industryBasis, sub.basis)}
                </Badge>
              ))}
            </span>
            <span className={`block text-xs ${subtle}`}>
              {labels.subBasisNote}
            </span>
          </dd>
        </div>
      )}
    </dl>
  );
}

function ContactRow({
  checked,
  contact,
  labels,
  onCheck,
}: {
  checked: boolean;
  contact: ContactView;
  labels: Labels;
  onCheck: (on: boolean) => void;
}) {
  const id = `contact-${contact.email}`;
  return (
    <li className="flex items-start gap-2.5">
      <Checkbox
        aria-label={contact.email}
        checked={checked}
        className="mt-0.5"
        id={id}
        onCheckedChange={(on) => onCheck(on === true)}
      />
      <label className="min-w-0 flex-1 text-sm" htmlFor={id}>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{contact.email}</span>
          <Badge variant="secondary">{labels.roles[contact.roleLabel]}</Badge>
        </span>
        <span className={`block text-xs ${subtle}`}>
          {contact.label ? `“${contact.label}” · ` : ""}
          <ExternalLink
            className="underline underline-offset-2"
            href={contact.sourceUrl}
          >
            {labels.sourcePage}
          </ExternalLink>{" "}
          · {seoulDate(contact.fetchedAt)}
        </span>
        {contact.personalName && (
          <span className="block text-amber-300 text-xs">
            {labels.personalFlag}
          </span>
        )}
        {contact.role === "privacy" && (
          <span className="block text-amber-300 text-xs">
            {labels.privacyFlag}
          </span>
        )}
      </label>
    </li>
  );
}

function CardHeader({
  card,
  closeHref,
  labels,
  onStage,
  pending,
  stageError,
}: {
  card: CompanyCardData;
  closeHref: string;
  labels: Labels;
  onStage: (status: SalesLeadStatusId) => void;
  pending: boolean;
  stageError: string | null;
}) {
  const { company } = card;
  const tagSet = new Set<string>(DISCOVER_TAGS);
  return (
    <section className={panel}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-lg">{company.legalName}</h2>
          <p className={`text-xs ${subtle}`}>
            {company.domain ? (
              <ExternalLink href={company.domain}>
                {company.domain}
              </ExternalLink>
            ) : (
              "—"
            )}
            {company.region ? ` · ${company.region}` : ""}
          </p>
          <span className="mt-1.5 flex flex-wrap gap-1">
            {company.sources.map((s) => (
              <Badge key={`s-${s}`} variant="outline">
                {lookup(labels.sourceShort, s)}
              </Badge>
            ))}
            {company.tags
              .filter((t) => tagSet.has(t))
              .map((t) => (
                <Badge key={`t-${t}`} variant="secondary">
                  {lookup(labels.tags, t)}
                </Badge>
              ))}
          </span>
        </div>
        <Link
          aria-label={labels.close}
          className={`text-lg leading-none ${subtle} hover:text-[color:var(--findable-ink,#f7f8f8)]`}
          href={closeHref}
          scroll={false}
        >
          ×
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label className={`text-xs ${subtle}`} htmlFor="lead-stage">
          {labels.stageLabel}
        </label>
        <select
          className="rounded-md border border-[color:var(--findable-hairline,#23252a)] bg-black/20 px-2 py-1 text-sm"
          disabled={pending}
          id="lead-stage"
          onChange={(event) => onStage(event.target.value as SalesLeadStatusId)}
          value={card.lead?.status ?? ""}
        >
          {!card.lead && <option value="">{labels.stageNone}</option>}
          {SALES_LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {labels.stages[s]}
            </option>
          ))}
        </select>
        {stageError && (
          <span className="text-amber-300 text-xs">{stageError}</span>
        )}
      </div>
      {company.matchConfidence === "name_only" && (
        <p className="mt-3 text-amber-300 text-xs">{labels.matchNameOnly}</p>
      )}
    </section>
  );
}

function ReportButton({
  labels,
  reportIssueHref,
  reportUrl,
}: {
  labels: Labels;
  reportIssueHref: string | null;
  reportUrl: string | null;
}) {
  const safeReport = safeExternalUrl(reportUrl);
  if (safeReport) {
    return (
      <Button asChild variant="outline">
        <a href={safeReport} rel="noopener noreferrer" target="_blank">
          {labels.report} · {labels.reportOpen}
        </a>
      </Button>
    );
  }
  if (reportIssueHref) {
    return (
      <Button asChild variant="outline">
        <Link href={reportIssueHref}>
          {labels.report} · {labels.reportIssue}
        </Link>
      </Button>
    );
  }
  return (
    <Button disabled title={labels.reportNoJob} variant="outline">
      {labels.report}
    </Button>
  );
}

/** [메일 초안] — 체크한 주소가 2개 이상이면 주소마다 초안 1건(DraftComposer 다중 모드). */
function DraftArea({
  canSave,
  card,
  labels,
  mailLabels,
  recipients,
}: {
  canSave: boolean;
  card: CompanyCardData;
  labels: Labels;
  mailLabels: DraftComposerLabels;
  recipients: RecipientDraft[];
}) {
  const first = recipients[0];
  if (!first) {
    return <p className="text-amber-300 text-sm">{labels.draftNoRecipients}</p>;
  }
  return (
    <div className="space-y-2">
      {!card.reportUrl && (
        <p className="text-amber-300 text-xs">{labels.draftNoReport}</p>
      )}
      <DraftComposer
        canSave={canSave}
        initialBasis={first.basis}
        initialDraft={{ ...card.draft, recipient: first.email }}
        key={recipients.map((r) => r.email).join(",")}
        labels={mailLabels}
        leadId={card.company.domain ?? undefined}
        recipients={recipients}
        salesLeadId={card.lead?.id}
      />
    </div>
  );
}

/** 오른쪽 회사 카드 — 기본 정보(출처·기준일) · 공개 메일(여러 명 선택) · [측정] [리포트] [메일 초안]. */
export function CompanyCard({
  canSave,
  card,
  closeHref,
  labels,
  mailLabels,
}: {
  canSave: boolean;
  card: CompanyCardData;
  closeHref: string;
  labels: Labels;
  mailLabels: DraftComposerLabels;
}) {
  const router = useRouter();
  const { company } = card;
  const [contacts, setContacts] = useState<ContactView[]>(card.contacts);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(card.defaultRecipients)
  );
  const [findStatus, setFindStatus] = useState<string | null>(null);
  const [showDraft, setShowDraft] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const recipients: RecipientDraft[] = contacts
    .filter((c) => selected.has(c.email))
    .map((c) => ({ basis: c.basis, email: c.email }));

  const findContacts = () =>
    startTransition(async () => {
      const result = await findCompanyContacts(company.id);
      if (!result.ok) {
        setFindStatus(labels.errors[result.error]);
        return;
      }
      setContacts(result.contacts);
      setSelected((prev) =>
        prev.size > 0 ? prev : new Set(result.defaultRecipients)
      );
      setFindStatus(
        lookup(labels.contactStatus as Record<string, string>, result.status)
      );
    });

  const changeStage = (status: SalesLeadStatusId) =>
    startTransition(async () => {
      const result = await setSalesLeadStatus({
        companyId: company.id,
        status,
      });
      setStageError(result.ok ? null : labels.stageSaveFailed);
      router.refresh();
    });

  const openDraft = () => {
    if (showDraft) {
      setShowDraft(false);
      return;
    }
    setShowDraft(true);
    if (!card.lead) {
      // 초안을 만들 회사는 영업 목록에 먼저 올린다 → 저장 시 수신 근거·단계가 리드에 남는다.
      startTransition(async () => {
        await addCompaniesToSalesList({ companyIds: [company.id] });
        router.refresh();
      });
    }
  };

  const reportIssueHref =
    card.lastJob?.status === "completed"
      ? `/admin/client-reports?auditJobId=${card.lastJob.id}`
      : null;
  return (
    <div className="space-y-3" data-testid="company-card">
      <CardHeader
        card={card}
        closeHref={closeHref}
        labels={labels}
        onStage={changeStage}
        pending={pending}
        stageError={stageError}
      />

      <section className={panel}>
        <h3 className="mb-3 font-semibold text-sm">{labels.basicInfo}</h3>
        <Facts card={card} labels={labels} />
        <p className={`mt-3 text-xs ${subtle}`}>
          {labels.lastMeasure}:{" "}
          {card.lastJob
            ? `${card.lastJob.status} · ${seoulDate(card.lastJob.createdAt)}`
            : labels.lastMeasureNone}
        </p>
      </section>

      <section className={panel}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-sm">{labels.contactsTitle}</h3>
          <Button
            disabled={pending || !company.domain}
            onClick={findContacts}
            size="sm"
            type="button"
            variant="outline"
          >
            {pending ? labels.finding : labels.findContacts}
          </Button>
        </div>
        <p className={`mb-3 text-xs ${subtle}`}>{labels.contactsHelp}</p>
        {findStatus && (
          <output className={`mb-2 block text-xs ${subtle}`}>
            {findStatus}
          </output>
        )}
        {contacts.length === 0 ? (
          <p className={`text-sm ${subtle}`}>{labels.contactsNone}</p>
        ) : (
          <ul className="space-y-3" data-testid="contact-list">
            {contacts.map((c) => (
              <ContactRow
                checked={selected.has(c.email)}
                contact={c}
                key={c.email}
                labels={labels}
                onCheck={(on) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (on) {
                      next.add(c.email);
                    } else {
                      next.delete(c.email);
                    }
                    return next;
                  })
                }
              />
            ))}
          </ul>
        )}
      </section>

      <section className={`${panel} flex flex-wrap items-start gap-2`}>
        <MeasureButton
          companyId={company.id}
          disabled={!company.domain}
          labels={labels}
          size="default"
        />
        <ReportButton
          labels={labels}
          reportIssueHref={reportIssueHref}
          reportUrl={card.reportUrl}
        />
        <Button onClick={openDraft} type="button">
          {showDraft ? labels.draftHide : labels.draft}
          {!showDraft && recipients.length > 0 && (
            <span className="tabular-nums">({recipients.length})</span>
          )}
        </Button>
        {!(card.reportUrl || reportIssueHref) && (
          <p className={`w-full text-xs ${subtle}`}>{labels.reportNoJob}</p>
        )}
      </section>

      {showDraft && (
        <DraftArea
          canSave={canSave}
          card={card}
          labels={labels}
          mailLabels={mailLabels}
          recipients={recipients}
        />
      )}
    </div>
  );
}
