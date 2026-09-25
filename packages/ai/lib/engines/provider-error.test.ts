import { describe, expect, it } from "vitest";

import { describeProviderError } from "./provider-error";

describe("describeProviderError", () => {
  it("reads the final API error beneath SDK retries without exposing response text", () => {
    expect(
      describeProviderError({
        lastError: {
          statusCode: 429,
          responseHeaders: { "retry-after": "45" },
          responseBody: JSON.stringify({
            error: { type: "rate_limit_exceeded", message: "private prompt" },
          }),
        },
      })
    ).toEqual({
      statusCode: 429,
      providerCode: "rate_limit_exceeded",
      retryAfterSeconds: 45,
    });
  });

  it("distinguishes exhausted usage from a temporary rate limit", () => {
    expect(
      describeProviderError({
        statusCode: 429,
        responseBody: JSON.stringify({
          error: { code: "usage_limit_exceeded" },
        }),
      })
    ).toEqual({
      statusCode: 429,
      providerCode: "usage_limit_exceeded",
      retryAfterSeconds: null,
    });
  });

  it("does not log unknown provider payloads", () => {
    expect(describeProviderError(new Error("private data"))).toEqual({
      statusCode: null,
      providerCode: null,
      retryAfterSeconds: null,
    });
  });
});
