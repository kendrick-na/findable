import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

function key(): Buffer {
  const value = process.env.SEARCH_PERFORMANCE_ENCRYPTION_KEY;
  if (!value) {
    throw new Error("SEARCH_PERFORMANCE_ENCRYPTION_KEY_MISSING");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) {
    throw new Error("SEARCH_PERFORMANCE_ENCRYPTION_KEY_INVALID");
  }
  return decoded;
}

export function encryptRefreshToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decryptRefreshToken(value: string): string {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!(ivValue && tagValue && encryptedValue)) {
    throw new Error("REFRESH_TOKEN_INVALID");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(ivValue, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function signOAuthState(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", key())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyOAuthState<T>(state: string): T {
  const [encoded, supplied] = state.split(".");
  if (!(encoded && supplied)) {
    throw new Error("OAUTH_STATE_INVALID");
  }
  const expected = createHmac("sha256", key()).update(encoded).digest();
  const actual = Buffer.from(supplied, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("OAUTH_STATE_INVALID");
  }
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
}
