"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { useId, useState, useTransition } from "react";
import { requestRefund } from "@/app/actions/billing/refund-request";
import type { AppDictionary } from "@/lib/i18n";

/**
 * 요금제 화면 "환불·청약철회 요청" — 2026-10-05.
 *
 * 요청은 운영자에게만 전달된다(고객에게 자동 메일 없음). 접수 후에는 화면에 확인 문구와
 * 3영업일 처리 안내(약관 제4조의3 제6항)를 보여 준다.
 * 🔒 만류·겁주기 문구를 넣지 않는다(해지 버튼과 같은 다크패턴 금지 규칙).
 */

type Outcome =
  | { kind: "idle" }
  | { kind: "done"; status: "created" | "already_pending" }
  | { kind: "error"; message: string };

export const RefundRequestForm = ({
  hasPendingRequest = false,
  t,
}: {
  /** 사전 `app.refundRequest`(⚖️ 영어판 정책 문장은 공개 영문 약관 문장 그대로). */
  t: AppDictionary["refundRequest"];
  /** 처리 대기 요청이 이미 있으면 새로고침 뒤에도 접수 상태를 보여 준다. */
  hasPendingRequest?: boolean;
}) => {
  const [isOpen, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [outcome, setOutcome] = useState<Outcome>(
    hasPendingRequest
      ? { kind: "done", status: "already_pending" }
      : { kind: "idle" }
  );
  const [isPending, startTransition] = useTransition();
  const messageId = useId();

  if (outcome.kind === "done") {
    return (
      <output className="block text-[color:var(--findable-ink-muted,#d0d6e0)] text-xs">
        {outcome.status === "created" ? t.created : t.alreadyPending}
      </output>
    );
  }

  if (!isOpen) {
    return (
      <button
        className="self-start text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs underline underline-offset-4 hover:text-[color:var(--findable-ink,#f7f8f8)]"
        onClick={() => setOpen(true)}
        type="button"
      >
        {t.open}
      </button>
    );
  }

  const submit = () => {
    startTransition(async () => {
      try {
        const result = await requestRefund({ message });
        setOutcome(
          result.ok
            ? { kind: "done", status: result.status }
            : { kind: "error", message: result.error }
        );
      } catch {
        setOutcome({
          kind: "error",
          message: t.sendFailed,
        });
      }
    });
  };

  return (
    <div className="flex max-w-xl flex-col gap-2 rounded-md border border-[color:var(--findable-hairline,#23252a)] p-3">
      <p className="text-[color:var(--findable-ink-muted,#d0d6e0)] text-xs">
        {t.body}
      </p>
      <label
        className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs"
        htmlFor={messageId}
      >
        {t.messageLabel}
      </label>
      <textarea
        className="min-h-16 rounded-md border border-[color:var(--findable-hairline,#23252a)] bg-transparent p-2 text-[color:var(--findable-ink,#f7f8f8)] text-xs"
        id={messageId}
        maxLength={500}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t.placeholder}
        value={message}
      />
      {outcome.kind === "error" && (
        <p
          className="text-[color:var(--findable-danger,#f87171)] text-xs"
          role="alert"
        >
          {outcome.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={isPending} onClick={submit} size="sm">
          {isPending ? t.sending : t.send}
        </Button>
        <Button
          disabled={isPending}
          onClick={() => setOpen(false)}
          size="sm"
          variant="ghost"
        >
          {t.cancel}
        </Button>
      </div>
    </div>
  );
};
