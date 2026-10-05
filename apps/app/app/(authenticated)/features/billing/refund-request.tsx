"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { useId, useState, useTransition } from "react";
import { requestRefund } from "@/app/actions/billing/refund-request";

/**
 * 요금제 화면 "환불·청약철회 요청" — 2026-10-05.
 *
 * 요청은 운영자에게만 전달된다(고객에게 자동 메일 없음). 접수 후에는 화면에 확인 문구와
 * 3영업일 처리 안내(약관 제4조의3 초안 제6항)를 보여 준다.
 * 🔒 만류·겁주기 문구를 넣지 않는다(해지 버튼과 같은 다크패턴 금지 규칙).
 */

type Outcome =
  | { kind: "idle" }
  | { kind: "done"; status: "created" | "already_pending" }
  | { kind: "error"; message: string };

const DONE_MESSAGE = {
  created:
    "요청이 접수됐어요. 받은 날부터 3영업일 이내에 결제를 취소해 환불해 드려요.",
  already_pending:
    "이미 접수된 요청이 있어요. 받은 날부터 3영업일 이내에 처리해 드려요.",
} as const;

export const RefundRequestForm = () => {
  const [isOpen, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const messageId = useId();

  if (outcome.kind === "done") {
    return (
      <output className="block text-[color:var(--findable-ink-muted,#d0d6e0)] text-xs">
        {DONE_MESSAGE[outcome.status]}
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
        환불·청약철회 요청
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
          message: "요청을 보내지 못했어요. 잠시 후 다시 시도해 주세요.",
        });
      }
    });
  };

  return (
    <div className="flex max-w-xl flex-col gap-2 rounded-md border border-[color:var(--findable-hairline,#23252a)] p-3">
      <p className="text-[color:var(--findable-ink-muted,#d0d6e0)] text-xs">
        결제일부터 7일 이내 청약철회, 또는 이용 중 해지·환불을 요청할 수 있어요.
        요청은 운영팀에 바로 전달되고, 받은 날부터 3영업일 이내에 처리해 드려요.
      </p>
      <label
        className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs"
        htmlFor={messageId}
      >
        요청 내용(선택)
      </label>
      <textarea
        className="min-h-16 rounded-md border border-[color:var(--findable-hairline,#23252a)] bg-transparent p-2 text-[color:var(--findable-ink,#f7f8f8)] text-xs"
        id={messageId}
        maxLength={500}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="예: 청약철회를 원해요"
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
          {isPending ? "보내는 중…" : "요청 보내기"}
        </Button>
        <Button
          disabled={isPending}
          onClick={() => setOpen(false)}
          size="sm"
          variant="ghost"
        >
          취소
        </Button>
      </div>
    </div>
  );
};
