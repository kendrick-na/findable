"use client";

import { useState } from "react";

export function NewsletterSubscribe({
  locale,
  publisherName,
  publisherSlug,
  tone = "light",
}: {
  locale: string;
  publisherName: string;
  publisherSlug: string;
  tone?: "dark" | "light";
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
        try {
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
        } catch {
          setState("error");
        }
      }}
    >
      <label className="sr-only" htmlFor={`newsletter-${publisherSlug}`}>
        Email
      </label>
      <input
        autoComplete="email"
        className="h-11 min-w-0 flex-1 rounded-md border border-current/15 bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff7a4d]"
        id={`newsletter-${publisherSlug}`}
        name="email"
        aria-label={ko ? "이메일 주소" : "Email address"}
        placeholder="email@example.com"
        required
        type="email"
      />
      <button
        className={`h-11 rounded-md px-5 text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff7a4d] focus-visible:ring-offset-2 ${tone === "dark" ? "bg-[#ff7a4d] text-[#1f211f] focus-visible:ring-offset-[#151719]" : "bg-[#1f211f] text-white focus-visible:ring-offset-[#f5f1e8]"}`}
        disabled={state === "sending" || state === "sent"}
        type="submit"
      >
        {buttonLabel}
      </button>
      {state === "error" ? (
        <p aria-live="polite" className="text-red-600 text-xs sm:self-center">
          {ko ? "잠시 후 다시 시도해 주세요." : "Please try again."}
        </p>
      ) : null}
    </form>
  );
}
