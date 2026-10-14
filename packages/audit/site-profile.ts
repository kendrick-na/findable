import { log } from "@repo/observability/log";
import { assertPublicUrl, normalizePublicUrl } from "./public-url-security";

/**
 * 질문 제안용 사이트 프로필(2026-10-14).
 *
 * 왜 따로 두나: `official-site-identity.ts` 는 **판정(언급 여부) 앵커**를 위해 제목·설명·H1·푸터만 얇게 읽고,
 * 설명이 잡히면 바로 읽기를 멈춘다. 질문을 만들려면 사이트가 **무엇을 파는지**(소제목·FAQ·구조화 데이터·본문 첫머리)가
 * 필요한데 그걸 버리고 있었다(실측: 홈페이지에 본문 5천~1만 자가 있어도 질문 생성기는 제목 한 줄만 받았다).
 * 판정·측정 코드는 건드리지 않으려고 이 모듈은 **질문 제안 경로만** 쓴다.
 */

const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 500_000;
const USER_AGENT =
  "FindableMeasurementBot/1.0 (+https://www.findable.co.kr/ko/contact)";
/** 눈에 보이는 글자가 이보다 적으면 JS 로 그리는 사이트(또는 차단)로 본다 — 질문이 일반적일 수 있다고 알린다. */
export const THIN_SITE_TEXT_CHARS = 200;
const MAX_HEADINGS = 12;
const MAX_FAQ = 8;
const BODY_SNIPPET_CHARS = 1200;

export interface SiteProfile {
  /** 본문 첫머리(눈에 보이는 글자). */
  bodySnippet: string;
  description: string | null;
  /** 구조화 데이터(JSON-LD)에 적힌 질문(FAQPage). */
  faq: string[];
  h1: string | null;
  /** h2·h3 소제목. */
  headings: string[];
  /** JSON-LD 의 Organization·Product·Service 이름/설명 조각. */
  jsonLdFacts: string[];
  siteName: string | null;
  /** 눈에 보이는 글자가 거의 없다(JS 렌더링·차단 의심). */
  thin: boolean;
  title: string | null;
}

const NON_VISIBLE_RE = /<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const TAG_RE = /<[^>]+>/g;
const SPACE_RE = /\s+/g;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const H1_RE = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i;
const HEADING_RE = /<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi;
const META_RE = /<meta\b[^>]*>/gi;
const META_KEY_RE = /(?:name|property)\s*=\s*["']([^"']+)["']/i;
const META_VALUE_RE = /content\s*=\s*["']([^"']*)["']/i;
const JSON_LD_RE =
  /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const NAV_BLOCK_RE = /<(nav|header|footer)\b[\s\S]*?<\/\1\s*>/gi;

const decode = (value: string) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ");

const plain = (html: string) =>
  decode(html.replace(TAG_RE, " ")).replace(SPACE_RE, " ").trim();

function metaContent(html: string, key: string): string | null {
  for (const tag of html.match(META_RE) ?? []) {
    if (META_KEY_RE.exec(tag)?.[1]?.toLowerCase() === key) {
      return plain(META_VALUE_RE.exec(tag)?.[1] ?? "") || null;
    }
  }
  return null;
}

function headingsOf(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(HEADING_RE)) {
    const text = plain(match[1] ?? "");
    if (text.length >= 4 && text.length <= 80 && !out.includes(text)) {
      out.push(text);
    }
    if (out.length >= MAX_HEADINGS) {
      break;
    }
  }
  return out;
}

const FACT_TYPES = new Set([
  "organization",
  "product",
  "service",
  "localbusiness",
  "corporation",
]);

function collectJsonLd(node: unknown, facts: string[], faq: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectJsonLd(item, facts, faq);
    }
    return;
  }
  if (!node || typeof node !== "object") {
    return;
  }
  const record = node as Record<string, unknown>;
  const rawType = record["@type"];
  const types = (Array.isArray(rawType) ? rawType : [rawType])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.toLowerCase());
  if (types.some((t) => FACT_TYPES.has(t))) {
    for (const key of ["name", "description"]) {
      const value = record[key];
      if (
        typeof value === "string" &&
        value.trim() &&
        facts.length < MAX_HEADINGS
      ) {
        facts.push(plain(value).slice(0, 200));
      }
    }
  }
  if (
    types.includes("question") &&
    typeof record.name === "string" &&
    faq.length < MAX_FAQ
  ) {
    faq.push(plain(record.name).slice(0, 160));
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      collectJsonLd(value, facts, faq);
    }
  }
}

/** HTML → 질문 재료. 순수 함수(네트워크 없음). */
export function extractSiteProfile(html: string): SiteProfile {
  const clean = html.replace(COMMENT_RE, " ");
  const facts: string[] = [];
  const faq: string[] = [];
  for (const match of clean.matchAll(JSON_LD_RE)) {
    try {
      collectJsonLd(JSON.parse(match[1] ?? ""), facts, faq);
    } catch {
      // 깨진 JSON-LD 는 건너뛴다.
    }
  }
  const visible = clean.replace(NON_VISIBLE_RE, " ");
  const main = visible.replace(NAV_BLOCK_RE, " ");
  const bodyText = plain(main);
  const title = TITLE_RE.exec(visible)?.[1];
  const h1 = H1_RE.exec(main)?.[1];
  return {
    title: title ? plain(title) || null : null,
    description:
      metaContent(clean, "description") ?? metaContent(clean, "og:description"),
    h1: h1 ? plain(h1) || null : null,
    siteName: metaContent(clean, "og:site_name"),
    headings: headingsOf(main),
    faq,
    jsonLdFacts: [...new Set(facts)],
    bodySnippet: bodyText.slice(0, BODY_SNIPPET_CHARS),
    thin: bodyText.length < THIN_SITE_TEXT_CHARS,
  };
}

async function fetchHtml(initial: URL, signal: AbortSignal): Promise<string> {
  let current = initial;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      cache: "no-store",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": USER_AGENT,
      },
      redirect: "manual",
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("REDIRECT_FAILED");
      }
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }
    if (
      !(response.headers.get("content-type")?.toLowerCase() ?? "").includes(
        "text/html"
      )
    ) {
      throw new Error("NOT_HTML");
    }
    const buffer = await response.arrayBuffer();
    return new TextDecoder().decode(buffer.slice(0, MAX_BYTES));
  }
  throw new Error("REDIRECT_FAILED");
}

/** 질문 제안용으로 사이트를 한 번 읽는다. 실패·시간 초과면 null(제안을 막지 않는다). */
export async function readSiteProfile(
  domain: string
): Promise<SiteProfile | null> {
  try {
    const html = await fetchHtml(
      normalizePublicUrl(domain),
      AbortSignal.timeout(FETCH_TIMEOUT_MS)
    );
    return extractSiteProfile(html);
  } catch (error) {
    log.warn("audit.site_profile.failed", {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
