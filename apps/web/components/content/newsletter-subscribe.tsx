"use client";

import { useState } from "react";

export function NewsletterSubscribe({
  locale,
  publisherName,
  publisherSlug,
}: {
  locale: string;
  publisherName: string;
  publisherSlug: string;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const ko = locale.startsWith("ko");
  let buttonLabel = ko
    ? `${publisherName} 구독`
    : `Subscribe to ${publisherName}`;
  if (state === "sending") {
    buttonLabel = "…";
  } else if (state === "sent") {
    buttonLabel = ko ? "확인 메일을 보냈습니다" : "Check your email";
  }
  return (
    <form
      className="mt-8 flex max-w-xl flex-col gap-3 rounded-lg border border-current/10 p-5 sm:flex-row"
      onSubmit={async (event) => {
        event.preventDefault();
        setState("sending");
        const form = new FormData(event.currentTarget);
        const response = await fetch("/api/newsletter/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: form.get("email"),
            locale: ko ? "ko" : "en",
            publisherSlug,
          }),
        });
        setState(response.ok ? "sent" : "error");
      }}
    >
      <label className="sr-only" htmlFor={`newsletter-${publisherSlug}`}>
        Email
      </label>
      <input
        className="h-11 min-w-0 flex-1 rounded-md border border-current/15 bg-transparent px-3 text-sm"
        id={`newsletter-${publisherSlug}`}
        name="email"
        placeholder="email@example.com"
        required
        type="email"
      />
      <button
        className="h-11 rounded-md bg-[#1f211f] px-5 text-sm text-white disabled:opacity-50"
        disabled={state === "sending" || state === "sent"}
        type="submit"
      >
        {buttonLabel}
      </button>
      {state === "error" ? (
        <p className="text-red-600 text-xs">
          {ko ? "잠시 후 다시 시도해 주세요." : "Please try again."}
        </p>
      ) : null}
    </form>
  );
}
