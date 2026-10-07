// 서비스·B2B 사이트 구조 → 프로필 재료 (2026-10-07, 질문 체계 v2 A1)
//
// 왜: 쇼핑몰이 아닌 사이트(컨설팅·SaaS·교육·병원)는 상품 목록이 없다. 대신 사이트가 스스로
//   붙인 **서비스 이름**이 메뉴·서비스 페이지 제목·소제목에 있다(노우버스: 「AI 기술실사(TechDD)」
//   「CTO 구독」「AX / DX 컨설팅」「AI 강의」). 그 이름을 그대로 읽는다(번역·요약·추측 없음).
//
// 읽는 곳(브랜드 자신의 사이트만, robots.txt Disallow 준수)
//   · 홈페이지 — <title>·<h1> 조각, <nav>/<header> 메뉴 글자, <h3> 소제목
//   · sitemap.xml 의 서비스성 주소(service·solution·program·course …) 최대 6쪽 — 제목 첫 조각 + h1·h3
//   · 영어 대체 페이지(/en/, hreflang=en) 최대 3쪽 — 미국 질문 재료(lang: "en")
// 실패해도 측정을 막지 않는다(빈 목록).

import { log } from "@repo/observability/log";
import {
  fetchPublicText,
  isAllowedByRobots,
  parseRobotsDisallow,
} from "./brand-catalog";
import type { ProfileOffering } from "./brand-profile";
import { normalizePublicUrl } from "./public-url-security";

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const HEADING_RE = /<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi;
const NAV_BLOCK_RE = /<(nav|header)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const ANCHOR_TEXT_RE = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
const TAG_RE = /<[^>]+>/g;
const NON_VISIBLE_RE =
  /<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const ENTITY_RE = /&(amp|lt|gt|quot|#39|apos|nbsp);/g;
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};
const SPACE_RE = /\s+/g;
// 「/」는 나누지 않는다(「AX/DX 컨설팅」은 한 이름). 「·」「,」「|」「—」는 목록 구분.
const SEGMENT_SPLIT_RE = /\s*[|·•—–:,]\s*|\s+-\s+/;
const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
const HREFLANG_EN_RE =
  /<(?:xhtml:)?link\b[^>]*hreflang=["']en[^"']*["'][^>]*href=["']([^"']+)["']/gi;
const SITEMAP_INDEX_RE = /<sitemapindex\b/i;
const SERVICE_PATH_RE =
  /(service|solution|product|business|program|course|lecture|class|menu|treatment|clinic|portfolio|platform|feature|consult|offer|what-we-do)/i;
const EXCLUDED_PATH_RE =
  /(apply|checkout|cart|login|signin|signup|join|mypage|account|privacy|terms|policy|notice|board|faq|support|contact|search|tag|blog|news|event)/i;
const EN_PATH_RE = /\/en(?:[/-]|$)/i;
const SENTENCE_END_RE = /(다|요|죠|까|니다)[.!?]?$|[.!?…]$/;
// 끝이 목적격·처소격 조사거나 쉼표면 문장 조각이다(「기술의 진짜 실력을,」「월 100만원에」).
//   「의·가·과·고」로 끝나는 명사(강의·전문가·효과·광고)가 많아 그 조사는 보지 않는다.
const PARTICLE_END_RE = /(을|를|에|에서|으로|부터|까지|하는|하고|하며)$|[,，]$/;
const GENERIC_NAV = new Set(
  [
    "홈",
    "home",
    "회사소개",
    "소개",
    "about",
    "aboutus",
    "company",
    "서비스",
    "services",
    "service",
    "문의",
    "문의하기",
    "contact",
    "contactus",
    "고객센터",
    "고객지원",
    "support",
    "로그인",
    "login",
    "회원가입",
    "signup",
    "공지사항",
    "notice",
    "뉴스",
    "news",
    "블로그",
    "blog",
    "faq",
    "자주묻는질문",
    "이용약관",
    "개인정보처리방침",
    "채용",
    "careers",
    "더보기",
    "바로가기",
    "자세히보기",
    "전체보기",
    "서비스전체보기",
    "메뉴",
    "menu",
    "검색",
    "search",
    "장바구니",
    "cart",
    "마이페이지",
    "인사이트",
    "insights",
    "온라인문의",
    "english",
    "한국어",
    "ko",
    "en",
    "kor",
    "eng",
    // 쇼핑몰 계정·주문 메뉴(Cafe24 등)
    "주문조회",
    "적립금",
    "예치금",
    "마이쿠폰",
    "쿠폰",
    "관심상품",
    "내게시글",
    "멤버십",
    "이벤트",
    "커뮤니티",
    "브랜드",
    "모든제품",
    "전체상품",
    "신상품",
    "베스트",
    "best",
    "new",
    "shop",
    "shopall",
    "magazine",
    "매거진",
    "q&a",
    "qa",
    "review",
    "리뷰",
    "howtouse",
    "worldshipping",
    "shipping",
    "배송",
    "메뉴명",
    "하위메뉴명",
    "vip관",
  ].map((v) => v.toLowerCase())
);
// 서비스 페이지의 단락 제목(「TechDD의 특징」「주요 대상」「진행 형태」) — 서비스 이름이 아니다.
const SECTION_WORD_RE =
  /(특징|대상|형태|강점|장점|주제|경험|판단|소개|사례|후기|문의|절차|프로세스|정보|안내|하기|요금제?|가격|비용|faq|benefits?|features?|overview|process|pricing|about|who|why|how)$/i;
const PRICE_RE = /\d[\d,]*\s*(원|만원|억|\$|usd|krw)|[₩$~]/i;
const YEARS_RE = /\d+\s*(년|years?)/i;
const TEMPLATE_RE = /[{}<>#]/;
const NUMBERED_RE = /\d{2,}[-.)]\d/;
const HANGUL_RE = /[가-힣]/;
const WWW_RE = /^www\./;
// 영어 문장 조각(「Who it's for」「with zero data leakage」「Verify real technical strength」).
const EN_SENTENCE_WORD_RE =
  /\b(with|what|who|why|how|makes|your|our|you|we|it's|is|are|to|verify|tailored|for|get|let|see|learn|more)\b/i;
const EN_NAME_START_RE = /^[A-Z0-9]/;
// 서비스 목록 페이지(「/service.html」「/services/」) — 그 페이지의 h3 가 서비스 이름이다.
const SERVICE_LIST_PATH_RE =
  /^\/(?:en\/)?(?:services?|solutions?|products?|programs?|business|what-we-do)(?:\.html?|\/)?$/i;
const MIN_NAME = 2;
const MAX_NAME = 30;
const MAX_WORDS = 5;
const MAX_SERVICE_PAGES = 6;
const MAX_EN_PAGES = 3;
const MAX_OFFERINGS = 30;

function decode(value: string): string {
  return value
    .replace(TAG_RE, " ")
    .replace(ENTITY_RE, (_m, name: string) => ENTITIES[name] ?? " ")
    .replace(SPACE_RE, " ")
    .trim();
}

const compactKey = (value: string) =>
  value.toLowerCase().replace(/[\s\-_.,·|/()]+/g, "");

function containsAnyName(value: string, names: readonly string[]): boolean {
  const key = compactKey(value);
  return names.some((n) => {
    const k = compactKey(n);
    return k.length >= 2 && key.includes(k);
  });
}

/** 서비스·상품 「이름」처럼 보이는가(문장·메뉴 공통어·브랜드 단독 제외). */
export function isOfferingName(
  value: string,
  brandNames: readonly string[]
): boolean {
  const v = value.trim();
  const key = compactKey(v);
  if (
    v.length < MIN_NAME ||
    v.length > MAX_NAME ||
    v.split(" ").length > MAX_WORDS ||
    GENERIC_NAV.has(key) ||
    SENTENCE_END_RE.test(v) ||
    PARTICLE_END_RE.test(v) ||
    SECTION_WORD_RE.test(v) ||
    PRICE_RE.test(v) ||
    YEARS_RE.test(v) ||
    TEMPLATE_RE.test(v) ||
    NUMBERED_RE.test(v)
  ) {
    return false;
  }
  if (
    !HANGUL_RE.test(v) &&
    (!EN_NAME_START_RE.test(v) || EN_SENTENCE_WORD_RE.test(v))
  ) {
    return false;
  }
  // 브랜드 이름만 있는 조각은 이름이 아니다(브랜드 + 서비스는 프로필이 이름을 떼고 쓴다).
  const withoutBrand = brandNames.reduce(
    (acc, n) => (n.trim().length >= 2 ? acc.split(n).join(" ") : acc),
    v
  );
  return compactKey(withoutBrand).length >= MIN_NAME;
}

function segmentsOf(text: string): string[] {
  return text
    .split(SEGMENT_SPLIT_RE)
    .map((s) => s.replace(SPACE_RE, " ").trim())
    .filter(Boolean);
}

export interface PageOfferingsInput {
  brandNames: readonly string[];
  html: string;
  /** home = 홈페이지(제목 조각·h1·h3·메뉴), service = 서비스 페이지(제목 첫 조각·h1·h3). */
  kind: "home" | "service";
  lang: "ko" | "en";
  /** 서비스 목록 페이지(h3 = 서비스 이름). */
  listPage?: boolean;
  url: string;
}

/** 한 페이지 HTML → 서비스·상품 이름 후보(순수 함수). */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: title, headings and menu rules differ per page kind and stay side by side for review.
export function extractPageOfferings(
  input: PageOfferingsInput
): ProfileOffering[] {
  const html = input.html.replace(NON_VISIBLE_RE, " ");
  const out: ProfileOffering[] = [];
  const add = (name: string, source: ProfileOffering["source"]) => {
    const clean = name.replace(SPACE_RE, " ").trim();
    if (isOfferingName(clean, input.brandNames)) {
      out.push({ name: clean, lang: input.lang, source, url: input.url });
    }
  };
  const title = decode(html.match(TITLE_RE)?.[1] ?? "");
  const titleSegments = segmentsOf(title);
  if (input.kind === "home") {
    // 제목에 브랜드 조각이 있을 때만 나머지 조각을 서비스 이름으로 읽는다(슬로건 제목 배제).
    if (
      titleSegments.length >= 2 &&
      titleSegments.some((s) => containsAnyName(s, input.brandNames))
    ) {
      for (const seg of titleSegments) {
        if (!containsAnyName(seg, input.brandNames)) {
          add(seg, "site_title");
        }
      }
    }
  } else {
    const first = titleSegments.find(
      (s) => !containsAnyName(s, input.brandNames)
    );
    if (first) {
      add(first, "service_page");
    }
  }
  for (const match of html.matchAll(HEADING_RE)) {
    const level = (match[1] ?? "").toLowerCase();
    const text = decode(match[2] ?? "");
    if (level === "h2") {
      continue; // h2 는 대개 홍보 문구다.
    }
    if (level === "h3" && input.kind === "service" && !input.listPage) {
      continue; // 서비스 상세 페이지의 h3 는 단락 제목(특징·대상·진행 형태)이다.
    }
    const parts =
      level === "h1"
        ? segmentsOf(text).filter((s) => !containsAnyName(s, input.brandNames))
        : [text];
    for (const part of parts) {
      // 서비스 페이지 소제목에 브랜드·사람 이름이 섞인 것(「문근영 Knowverse CTO-as-a-Service」)은 뺀다.
      if (input.kind === "service" && containsAnyName(part, input.brandNames)) {
        continue;
      }
      add(part, input.kind === "service" ? "service_page" : "site_heading");
    }
  }
  if (input.kind === "home") {
    for (const block of html.matchAll(NAV_BLOCK_RE)) {
      for (const anchor of (block[2] ?? "").matchAll(ANCHOR_TEXT_RE)) {
        add(decode(anchor[1] ?? ""), "site_nav");
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((o) => {
    const key = compactKey(o.name);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** 사이트맵에서 서비스성 페이지 주소를 고른다(같은 호스트, 신청·결제·게시판 제외). */
export function servicePageUrls(
  sitemapXml: string,
  host: string
): { en: string[]; ko: string[] } {
  const ko: string[] = [];
  const en = new Set<string>();
  for (const match of sitemapXml.matchAll(LOC_RE)) {
    try {
      const url = new URL(match[1] ?? "");
      const bareHost = (h: string) => h.replace(WWW_RE, "");
      if (bareHost(url.host) !== bareHost(host)) {
        continue;
      }
      const path = url.pathname;
      if (!SERVICE_PATH_RE.test(path) || EXCLUDED_PATH_RE.test(path)) {
        continue;
      }
      if (EN_PATH_RE.test(path)) {
        en.add(url.toString());
      } else if (!ko.includes(url.toString())) {
        ko.push(url.toString());
      }
    } catch {
      /* 잘못된 주소는 건너뛴다 */
    }
  }
  for (const match of sitemapXml.matchAll(HREFLANG_EN_RE)) {
    try {
      const url = new URL(match[1] ?? "");
      if (
        SERVICE_PATH_RE.test(url.pathname) &&
        !EXCLUDED_PATH_RE.test(url.pathname)
      ) {
        en.add(url.toString());
      }
    } catch {
      /* skip */
    }
  }
  return { ko, en: [...en] };
}

export interface SiteStructure {
  offerings: ProfileOffering[];
  pagesRead: number;
  source: "site" | "none";
}

/** 공식 사이트 구조 → 서비스·상품 이름. 실패해도 빈 목록. */
export async function resolveSiteStructure(
  domain: string,
  brandNames: readonly string[],
  signal?: AbortSignal
): Promise<SiteStructure> {
  try {
    const origin = normalizePublicUrl(domain).origin;
    const host = new URL(origin).host;
    const [robots, home, sitemap] = await Promise.all([
      fetchPublicText(new URL("/robots.txt", origin), "text/plain", signal),
      fetchPublicText(new URL("/", origin), "text/html", signal),
      fetchPublicText(
        new URL("/sitemap.xml", origin),
        "application/xml,text/xml",
        signal
      ),
    ]);
    const disallow = robots ? parseRobotsDisallow(robots) : [];
    const offerings: ProfileOffering[] = [];
    let pagesRead = 0;
    if (home) {
      pagesRead += 1;
      offerings.push(
        ...extractPageOfferings({
          html: home,
          url: origin,
          kind: "home",
          lang: "ko",
          brandNames,
        })
      );
    }
    if (sitemap && !SITEMAP_INDEX_RE.test(sitemap)) {
      const { ko, en } = servicePageUrls(sitemap, host);
      const allowed = (url: string) =>
        isAllowedByRobots(new URL(url).pathname, disallow);
      const pages = [
        ...ko
          .filter(allowed)
          .slice(0, MAX_SERVICE_PAGES)
          .map((url) => ({ url, lang: "ko" as const })),
        ...en
          .filter(allowed)
          .slice(0, MAX_EN_PAGES)
          .map((url) => ({ url, lang: "en" as const })),
      ];
      const htmls = await Promise.all(
        pages.map((p) => fetchPublicText(new URL(p.url), "text/html", signal))
      );
      for (const [i, html] of htmls.entries()) {
        const page = pages[i];
        if (html && page) {
          pagesRead += 1;
          offerings.push(
            ...extractPageOfferings({
              html,
              url: page.url,
              kind: "service",
              lang: page.lang,
              listPage: SERVICE_LIST_PATH_RE.test(new URL(page.url).pathname),
              brandNames,
            })
          );
        }
      }
    }
    const seen = new Set<string>();
    const unique = offerings.filter((o) => {
      const key = `${o.lang}|${compactKey(o.name)}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    return {
      source: unique.length > 0 ? "site" : "none",
      offerings: unique.slice(0, MAX_OFFERINGS),
      pagesRead,
    };
  } catch (error) {
    log.warn("audit.site_structure.failed", {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
    return { source: "none", offerings: [], pagesRead: 0 };
  }
}
