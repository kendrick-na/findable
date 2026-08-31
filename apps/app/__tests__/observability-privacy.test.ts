import { sanitizeSentryEvent } from "@repo/observability/privacy";
import { describe, expect, test } from "vitest";

describe("sanitizeSentryEvent", () => {
  test("credentials and customer payloads are removed before transmission", () => {
    const event = sanitizeSentryEvent(
      {
        type: undefined,
        request: {
          cookies: { session: "secret" },
          data: { prompt: "customer prompt" },
          headers: {
            Authorization: "Bearer secret",
            Cookie: "session=secret",
            Accept: "application/json",
          },
        },
        user: {
          id: "user_1",
          email: "customer@example.com",
          ip_address: "1.2.3.4",
        },
      },
      {}
    );

    expect(event?.request?.cookies).toBeUndefined();
    expect(event?.request?.data).toBeUndefined();
    expect(event?.request?.headers?.Authorization).toBe("[Filtered]");
    expect(event?.request?.headers?.Cookie).toBe("[Filtered]");
    expect(event?.request?.headers?.Accept).toBe("application/json");
    expect(event?.user).toEqual({ id: "user_1" });
  });

  test("expected authorization denials stay searchable without paging as errors", () => {
    const event = sanitizeSentryEvent(
      {
        type: undefined,
        exception: { values: [{ value: "FORBIDDEN: admin only" }] },
        level: "error",
      },
      {}
    );

    expect(event?.level).toBe("info");
    expect(event?.tags?.expected_access_denial).toBe("true");
  });

  test("browser injected-script noise is not reported as a production issue", () => {
    const event = sanitizeSentryEvent(
      {
        type: undefined,
        exception: {
          values: [
            {
              value: "Cannot read properties of undefined (reading 'sendMessage')",
              stacktrace: {
                frames: [
                  { filename: "app:///injectedScript.bundle.js" },
                ],
              },
            },
          ],
        },
      },
      {}
    );

    expect(event).toBeNull();
  });
});
