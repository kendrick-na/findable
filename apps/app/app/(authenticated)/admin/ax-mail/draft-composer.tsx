"use client";

import { useRef, useState } from "react";

interface Labels {
  body: string;
  connectToSave: string;
  draftId: string;
  failed: string;
  recipient: string;
  saveDraft: string;
  saved: string;
  saving: string;
  subject: string;
}

export function DraftComposer({
  labels,
  initialDraft,
  connected,
}: {
  labels: Labels;
  initialDraft?: { recipient: string; subject: string; body: string };
  connected: boolean;
}) {
  const [recipient, setRecipient] = useState(initialDraft?.recipient ?? "");
  const [subject, setSubject] = useState(initialDraft?.subject ?? "");
  const [body, setBody] = useState(initialDraft?.body ?? "");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    kind: "saved" | "failed";
    id?: string;
  } | null>(null);
  const requestKey = useRef<string | null>(null);

  const changed = () => {
    requestKey.current = null;
    setResult(null);
  };

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !connected) {
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
          idempotencyKey: requestKey.current,
        }),
      });
      const value = (await response.json()) as { draftId?: string };
      if (!(response.ok && value.draftId)) {
        throw new Error("DRAFT_SAVE_FAILED");
      }
      setResult({ kind: "saved", id: value.draftId });
    } catch {
      setResult({ kind: "failed" });
    } finally {
      setPending(false);
    }
  }

  const fieldClass =
    "w-full rounded-md border border-[color:var(--findable-hairline,#23252a)] bg-black/20 px-3 py-2.5 text-sm outline-none transition focus:border-emerald-400";

  return (
    <form
      className="space-y-5 rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-5 md:p-6"
      onSubmit={save}
    >
      <label className="block space-y-2 font-medium text-sm">
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
      <label className="block space-y-2 font-medium text-sm">
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
      <label className="block space-y-2 font-medium text-sm">
        <span>{labels.body}</span>
        <textarea
          className={`${fieldClass} min-h-56 resize-y leading-6`}
          maxLength={100_000}
          onChange={(event) => {
            setBody(event.target.value);
            changed();
          }}
          required
          value={body}
        />
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <button
          className="min-h-10 rounded-md bg-emerald-400 px-5 font-semibold text-slate-950 text-sm transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!connected || pending || result?.kind === "saved"}
          type="submit"
        >
          {pending ? labels.saving : labels.saveDraft}
        </button>
        {!connected && (
          <p className="text-amber-300 text-sm">{labels.connectToSave}</p>
        )}
        {result && (
          <output
            className={`text-sm ${result.kind === "saved" ? "text-emerald-300" : "text-amber-300"}`}
          >
            {result.kind === "saved"
              ? `${labels.saved} ${labels.draftId}: ${result.id}`
              : labels.failed}
          </output>
        )}
      </div>
    </form>
  );
}
