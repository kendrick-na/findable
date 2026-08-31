import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
  "x-clerk-auth-message",
  "x-clerk-auth-reason",
]);

const EXPECTED_ACCESS_DENIALS = [
  "FORBIDDEN: admin only",
  "FORBIDDEN: organization required",
  "Current user is not a member of the organization",
];

const isBrowserInjectedScriptNoise = (event: ErrorEvent, message: string) =>
  message.includes("Cannot read properties of undefined (reading 'sendMessage')") &&
  event.exception?.values?.some((value) =>
    value.stacktrace?.frames?.some((frame) =>
      frame.filename?.startsWith("app:///injectedScript.bundle")
    )
  );

/**
 * Keep operational evidence while removing credentials and customer payloads.
 * Expected access denials remain searchable but do not page the operator as
 * high-priority application failures.
 */
export const sanitizeSentryEvent = (
  event: ErrorEvent,
  hint: EventHint
): ErrorEvent | null => {
  const headers = event.request?.headers;
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
        headers[key] = "[Filtered]";
      }
    }
  }

  if (event.request) {
    event.request.cookies = undefined;
    event.request.data = undefined;
  }

  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }

  const message =
    event.message ??
    event.exception?.values?.map((value) => value.value ?? "").join(" ") ??
    (hint?.originalException instanceof Error
      ? hint.originalException.message
      : "");

  // Browser automation/instrumentation can inject this bundle into the page.
  // It is not part of the deployed app and otherwise creates a misleading
  // production login issue with zero affected users.
  if (isBrowserInjectedScriptNoise(event, message)) {
    return null;
  }

  if (EXPECTED_ACCESS_DENIALS.some((expected) => message.includes(expected))) {
    event.level = "info";
    event.tags = { ...event.tags, expected_access_denial: "true" };
  }

  return event;
};
