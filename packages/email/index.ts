import { Resend } from "resend";
import { keys } from "./keys";

/**
 * Outbound mail is disabled on Vercel Preview (2026-10-05): a Preview may hold
 * the real Resend token or real subscriber rows, and must never email anyone.
 * Every caller already treats a missing client as "email not configured".
 */
export function createResendClient(
  token: string | undefined,
  env: Record<string, string | undefined> = process.env
): Resend | undefined {
  if (!token || env.VERCEL_ENV === "preview") {
    return;
  }
  return new Resend(token);
}

const { RESEND_TOKEN } = keys();

export const resend = createResendClient(RESEND_TOKEN);
