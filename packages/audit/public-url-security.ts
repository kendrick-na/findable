import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost"];
const ALLOWED_PORTS = new Set(["", "80", "443"]);
const IPV6_LINK_LOCAL_RE = /^fe[89ab]/;
const HTTP_PROTOCOL_RE = /^https?:\/\//i;
const TRAILING_DOT_RE = /\.$/;

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts;
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? address;
  const ipv4 = parseIpv4(normalized);
  if (ipv4) {
    const [a = 0, b = 0] = ipv4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (isIP(normalized) === 6) {
    if (normalized.startsWith("::ffff:")) {
      return isPrivateAddress(normalized.slice("::ffff:".length));
    }
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      IPV6_LINK_LOCAL_RE.test(normalized) ||
      normalized.startsWith("2001:db8:")
    );
  }

  return true;
}

export function normalizePublicUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("URL_REQUIRED");
  }
  const withProtocol = HTTP_PROTOCOL_RE.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("URL_INVALID");
  }

  if (!(url.protocol === "https:" || url.protocol === "http:")) {
    throw new Error("URL_PROTOCOL");
  }
  if (url.username || url.password || !ALLOWED_PORTS.has(url.port)) {
    throw new Error("URL_UNSAFE");
  }
  url.hash = "";
  return url;
}

export async function assertPublicUrl(url: URL): Promise<void> {
  if (!(url.protocol === "https:" || url.protocol === "http:")) {
    throw new Error("URL_PROTOCOL");
  }
  if (url.username || url.password || !ALLOWED_PORTS.has(url.port)) {
    throw new Error("URL_UNSAFE");
  }

  const hostname = url.hostname.toLowerCase().replace(TRAILING_DOT_RE, "");
  if (
    hostname === "localhost" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error("URL_PRIVATE");
  }

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error("URL_PRIVATE");
    }
    return;
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("URL_DNS");
  }
  if (
    records.length === 0 ||
    records.some((record) => isPrivateAddress(record.address))
  ) {
    throw new Error("URL_PRIVATE");
  }
}
