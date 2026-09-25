/** Return only allowlisted diagnostic fields; provider bodies can contain user data. */
const SECONDS_PATTERN = /^\d+$/;

export function describeProviderError(error: unknown): {
  statusCode: number | null;
  providerCode: "rate_limit_exceeded" | "usage_limit_exceeded" | null;
  retryAfterSeconds: number | null;
} {
  const finalError =
    isRecord(error) && "lastError" in error ? error.lastError : error;
  if (!isRecord(finalError)) {
    return { statusCode: null, providerCode: null, retryAfterSeconds: null };
  }

  const statusCode =
    typeof finalError.statusCode === "number" ? finalError.statusCode : null;
  const providerCode = providerErrorCode(finalError.responseBody);

  const headers = isRecord(finalError.responseHeaders)
    ? finalError.responseHeaders
    : null;
  const retryAfter = headers?.["retry-after"];
  const seconds =
    typeof retryAfter === "string" && SECONDS_PATTERN.test(retryAfter)
      ? Number(retryAfter)
      : null;
  return {
    statusCode,
    providerCode,
    retryAfterSeconds:
      seconds !== null && Number.isSafeInteger(seconds) ? seconds : null,
  };
}

function providerErrorCode(
  responseBody: unknown
): "rate_limit_exceeded" | "usage_limit_exceeded" | null {
  if (typeof responseBody !== "string") {
    return null;
  }
  try {
    const body: unknown = JSON.parse(responseBody);
    const detail = isRecord(body) ? body.error : null;
    const code = isRecord(detail) ? (detail.type ?? detail.code) : null;
    return code === "rate_limit_exceeded" || code === "usage_limit_exceeded"
      ? code
      : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
