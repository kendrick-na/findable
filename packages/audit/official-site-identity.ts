import { log } from "@repo/observability/log";
import { assertPublicUrl, normalizePublicUrl } from "./public-url-security";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 1_000_000;
/** 푸터 사업자 정보를 찾느라 더 읽는 상한. 넘으면 찾은 데까지로 끝낸다(측정 시간 보호). */
const FOOTER_SEARCH_BYTES = 600_000;
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
  /** 사업자등록번호(000-00-00000). 한국 통신판매 사이트는 푸터 게시가 의무다. */
  businessNumber?: string | null;
  description: string | null;
  finalUrl: string;
  h1: string | null;
  /**
   * 푸터의 상호·회사명(예: 「바이오센서연구소(주)」, 2026-10-05). 브랜드명이 흔한 단어일 때
   * 「같은 회사」임을 가르는 가장 강한 공식 사실이다. 판정 v3 의 근거로만 쓴다.
   */
  legalName?: string | null;
  siteName: string | null;
  title: string | null;
}

const BUSINESS_NUMBER_RE =
  /사업자\s*등록\s*번호\s*[:：]?\s*(\d{3}-\d{2}-\d{5})/;
const LEGAL_NAME_RE =
  /(?:상호(?:명)?|회사명|법인명|업체명)\s*[:：]\s*([^\n|:：]{2,60}?)(?=\s*(?:\||대표|사업자|주소|전화|tel|통신판매|개인정보|이메일|e-?mail|$))/i;
const LEGAL_NAME_MAX_LENGTH = 40;

/** 푸터 사업자 정보 — 보이는 글자에서만 읽는다(주석·스크립트 제외). */
export function extractBusinessInfo(contentHtml: string): {
  businessNumber: string | null;
  legalName: string | null;
} {
  const text = decodeEntities(
    contentHtml
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/span|\/dd|\/dt)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*/g, "\n");
  const legal = text.match(LEGAL_NAME_RE)?.[1]?.trim() ?? "";
  return {
    businessNumber: text.match(BUSINESS_NUMBER_RE)?.[1] ?? null,
    legalName: legal && legal.length <= LEGAL_NAME_MAX_LENGTH ? legal : null,
  };
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
    ...extractBusinessInfo(contentHtml),
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
export async function readIdentityHtml(
  response: Response,
  signal?: AbortSignal
): Promise<string> {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  const cancel = () => {
    reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  // A generic title with no description is insufficient for entity matching.
  // Keep reading the bounded body to find a visible service statement.
  const headUsable = () =>
    HEAD_CLOSED_RE.test(text) &&
    Boolean(
      metaContent(text, "description") || metaContent(text, "og:description")
    ) &&
    Boolean(extractOfficialSiteIdentity(text, ""));
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    // 푸터의 상호·사업자번호(2026-10-05)는 문서 맨 끝에 있다. 설명을 찾은 뒤에도
    //   상호를 찾을 때까지 더 읽되, 그때부터는 FOOTER_SEARCH_BYTES 까지만 읽는다.
    const cap = headUsable() ? FOOTER_SEARCH_BYTES : MAX_RESPONSE_BYTES;
    const chunk = value.subarray(0, Math.max(0, cap - bytes));
    bytes += chunk.byteLength;
    text += decoder.decode(chunk, { stream: true });
    if (
      headUsable() &&
      (bytes >= FOOTER_SEARCH_BYTES ||
        extractBusinessInfo(text.replace(NON_VISIBLE_BLOCK_RE, "")).legalName)
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
  signal?.removeEventListener("abort", cancel);
  return text + decoder.decode();
}

async function fetchHomepage(
  initialUrl: URL,
  parentSignal?: AbortSignal
): Promise<{ html: string; finalUrl: URL }> {
  let current = new URL(initialUrl);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicUrl(current);
    const controller = new AbortController();
    const abortFromParent = () =>
      controller.abort(
        parentSignal?.reason ?? new DOMException("Aborted", "AbortError")
      );
    if (parentSignal?.aborted) {
      abortFromParent();
    } else {
      parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    }
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
      return {
        html: await readIdentityHtml(response, controller.signal),
        finalUrl: current,
      };
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    }
  }
  throw new Error("REDIRECT_FAILED");
}

/**
 * 언급 판정용 공식 엔티티 단서를 홈페이지에서 한 번만 확보한다.
 * 실패 시 null을 반환한다. 호출자는 식별 근거 없이는 측정을 중단한다.
 */
export async function resolveOfficialSiteIdentity(
  domain: string,
  signal?: AbortSignal
): Promise<OfficialSiteIdentity | null> {
  try {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const { html, finalUrl } = await fetchHomepage(
      normalizePublicUrl(domain),
      signal
    );
    const identity = extractOfficialSiteIdentity(html, finalUrl.toString());
    if (!identity) {
      throw new Error("IDENTITY_EMPTY");
    }
    return identity;
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason ?? error;
    }
    log.warn("audit.official_site_identity.failed", {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
