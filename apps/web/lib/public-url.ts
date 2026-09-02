import { env } from "@/env";

/**
 * 공개 URL 조립을 **한 곳**에 모은다.
 *
 * 🔴 **왜 필요한가**(2026-09-02): 같은 글이 두 호스트에 뜬다 —
 *   ① 우리 도메인 `www.findable.co.kr/{locale}/p/{퍼블리셔}/{글}`
 *   ② 고객 커스텀 도메인 `{고객도메인}/p/{글}` (프록시 rewrite)
 *   그런데 양쪽 페이지가 **각자 자기 자신을 canonical 로 신고**하고 있었다(실측 2026-09-02).
 *   = 검색엔진·AI 크롤러에게 동일 콘텐츠가 서로 무관한 두 원본으로 보인다(중복).
 *   사이트맵·RSS·뉴스 사이트맵도 각자 URL 을 조립하고 있어서 규칙이 **네 곳에 흩어져** 있었다.
 *   → 정본 판정은 이 파일만 고치면 전부 따라오게 한다.
 */

const protocol = process.env.NODE_ENV === "production" ? "https" : "http";

/** 우리 도메인 origin. */
export const SITE_ORIGIN = `${protocol}://${env.VERCEL_PROJECT_PRODUCTION_URL ?? "www.findable.co.kr"}`;

/**
 * 🟡 **정본 호스트 정책** — 커스텀 도메인을 연결한 퍼블리셔의 글은 어느 호스트를 원본으로 볼 것인가.
 *
 * - `"custom-domain"`(현재): 고객이 도메인을 연결했다면 **고객 도메인이 정본**.
 *   근거 = 제품 목적이 "고객 브랜드가 AI 답변에 인용되는 것"이라, 인용 링크가 고객 자산으로 가야 한다.
 *   커스텀 도메인 SaaS(뉴스레터·CMS 계열)의 표준 동작과도 같다.
 * - `"findable"`: 우리 도메인에 신호를 모은다(신생 도메인 권위 축적에 유리).
 *
 * ⚠️ 바꾸면 canonical 방향이 뒤집힌다. 이미 색인된 뒤에 뒤집으면 회복에 수 주가 걸리므로
 *   **고객에게 커스텀 도메인을 안내하기 전에** 확정할 것. 커스텀 도메인이 `active` 인
 *   퍼블리셔에게만 영향이 있다(연결 안 한 퍼블리셔는 어느 값이든 우리 도메인이 정본).
 */
const CANONICAL_HOST_POLICY: "custom-domain" | "findable" = "custom-domain";

export interface PublicPublisherRef {
  customDomain?: string | null;
  customDomainStatus?: string | null;
  name?: string;
  slug: string;
}

/** 커스텀 도메인이 실제로 서비스 중인가. */
export function hasLiveCustomDomain(publisher: PublicPublisherRef): boolean {
  return Boolean(
    publisher.customDomain && publisher.customDomainStatus === "active"
  );
}

/**
 * 커스텀 도메인에서의 로케일 접두사.
 * ⚠️ 프록시(`customDomainRewrite`)가 접두사 없는 경로를 **`ko`** 로 읽는다 →
 *   여기서도 `ko` 만 접두사가 없다. 둘이 어긋나면 canonical 이 404 를 가리킨다.
 */
function customDomainPrefix(locale: string): string {
  return locale.startsWith("ko") ? "" : `/${locale}`;
}

/** 우리 도메인에서의 로케일 접두사 — `ko`·`en` **모두** 접두사를 붙인다(무접두사 경로는 지오로 리다이렉트된다). */
function siteLocalePrefix(locale: string): string {
  return `/${locale.startsWith("ko") ? "ko" : "en"}`;
}

/** 우리 도메인 기준 글 URL. 정본 여부와 무관하게 "이 호스트에서의 주소". */
export function siteArticleUrl(input: {
  locale: string;
  postSlug: string;
  publisherSlug: string;
}): string {
  return `${SITE_ORIGIN}${siteLocalePrefix(input.locale)}/p/${input.publisherSlug}/${input.postSlug}`;
}

/** 우리 도메인 기준 퍼블리셔 홈 URL. */
export function sitePublisherUrl(
  locale: string,
  publisherSlug: string
): string {
  return `${SITE_ORIGIN}${siteLocalePrefix(locale)}/p/${publisherSlug}`;
}

/** 커스텀 도메인 기준 글 URL. */
export function customDomainArticleUrl(input: {
  customDomain: string;
  locale: string;
  postSlug: string;
}): string {
  return `https://${input.customDomain}${customDomainPrefix(input.locale)}/p/${input.postSlug}`;
}

/**
 * **글의 정본 URL.** 페이지 canonical·JSON-LD·피드·사이트맵이 모두 이 값을 쓴다.
 */
export function articleCanonicalUrl(input: {
  locale: string;
  postSlug: string;
  publisher: PublicPublisherRef;
}): string {
  if (
    CANONICAL_HOST_POLICY === "custom-domain" &&
    hasLiveCustomDomain(input.publisher) &&
    input.publisher.customDomain
  ) {
    return customDomainArticleUrl({
      customDomain: input.publisher.customDomain,
      locale: input.locale,
      postSlug: input.postSlug,
    });
  }
  return siteArticleUrl({
    locale: input.locale,
    postSlug: input.postSlug,
    publisherSlug: input.publisher.slug,
  });
}

/** 퍼블리셔 홈의 정본 URL. */
export function publisherCanonicalUrl(
  locale: string,
  publisher: PublicPublisherRef
): string {
  if (
    CANONICAL_HOST_POLICY === "custom-domain" &&
    hasLiveCustomDomain(publisher) &&
    publisher.customDomain
  ) {
    return `https://${publisher.customDomain}${customDomainPrefix(locale)}/`;
  }
  return sitePublisherUrl(locale, publisher.slug);
}

/**
 * 이 글의 정본이 **우리 호스트**인가.
 *
 * 🔴 사이트맵·뉴스 사이트맵·RSS 는 **자기 호스트의 정본 URL만** 실어야 한다.
 *   남의 도메인 URL 을 우리 사이트맵에 담으면 교차제출(cross-submission)이 되어
 *   양쪽 도메인 소유 확인이 없으면 무시된다. 정본을 고객 도메인으로 넘긴 글은
 *   **그 도메인의 사이트맵**이 담당한다(호스트 분기가 이미 `app/sitemap.ts` 에 있다).
 */
export function isCanonicalOnSite(publisher: PublicPublisherRef): boolean {
  return !(
    CANONICAL_HOST_POLICY === "custom-domain" && hasLiveCustomDomain(publisher)
  );
}
