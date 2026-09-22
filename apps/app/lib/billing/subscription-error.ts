type ErrorWithDetails = {
  code?: unknown;
  message?: unknown;
};

/** PG SDK 오류에서 코드·메시지만 안전하게 보여 준다. */
export function describeSubscriptionError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;

  if (error && typeof error === "object") {
    const { code, message } = error as ErrorWithDetails;
    const safeCode = typeof code === "string" ? code : undefined;
    const safeMessage = typeof message === "string" ? message : undefined;
    if (safeCode && safeMessage) return `${safeCode}: ${safeMessage}`;
    if (safeMessage) return safeMessage;
    if (safeCode) return safeCode;
  }

  return "알 수 없는 오류";
}
