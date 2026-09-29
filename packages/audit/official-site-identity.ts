import { log } from "@repo/observability/log";
import { assertPublicUrl, normalizePublicUrl } from "./public-url-security";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 1_000_000;
const USER_AGENT =
  "FindableMeasurementBot/1.0 (+https://www.findable.co.kr/ko/contact)";
const BODY_PARAGRAPH_RE = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
const META_TAG_RE = /<meta\b[^>]*>/gi;
const META_NAME_RE = /(?:name|property)\s*=\s*["']([^"']+)["']/i;
const META_CONTENT_RE = /content\s*=\s*["']([^"']*)["']/i;
const HEAD_CLOSED_RE = /<\/head\s*>/i;
const SENTENCE_END_RE = /[.!?。！？]/;
const NON_VISIBLE_BLOCK_RE =
  /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

export interface OfficialSiteIdentity {
  description: string | null;
  finalUrl: string;
  h1: string | null;
  siteName: string | null;
  title: string | null;
}

/**
 * Some otherwise public sites return a bot challenge or an empty HTML shell to
 * serverless fetchers. A signed-in customer has already confirmed the domain,
 * name, industry, and market before an organisation measurement is created.
 *
 * This intentionally contains no invented page evidence: callers must expose
 * that it is a registration fallback (`identityGrounded: false`). It is never
 * available to an anonymous/free audit, where that confirmation does not exist.
 */
export function registeredBrandIdentityFallback(input: {
  brandId?: string;
  brandName?: string;
  domain: string;
}): OfficialSiteIdentity | null {
  if (!(input.brandId && input.brandName?.trim())) {
    return null;
  }
  return {
    description: null,
    finalUrl: input.domain,
    h1: null,
    siteName: null,
    title: null,
  };
}

export function extractOfficialSiteIdentity(
  html: string,
  finalUrl: string
): OfficialSiteIdentity | null {
  // A server-rendered template can contain literal HTML-looking strings inside
  // script/style blocks. They are not visible site evidence and must not be
  // accepted as the brand's description or heading.
  const contentHtml = html.replace(NON_VISIBLE_BLOCK_RE, "");
  const identity = {
    finalUrl,
    title: tagText(contentHtml, "title"),
    description:
      metaContent(contentHtml, "description") ??
      metaContent(contentHtml, "og:description") ??
      bodyDescription(contentHtml),
    h1: tagText(contentHtml, "h1"),
    siteName: metaContent(contentHtml, "og:site_name"),
  };
  return identity.title ||
    identity.description ||
    identity.h1 ||
    identity.siteName
    ? identity
    : null;
}

/** A short visible service statement is better evidence than a generic title. */
function bodyDescription(html: string): string | null {
  const visibleHtml = html.replace(NON_VISIBLE_BLOCK_RE, "");
  for (const match of visibleHtml.matchAll(BODY_PARAGRAPH_RE)) {
    const value = plainText(match[1]);
    // Ignore navigation labels and slogan fragments; require a sentence.
    if (
      value.length >= 24 &&
      value.length <= 350 &&
      SENTENCE_END_RE.test(value)
    ) {
      return value.slice(0, 250);
    }
  }
  return null;
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
  for (const match of html.matchAll(META_TAG_RE)) {
    const tag = match[0];
    const name = tag.match(META_NAME_RE)?.[1];
    if (name?.toLowerCase() !== key.toLowerCase()) {
      continue;
    }
    const content = tag.match(META_CONTENT_RE)?.[1] ?? "";
    return plainText(content) || null;
  }
  return null;
}

/** Read only enough of a potentially large homepage to identify its brand. */
export async function readIdentityHtml(response: Response): Promise<string> {
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
    const remaining = MAX_RESPONSE_BYTES - bytes;
    const chunk = value.subarray(0, remaining);
    bytes += chunk.byteLength;
    text += decoder.decode(chunk, { stream: true });
    // A generic title with no description is insufficient for entity matching.
    // Keep reading the bounded body to find a visible service statement.
    if (
      HEAD_CLOSED_RE.test(text) &&
      (metaContent(text, "description") ||
        metaContent(text, "og:description")) &&
      extractOfficialSiteIdentity(text, "")
    ) {
      await reader.cancel().catch(() => undefined);
      return text + decoder.decode();
    }
    if (bytes >= MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      if (extractOfficialSiteIdentity(text, "")) {
        return text + decoder.decode();
      }
      throw new Error("RESPONSE_TOO_LARGE");
    }
  }
  return text + decoder.decode();
}

async function fetchHomepage(
  initialUrl: URL
): Promise<{ html: string; finalUrl: URL }> {
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
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
    try {
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
      const contentType =
        response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("text/html")) {
        throw new Error("NOT_HTML");
      }
      return { html: await readIdentityHtml(response), finalUrl: current };
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("REDIRECT_FAILED");
}

/**
 * 언급 판정용 공식 엔티티 단서를 홈페이지에서 한 번만 확보한다.
 * 실패 시 null을 반환한다. 호출자는 식별 근거 없이는 측정을 중단한다.
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
