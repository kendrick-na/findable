import { log } from "@repo/observability/log";
import { isAllowedByRobots, parseRobotsDisallow } from "./brand-catalog";
import { assertPublicUrl, normalizePublicUrl } from "./public-url-security";
import { renderSiteHtml, siteRenderStatus } from "./site-render";
import { servicePageUrls } from "./site-structure";

/**
 * 질문 제안용 사이트 프로필(2026-10-14).
 *
 * 왜 따로 두나: `official-site-identity.ts` 는 **판정(언급 여부) 앵커**를 위해 제목·설명·H1·푸터만 얇게 읽고,
 * 설명이 잡히면 바로 읽기를 멈춘다. 질문을 만들려면 사이트가 **무엇을 파는지**(소제목·FAQ·구조화 데이터·본문 첫머리)가
 * 필요한데 그걸 버리고 있었다(실측: 홈페이지에 본문 5천~1만 자가 있어도 질문 생성기는 제목 한 줄만 받았다).
 * 판정·측정 코드는 건드리지 않으려고 이 모듈은 **질문 제안 경로만** 쓴다.
 */

/**
 * 시간 제한은 단계별로 따로 둔다(2026-10-18). 예전엔 홈·robots·사이트맵·서비스 쪽이 **한 개의 8초**를 나눠 썼다 —
 * 홈페이지 한 쪽이 7.8MB(이미지가 글 안에 박힘)라 내려받는 데만 11초가 걸려 전부 포기됐다(진단 ID I-27).
 * 홈은 앞 500KB만 읽고 끊으므로(`readLimitedText`) 큰 페이지도 몇 초 안에 끝난다.
 */
const HOME_TIMEOUT_MS = 8000;
const AUX_TIMEOUT_MS = 4000;
const EXTRA_PAGE_TIMEOUT_MS = 4000;
/** 모든 단계를 합친 상한 — 단계마다 제한이 있어도 전체가 끝없이 늘어나지 않게 한다. */
const OVERALL_TIMEOUT_MS = 16_000;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 500_000;
const USER_AGENT =
  "FindableMeasurementBot/1.0 (+https://www.findable.co.kr/ko/contact)";
/** 눈에 보이는 글자가 이보다 적으면 JS 로 그리는 사이트(또는 차단)로 본다 — 질문이 일반적일 수 있다고 알린다. */
export const THIN_SITE_TEXT_CHARS = 200;
const MAX_HEADINGS = 12;
const MAX_FAQ = 8;
const BODY_SNIPPET_CHARS = 1200;

/** 홈 말고 더 읽는 서비스 소개 페이지 수(사이트맵 기준). */
const MAX_EXTRA_PAGES = 3;
const EXTRA_PAGE_SNIPPET_CHARS = 300;
const MAX_TOTAL_HEADINGS = 16;
const MAX_TOTAL_BODY_CHARS = 2000;
const SITEMAP_INDEX_RE = /<sitemapindex\b/i;

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
  /** 읽은 페이지 수(홈 포함). */
  pagesRead?: number;
  /** 브라우저로 그려서 읽은 결과인가(JS 로 그리는 사이트). */
  rendered?: boolean;
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

/**
 * 응답 본문을 앞 `maxBytes` 만 읽고 **그 자리에서 끊는다**(나머지는 받지 않는다).
 * 예전엔 `arrayBuffer()` 로 통째로 받은 뒤 잘라서, 7.8MB 페이지는 시간 제한 안에 끝나지 않았다.
 * 본문 스트림이 없으면(테스트·특수 응답) 기존처럼 통째로 읽고 자른다.
 */
export async function readLimitedText(
  response: {
    arrayBuffer(): Promise<ArrayBuffer>;
    body: { getReader(): ReadableStreamDefaultReader<Uint8Array> } | null;
  },
  maxBytes: number
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    return new TextDecoder().decode(buffer.slice(0, maxBytes));
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) {
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const merged = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const room = merged.byteLength - offset;
    if (room <= 0) {
      break;
    }
    merged.set(chunk.subarray(0, room), offset);
    offset += Math.min(chunk.byteLength, room);
  }
  return new TextDecoder().decode(merged);
}

async function fetchText(
  initial: URL,
  signal: AbortSignal,
  kind: "html" | "text"
): Promise<string> {
  let current = initial;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      cache: "no-store",
      headers: {
        accept:
          kind === "html"
            ? "text/html,application/xhtml+xml"
            : "text/plain,application/xml,text/xml",
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
      kind === "html" &&
      !(response.headers.get("content-type")?.toLowerCase() ?? "").includes(
        "text/html"
      )
    ) {
      throw new Error("NOT_HTML");
    }
    return await readLimitedText(response, MAX_BYTES);
  }
  throw new Error("REDIRECT_FAILED");
}

const orNull = async (task: Promise<string>): Promise<string | null> =>
  await task.catch(() => null);

/** 단계별 제한(`ms`)과 전체 상한(`overall`) 중 먼저 오는 쪽에서 멈추는 신호. */
function stageSignal(ms: number, overall: AbortSignal): AbortSignal {
  return AbortSignal.any([AbortSignal.timeout(ms), overall]);
}

/** 홈 프로필에 서비스 페이지 프로필을 합친다(순수). 글자 수 상한을 지킨다. */
export function mergeSiteProfiles(
  home: SiteProfile,
  extras: readonly SiteProfile[]
): SiteProfile {
  const uniq = (items: string[], max: number) =>
    [...new Set(items)].slice(0, max);
  const bodySnippet = [
    home.bodySnippet,
    ...extras.map((p) =>
      [p.h1 ?? p.title, p.bodySnippet.slice(0, EXTRA_PAGE_SNIPPET_CHARS)]
        .filter(Boolean)
        .join(": ")
    ),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TOTAL_BODY_CHARS);
  return {
    ...home,
    headings: uniq(
      [
        ...home.headings,
        ...extras.flatMap((p) => [p.h1 ?? "", ...p.headings]),
      ].filter(Boolean),
      MAX_TOTAL_HEADINGS
    ),
    faq: uniq([...home.faq, ...extras.flatMap((p) => p.faq)], MAX_FAQ),
    jsonLdFacts: uniq(
      [...home.jsonLdFacts, ...extras.flatMap((p) => p.jsonLdFacts)],
      MAX_HEADINGS
    ),
    bodySnippet,
    pagesRead: 1 + extras.length,
    thin: bodySnippet.replace(SPACE_RE, "").length < THIN_SITE_TEXT_CHARS,
  };
}

/** apex ↔ www 짝 주소(예: starbucks.co.kr 은 www 로만 열린다). */
export function alternateOrigin(origin: string): string {
  const url = new URL(origin);
  url.hostname = url.hostname.startsWith("www.")
    ? url.hostname.slice(4)
    : `www.${url.hostname}`;
  return url.origin;
}

/** 홈을 읽는다. 연결 자체가 안 되면(주소 해석 실패 등) apex ↔ www 짝 주소로 한 번 더 시도한다. */
async function fetchHome(
  origin: string,
  overall: AbortSignal
): Promise<{ html: string; origin: string }> {
  try {
    return {
      html: await fetchText(
        new URL("/", origin),
        stageSignal(HOME_TIMEOUT_MS, overall),
        "html"
      ),
      origin,
    };
  } catch (error) {
    const alt = alternateOrigin(origin);
    try {
      return {
        html: await fetchText(
          new URL("/", alt),
          stageSignal(HOME_TIMEOUT_MS, overall),
          "html"
        ),
        origin: alt,
      };
    } catch {
      throw error;
    }
  }
}

/**
 * 질문 제안용으로 사이트를 읽는다: 홈 + 사이트맵의 서비스 소개 페이지 최대 3쪽(robots.txt 금지 경로는 읽지 않는다).
 * 실패·시간 초과·robots 로 홈이 막힌 경우는 null(제안을 막지 않는다).
 */
export async function readSiteProfile(
  domain: string
): Promise<SiteProfile | null> {
  try {
    const requested = normalizePublicUrl(domain).origin;
    const overall = AbortSignal.timeout(OVERALL_TIMEOUT_MS);
    const { html: homeHtml, origin } = await fetchHome(requested, overall);
    const [robots, sitemap] = await Promise.all([
      orNull(
        fetchText(
          new URL("/robots.txt", origin),
          stageSignal(AUX_TIMEOUT_MS, overall),
          "text"
        )
      ),
      orNull(
        fetchText(
          new URL("/sitemap.xml", origin),
          stageSignal(AUX_TIMEOUT_MS, overall),
          "text"
        )
      ),
    ]);
    const disallow = robots ? parseRobotsDisallow(robots) : [];
    if (!isAllowedByRobots("/", disallow)) {
      log.warn("audit.site_profile.robots_blocked", { domain });
      return null;
    }
    let home = extractSiteProfile(homeHtml);
    // 일반 읽기로 글자가 거의 없으면(JS 로 그리는 사이트) 브라우저로 그려 한 번 더 읽는다(꺼져 있으면 건너뜀).
    if (home.thin) {
      const renderStatus = siteRenderStatus();
      if (renderStatus !== "enabled") {
        // 운영은 켜져 있는데 로컬 측정은 꺼져 있던 불일치를 로그에서 바로 찾게 한다(진단 ID I-05).
        log.info("audit.site_profile.thin_without_render", {
          domain,
          renderStatus,
        });
      }
      const rendered = await renderSiteHtml(origin);
      if (rendered) {
        const renderedProfile = extractSiteProfile(rendered);
        if (
          !renderedProfile.thin ||
          renderedProfile.bodySnippet.length > home.bodySnippet.length
        ) {
          home = { ...renderedProfile, rendered: true };
        }
      }
    }
    if (!sitemap || SITEMAP_INDEX_RE.test(sitemap)) {
      return { ...home, pagesRead: 1 };
    }
    const host = new URL(origin).host;
    const urls = servicePageUrls(sitemap, host)
      .ko.filter((url) => isAllowedByRobots(new URL(url).pathname, disallow))
      .slice(0, MAX_EXTRA_PAGES);
    const pages = await Promise.all(
      urls.map((url) =>
        orNull(
          fetchText(
            new URL(url),
            stageSignal(EXTRA_PAGE_TIMEOUT_MS, overall),
            "html"
          )
        )
      )
    );
    return mergeSiteProfiles(
      home,
      pages.flatMap((html) => (html ? [extractSiteProfile(html)] : []))
    );
  } catch (error) {
    log.warn("audit.site_profile.failed", {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
