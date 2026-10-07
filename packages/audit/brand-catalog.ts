// 공식몰 제품 목록 — 이름·가격 (2026-10-05, 측정 알고리즘 v3 §2-③·⑥)
//
// 왜: 실제 사람은 「프란츠는 어떤 브랜드야?」보다 「프란츠 앰플 후기」처럼 **제품과 함께** 묻는다.
//   그 제품 이름을 브랜드 스스로 쓰는 표기에서 가져와야 질문이 자연스럽다. 가격은 매출 기회
//   계산의 객단가(AOV) 실측값이다(예전 모델의 임의 5만원 대신).
// 출처는 **브랜드 자신의 공식몰만** 읽는다(robots.txt 의 Disallow 를 지킨다):
//   · Shopify — 공개 `/products.json` (franzskincareusa.com 에서 확인)
//   · 그 밖(Cafe24 등) — `/sitemap.xml` 의 상품 주소 → 상품 페이지의 og:title·product:price 메타
//     (franzskincare.com: 상품 38개, `product:price:amount` 10000 KRW 확인)
// 리뷰·마켓(올리브영·화해·쿠팡)은 약관 확인 전이라 읽지 않는다.

import { log } from "@repo/observability/log";
import { assertPublicUrl, normalizePublicUrl } from "./public-url-security";

export interface CatalogProduct {
  currency: string | null;
  name: string;
  price: number | null;
  url: string;
}

export interface BrandCatalog {
  products: CatalogProduct[];
  source: "shopify" | "sitemap" | "none";
}

const FETCH_TIMEOUT_MS = 8000;
const MAX_PRODUCTS = 40;
const MAX_PRODUCT_PAGES = 15;
const PAGE_CONCURRENCY = 4;
const USER_AGENT =
  "FindableMeasurementBot/1.0 (+https://www.findable.co.kr/ko/contact)";
const PRODUCT_PATH_RE = /\/(?:product|products|goods|shop\/item)s?\//i;
const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
const SITEMAP_INDEX_RE = /<sitemapindex\b/i;
const META_TAG_RE = /<meta\b[^>]*>/gi;
const META_KEY_RE = /(?:name|property)\s*=\s*["']([^"']+)["']/i;
const META_CONTENT_RE = /content\s*=\s*["']([^"']*)["']/i;
const NUMBER_RE = /[^0-9.]/g;
const ROBOTS_COMMENT_RE = /#.*/;
const REGEX_SPECIAL_RE = /[.+?^${}()|[\]\\]/g;

/** robots.txt 의 `User-agent: *` 묶음에서 Disallow 규칙(원문)을 읽는다. */
export function parseRobotsDisallow(robots: string): string[] {
  const out: string[] = [];
  let applies = false;
  for (const raw of robots.split("\n")) {
    const line = raw.replace(ROBOTS_COMMENT_RE, "").trim();
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (!key) {
      continue;
    }
    if (key.toLowerCase() === "user-agent") {
      applies = value === "*";
    } else if (applies && key.toLowerCase() === "disallow" && value) {
      out.push(value);
    }
  }
  return out;
}

/**
 * 표준 robots 규칙: 경로 앞부분 일치, `*` = 아무 글자, 끝의 `$` = 경로 끝.
 * ⚠️ `*` 앞에서 잘라 접두어로 근사하면 `/*board*page=` 가 `/` 가 되어 사이트 전체를 막는다
 *   (franzskincare.com 실측, 2026-10-05).
 */
function robotsRuleRegex(rule: string): RegExp {
  const anchored = rule.endsWith("$");
  const body = (anchored ? rule.slice(0, -1) : rule)
    .split("*")
    .map((part) => part.replace(REGEX_SPECIAL_RE, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export function isAllowedByRobots(path: string, disallow: string[]): boolean {
  return !disallow.some((rule) => rule && robotsRuleRegex(rule).test(path));
}

/** 사이트맵 XML → 상품처럼 보이는 주소(같은 호스트만). */
export function productUrlsFromSitemap(xml: string, host: string): string[] {
  const urls: string[] = [];
  for (const match of xml.matchAll(LOC_RE)) {
    const loc = match[1] ?? "";
    try {
      const url = new URL(loc);
      if (url.host === host && PRODUCT_PATH_RE.test(url.pathname)) {
        urls.push(url.toString());
      }
    } catch {
      /* 잘못된 주소는 건너뛴다 */
    }
  }
  return [...new Set(urls)];
}

function metaMap(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of html.matchAll(META_TAG_RE)) {
    const key = match[0].match(META_KEY_RE)?.[1]?.toLowerCase();
    const content = match[0].match(META_CONTENT_RE)?.[1];
    if (key && content && !out.has(key)) {
      out.set(key, content.trim());
    }
  }
  return out;
}

function toPrice(value: string | undefined): number | null {
  const n = Number((value ?? "").replace(NUMBER_RE, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 상품 페이지 HTML → 이름·가격. og:title 이 없으면 상품으로 보지 않는다. */
export function productFromPage(
  html: string,
  url: string
): CatalogProduct | null {
  const meta = metaMap(html);
  const name = meta.get("og:title") ?? meta.get("product:title");
  if (!name) {
    return null;
  }
  return {
    name,
    price: toPrice(
      meta.get("product:price:amount") ??
        meta.get("product:sale_price:amount") ??
        meta.get("og:price:amount")
    ),
    currency:
      meta.get("product:price:currency") ??
      meta.get("og:price:currency") ??
      null,
    url,
  };
}

interface ShopifyProductsJson {
  products?: Array<{
    handle?: string;
    title?: string;
    variants?: Array<{ price?: string }>;
  }>;
}

/** Shopify 공개 `/products.json` → 이름·가격(통화는 응답에 없어 null). */
export function productsFromShopify(
  json: ShopifyProductsJson,
  origin: string
): CatalogProduct[] {
  return (json.products ?? [])
    .filter((p) => p.title)
    .map((p) => ({
      name: p.title as string,
      price: toPrice(p.variants?.[0]?.price),
      currency: null,
      url: `${origin}/products/${p.handle ?? ""}`,
    }));
}

/** 객단가 근사 — 가격 중앙값(묶음·샘플 같은 극단값에 덜 흔들린다). 같은 통화끼리만. */
export function medianPrice(
  products: CatalogProduct[],
  currency: string
): number | null {
  const prices = products
    .filter((p) => p.price !== null && (p.currency ?? currency) === currency)
    .map((p) => p.price as number)
    .sort((a, b) => a - b);
  if (prices.length === 0) {
    return null;
  }
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2
    ? (prices[mid] as number)
    : ((prices[mid - 1] as number) + (prices[mid] as number)) / 2;
}

export async function fetchPublicText(
  url: URL,
  accept: string,
  signal?: AbortSignal
): Promise<string | null> {
  await assertPublicUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { accept, "user-agent": USER_AGENT },
      redirect: "follow",
      signal: controller.signal,
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** 공식몰 제품 목록. 실패해도 측정을 막지 않는다(빈 목록). */
export async function resolveBrandCatalog(
  domain: string,
  signal?: AbortSignal
): Promise<BrandCatalog> {
  const origin = normalizePublicUrl(domain).origin;
  const host = new URL(origin).host;
  try {
    const robots = await fetchPublicText(
      new URL("/robots.txt", origin),
      "text/plain",
      signal
    );
    const disallow = robots ? parseRobotsDisallow(robots) : [];

    if (isAllowedByRobots("/products.json", disallow)) {
      const raw = await fetchPublicText(
        new URL("/products.json?limit=50", origin),
        "application/json",
        signal
      );
      if (raw) {
        try {
          const products = productsFromShopify(JSON.parse(raw), origin);
          if (products.length > 0) {
            return {
              source: "shopify",
              products: products.slice(0, MAX_PRODUCTS),
            };
          }
        } catch {
          /* Shopify 가 아니다 */
        }
      }
    }

    const sitemap = await fetchPublicText(
      new URL("/sitemap.xml", origin),
      "application/xml,text/xml",
      signal
    );
    if (!sitemap || SITEMAP_INDEX_RE.test(sitemap)) {
      // 사이트맵 색인(하위 사이트맵 목록)은 다음 단계에서 지원한다.
      return { source: "none", products: [] };
    }
    const urls = productUrlsFromSitemap(sitemap, host)
      .filter((url) => isAllowedByRobots(new URL(url).pathname, disallow))
      .slice(0, MAX_PRODUCT_PAGES);
    const products: CatalogProduct[] = [];
    for (let i = 0; i < urls.length; i += PAGE_CONCURRENCY) {
      const pages = await Promise.all(
        urls.slice(i, i + PAGE_CONCURRENCY).map(async (url) => {
          const html = await fetchPublicText(new URL(url), "text/html", signal);
          return html ? productFromPage(html, url) : null;
        })
      );
      products.push(...pages.filter((p): p is CatalogProduct => p !== null));
    }
    return { source: products.length ? "sitemap" : "none", products };
  } catch (error) {
    log.warn("audit.brand_catalog.failed", {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
    return { source: "none", products: [] };
  }
}
