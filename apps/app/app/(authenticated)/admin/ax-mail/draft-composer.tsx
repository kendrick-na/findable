"use client";

import { useRef, useState } from "react";

export interface DraftComposerLabels {
  blockedToSave: string;
  body: string;
  connectToSave: string;
  draftId: string;
  editWarning: string;
  errorAdNotice: string;
  errorGuarantee: string;
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

function errorMessage(labels: DraftComposerLabels, code: string | undefined) {
  switch (code) {
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
 */
export function DraftComposer({
  labels,
  initialDraft,
  canSave,
  leadId,
}: {
  canSave: boolean;
  initialDraft: { recipient: string; subject: string; body: string };
  labels: DraftComposerLabels;
  leadId?: string;
}) {
  const [recipient, setRecipient] = useState(initialDraft.recipient);
  const [subject, setSubject] = useState(initialDraft.subject);
  const [body, setBody] = useState(initialDraft.body);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const requestKey = useRef<string | null>(null);

  const changed = () => {
    requestKey.current = null;
    setResult(null);
  };

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !canSave) {
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
          idempotencyKey: requestKey.current,
        }),
      });
      const value = (await response.json().catch(() => ({}))) as {
        draftId?: string;
        error?: string;
        sender?: string;
      };
      if (response.ok && value.draftId && value.sender) {
        setResult({ kind: "saved", id: value.draftId, sender: value.sender });
      } else {
        setResult({
          kind: "failed",
          message: errorMessage(labels, value.error),
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
          disabled={!canSave || pending || result?.kind === "saved"}
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
