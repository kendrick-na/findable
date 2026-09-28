import "server-only";

import {
  decryptRefreshToken,
  encryptRefreshToken,
  signOAuthState,
  verifyOAuthState,
} from "@/lib/search-performance/crypto";

export const MAIL_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
/** 보낸사람 별칭(contact@findable.co.kr) 등록 여부·발송 서버 확인용. 읽기 전용 설정 권한. */
export const SETTINGS_SCOPE =
  "https://www.googleapis.com/auth/gmail.settings.basic";
export const MAIL_SCOPES = [MAIL_SCOPE, SETTINGS_SCOPE] as const;
const MAIL_KEY = "MAILBOX_ENCRYPTION_KEY";
const TRAILING_SLASH_RE = /\/$/;
const HEADER_NEWLINE_RE = /[\r\n]/;

function config() {
  const clientId = process.env.GOOGLE_MAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_MAIL_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!(clientId && clientSecret && appUrl)) {
    throw new Error("GOOGLE_MAIL_CONFIG_MISSING");
  }
  return {
    clientId,
    clientSecret,
    redirectUri: `${appUrl.replace(TRAILING_SLASH_RE, "")}/api/ax-mail/google/callback`,
  };
}

export function mailState(payload: Record<string, unknown>) {
  return signOAuthState(payload, MAIL_KEY);
}

export function parseMailState<T>(state: string): T {
  return verifyOAuthState<T>(state, MAIL_KEY);
}

export function encryptMailToken(token: string) {
  return encryptRefreshToken(token, MAIL_KEY);
}

export function googleMailAuthorizationUrl(state: string): string {
  const { clientId, redirectUri } = config();
  const params = new URLSearchParams({
    access_type: "offline",
    client_id: clientId,
    prompt: "consent",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: MAIL_SCOPES.join(" "),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function responseJson<T>(response: Response, error: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${error}_${response.status}`);
  }
  return (await response.json()) as T;
}

export async function exchangeMailCode(code: string) {
  const { clientId, clientSecret, redirectUri } = config();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });
  return responseJson<{
    access_token: string;
    refresh_token?: string;
    scope?: string;
  }>(response, "MAIL_CODE_EXCHANGE_FAILED");
}

export async function refreshMailAccessToken(encrypted: string) {
  const { clientId, clientSecret } = config();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: decryptRefreshToken(encrypted, MAIL_KEY),
    }),
    cache: "no-store",
  });
  const result = await responseJson<{ access_token: string }>(
    response,
    "MAIL_TOKEN_REFRESH_FAILED"
  );
  return result.access_token;
}

export async function googleMailAddress(accessToken: string) {
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );
  const result = await responseJson<{ emailAddress: string }>(
    response,
    "MAIL_PROFILE_FAILED"
  );
  if (!result.emailAddress?.includes("@")) {
    throw new Error("MAIL_PROFILE_EMAIL_MISSING");
  }
  return result.emailAddress;
}

export interface SenderAlias {
  displayName: string;
  email: string;
  /** 외부 SMTP 로 내보내면 그 호스트(예: smtp.improvmx.com). 없으면 Gmail 서버로 나간다. */
  smtpHost: string | null;
  verified: boolean;
}

/** Gmail 「다른 주소에서 메일 보내기」 목록. 비밀번호 등 SMTP 인증정보는 응답에 없다. */
export async function listSenderAliases(
  accessToken: string
): Promise<SenderAlias[]> {
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );
  const result = await responseJson<{
    sendAs?: {
      displayName?: string;
      isPrimary?: boolean;
      sendAsEmail?: string;
      smtpMsa?: { host?: string };
      verificationStatus?: string;
    }[];
  }>(response, "MAIL_SENDAS_FAILED");
  return (result.sendAs ?? []).flatMap((alias) =>
    alias.sendAsEmail
      ? [
          {
            displayName: alias.displayName ?? "",
            email: alias.sendAsEmail.toLowerCase(),
            smtpHost: alias.smtpMsa?.host ?? null,
            verified:
              alias.isPrimary === true ||
              alias.verificationStatus === "accepted",
          },
        ]
      : []
  );
}

/** 초안 보낸사람이 될 별칭. 등록·인증이 안 됐으면 null — 초안을 만들지 않는다. */
export function findSenderAlias(
  aliases: SenderAlias[],
  email: string
): SenderAlias | null {
  const target = email.toLowerCase();
  return aliases.find((a) => a.email === target && a.verified) ?? null;
}

function encodeHeaderWord(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function foldedBase64(value: string): string {
  return (
    Buffer.from(value, "utf8")
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") ?? ""
  );
}

export function buildRawMail(
  recipient: string,
  subject: string,
  body: string,
  from?: { displayName: string; email: string }
): string {
  if (
    HEADER_NEWLINE_RE.test(recipient) ||
    HEADER_NEWLINE_RE.test(subject) ||
    (from &&
      (HEADER_NEWLINE_RE.test(from.email) ||
        HEADER_NEWLINE_RE.test(from.displayName)))
  ) {
    throw new Error("MAIL_HEADER_INVALID");
  }
  const mime = [
    ...(from
      ? [`From: ${encodeHeaderWord(from.displayName)} <${from.email}>`]
      : []),
    `To: ${recipient}`,
    `Subject: ${encodeHeaderWord(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    foldedBase64(body),
  ].join("\r\n");
  return Buffer.from(mime, "utf8").toString("base64url");
}

/** 서버에는 발송 경로를 두지 않는다. Gmail 보관함에 초안만 생성한다. */
export async function createGoogleDraft(
  accessToken: string,
  recipient: string,
  subject: string,
  body: string,
  from?: { displayName: string; email: string }
): Promise<string> {
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: { raw: buildRawMail(recipient, subject, body, from) },
      }),
      cache: "no-store",
    }
  );
  const result = await responseJson<{ id?: string }>(
    response,
    "MAIL_DRAFT_FAILED"
  );
  if (!result.id) {
    throw new Error("MAIL_DRAFT_ID_MISSING");
  }
  return result.id;
}
