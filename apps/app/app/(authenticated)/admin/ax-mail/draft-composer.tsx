"use client";

import { useRef, useState } from "react";
import {
  CONTACT_BASIS_KINDS,
  type ContactBasis,
  type ContactBasisKind,
  contactBasisProblem,
  subjectForBasis,
} from "@/lib/ax-mail/contact-basis";

export interface DraftComposerLabels {
  basisBusinessCard: string;
  basisDate: string;
  basisDetail: string;
  basisExistingCustomer: string;
  basisExpired: string;
  basisHelp: string;
  basisKind: string;
  basisMissing: string;
  basisPublicContact: string;
  basisRequested: string;
  basisSelect: string;
  basisTitle: string;
  blockedToSave: string;
  body: string;
  connectToSave: string;
  draftId: string;
  editWarning: string;
  errorAdNotice: string;
  errorGuarantee: string;
  errorReportLink: string;
  errorSender: string;
  failed: string;
  recipient: string;
  saveDraft: string;
  saved: string;
  savedFrom: string;
  saving: string;
  subject: string;
}

type Result =
  | { kind: "saved"; id: string; sender: string }
  | { kind: "failed"; message: string };

function basisKindLabel(
  labels: DraftComposerLabels,
  kind: ContactBasisKind
): string {
  const map: Record<ContactBasisKind, string> = {
    business_card: labels.basisBusinessCard,
    requested: labels.basisRequested,
    existing_customer: labels.basisExistingCustomer,
    public_contact: labels.basisPublicContact,
  };
  return map[kind];
}

function errorMessage(
  labels: DraftComposerLabels,
  code: string | undefined,
  reason?: string
) {
  switch (code) {
    case "contact_basis_invalid":
      return reason === "expired" ? labels.basisExpired : labels.basisMissing;
    case "report_link_missing":
      return labels.errorReportLink;
    case "sender_alias_missing":
    case "mail_token_expired":
      return labels.errorSender;
    case "ad_notice_missing":
      return labels.errorAdNotice;
    case "guarantee_claim":
      return labels.errorGuarantee;
    default:
      return labels.failed;
  }
}

/**
 * 초안 편집 + 「Gmail 초안함에 저장」. 발송 버튼은 없다.
 * canSave = 보낸사람(회사 주소 별칭) 확인 완료. 서버도 같은 검사를 다시 한다.
 * 수신 근거(명함·요청·6개월 내 기존 고객)를 입력해야 저장된다 — 서버도 다시 검사.
 */
export function DraftComposer({
  labels,
  initialDraft,
  initialBasis,
  canSave,
  leadId,
}: {
  canSave: boolean;
  initialBasis?: ContactBasis | null;
  initialDraft: { recipient: string; subject: string; body: string };
  labels: DraftComposerLabels;
  leadId?: string;
}) {
  const [recipient, setRecipient] = useState(initialDraft.recipient);
  const [subject, setSubject] = useState(initialDraft.subject);
  const [body, setBody] = useState(initialDraft.body);
  const [basisKind, setBasisKind] = useState<ContactBasisKind | "">(
    initialBasis?.kind ?? ""
  );
  const [basisDetail, setBasisDetail] = useState(initialBasis?.detail ?? "");
  const [basisDate, setBasisDate] = useState(initialBasis?.date ?? "");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const requestKey = useRef<string | null>(null);

  const changed = () => {
    requestKey.current = null;
    setResult(null);
  };

  const basis: ContactBasis | null = basisKind
    ? { kind: basisKind, detail: basisDetail, date: basisDate }
    : null;
  const basisProblem = contactBasisProblem(basis, new Date());

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !canSave || basisProblem || !basis) {
      return;
    }
    setPending(true);
    setResult(null);
    requestKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/ax-mail/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient,
          subject,
          body,
          leadId,
          contactBasis: basis,
          idempotencyKey: requestKey.current,
        }),
      });
      const value = (await response.json().catch(() => ({}))) as {
        draftId?: string;
        error?: string;
        reason?: string;
        sender?: string;
      };
      if (response.ok && value.draftId && value.sender) {
        setResult({ kind: "saved", id: value.draftId, sender: value.sender });
      } else {
        setResult({
          kind: "failed",
          message: errorMessage(labels, value.error, value.reason),
        });
      }
    } catch {
      setResult({ kind: "failed", message: labels.failed });
    } finally {
      setPending(false);
    }
  }

  const fieldClass =
    "w-full rounded-md border border-[color:var(--findable-hairline,#23252a)] bg-black/20 px-3 py-2.5 text-sm outline-none transition focus:border-emerald-400";

  return (
    <form
      className="space-y-4 rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-5"
      onSubmit={save}
    >
      <fieldset className="space-y-3 rounded-md border border-[color:var(--findable-hairline,#23252a)] p-3">
        <legend className="px-1 font-medium text-sm">
          {labels.basisTitle}
        </legend>
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
          {labels.basisHelp}
        </p>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,4fr)_minmax(0,5fr)_minmax(0,3fr)]">
          <label className="block space-y-1.5 font-medium text-sm">
            <span>{labels.basisKind}</span>
            <select
              className={fieldClass}
              onChange={(event) => {
                const kind = event.target.value as ContactBasisKind | "";
                setBasisKind(kind);
                setSubject((current) => subjectForBasis(current, kind || null));
                changed();
              }}
              required
              value={basisKind}
            >
              <option value="">{labels.basisSelect}</option>
              {CONTACT_BASIS_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {basisKindLabel(labels, kind)}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5 font-medium text-sm">
            <span>{labels.basisDetail}</span>
            <input
              autoComplete="off"
              className={fieldClass}
              maxLength={500}
              onChange={(event) => {
                setBasisDetail(event.target.value);
                changed();
              }}
              required
              value={basisDetail}
            />
          </label>
          <label className="block space-y-1.5 font-medium text-sm">
            <span>{labels.basisDate}</span>
            <input
              className={fieldClass}
              onChange={(event) => {
                setBasisDate(event.target.value);
                changed();
              }}
              required
              type="date"
              value={basisDate}
            />
          </label>
        </div>
        {basisProblem && (
          <p className="text-amber-300 text-sm">
            {basisProblem === "expired"
              ? labels.basisExpired
              : labels.basisMissing}
          </p>
        )}
      </fieldset>
      <label className="block space-y-1.5 font-medium text-sm">
        <span>{labels.recipient}</span>
        <input
          autoComplete="off"
          className={fieldClass}
          maxLength={320}
          onChange={(event) => {
            setRecipient(event.target.value);
            changed();
          }}
          required
          type="email"
          value={recipient}
        />
      </label>
      <label className="block space-y-1.5 font-medium text-sm">
        <span>{labels.subject}</span>
        <input
          className={fieldClass}
          maxLength={500}
          onChange={(event) => {
            setSubject(event.target.value);
            changed();
          }}
          required
          value={subject}
        />
      </label>
      <label className="block space-y-1.5 font-medium text-sm">
        <span>{labels.body}</span>
        <textarea
          className={`${fieldClass} min-h-80 resize-y font-normal leading-6`}
          maxLength={100_000}
          onChange={(event) => {
            setBody(event.target.value);
            changed();
          }}
          required
          value={body}
        />
      </label>
      <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
        {labels.editWarning}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <button
          className="min-h-10 rounded-md bg-emerald-400 px-5 font-semibold text-slate-950 text-sm transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={
            !canSave ||
            Boolean(basisProblem) ||
            pending ||
            result?.kind === "saved"
          }
          type="submit"
        >
          {pending ? labels.saving : labels.saveDraft}
        </button>
        {!canSave && (
          <p className="text-amber-300 text-sm">{labels.connectToSave}</p>
        )}
        {result && (
          <output
            className={`text-sm ${result.kind === "saved" ? "text-emerald-300" : "text-amber-300"}`}
          >
            {result.kind === "saved"
              ? `${labels.saved} ${labels.savedFrom}: ${result.sender} · ${labels.draftId}: ${result.id}`
              : result.message}
          </output>
        )}
      </div>
    </form>
  );
}
