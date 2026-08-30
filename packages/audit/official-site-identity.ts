import { log } from "@repo/observability/log";
import { assertPublicUrl, normalizePublicUrl } from "./public-url-security";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 1_000_000;
const USER_AGENT =
  "FindableMeasurementBot/1.0 (+https://www.findable.co.kr/ko/contact)";

export interface OfficialSiteIdentity {
  description: string | null;
  finalUrl: string;
  h1: string | null;
  siteName: string | null;
  title: string | null;
}

export function extractOfficialSiteIdentity(
  html: string,
  finalUrl: string
): OfficialSiteIdentity | null {
  const identity = {
    finalUrl,
    title: tagText(html, "title"),
    description:
      metaContent(html, "description") ?? metaContent(html, "og:description"),
    h1: tagText(html, "h1"),
    siteName: metaContent(html, "og:site_name"),
  };
  return identity.title || identity.description || identity.h1 || identity.siteName
    ? identity
    : null;
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function plainText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function tagText(html: string, tag: string): string | null {
  const match = html.match(
    new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")
  );
  const value = plainText(match?.[1] ?? "");
  return value || null;
}

function metaContent(html: string, key: string): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (name?.toLowerCase() !== key.toLowerCase()) {
      continue;
    }
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    return plainText(content) || null;
  }
  return null;
}

async function readLimitedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("RESPONSE_TOO_LARGE");
  }
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("RESPONSE_TOO_LARGE");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchHomepage(initialUrl: URL): Promise<{ html: string; finalUrl: URL }> {
  let current = new URL(initialUrl);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicUrl(current);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current, {
        cache: "no-store",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": USER_AGENT,
        },
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) {
        throw new Error("REDIRECT_FAILED");
      }
      current = new URL(location, current);
      continue;
    }
    if (!(response.status >= 200 && response.status < 300)) {
      throw new Error(`HTTP_${response.status}`);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html")) {
      throw new Error("NOT_HTML");
    }
    return { html: await readLimitedText(response), finalUrl: current };
  }
  throw new Error("REDIRECT_FAILED");
}

/**
 * 언급 판정용 공식 엔티티 단서를 홈페이지에서 한 번만 확보한다.
 * 실패해도 측정은 계속하되, 로그와 result의 null 값으로 근거 부족을 드러낸다.
 */
export async function resolveOfficialSiteIdentity(
  domain: string
): Promise<OfficialSiteIdentity | null> {
  try {
    const { html, finalUrl } = await fetchHomepage(normalizePublicUrl(domain));
    const identity = extractOfficialSiteIdentity(html, finalUrl.toString());
    if (!identity) {
      throw new Error("IDENTITY_EMPTY");
    }
    return identity;
  } catch (error) {
    log.warn("audit.official_site_identity.failed", {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
