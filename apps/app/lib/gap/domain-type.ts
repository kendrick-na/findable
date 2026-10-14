/**
 * 인용 출처 도메인 유형 분류(2026-10-15 · 경쟁사 빈틈 분석). 규칙 기반 — AI 호출 없음.
 * 한국에서 AI 가 자주 인용하는 곳(네이버 블로그·카페, 티스토리·브런치, 언론, 쇼핑몰)을 직접 분류한다.
 * 모르는 도메인은 "기타"로 둔다(지어내서 분류하지 않는다). 분류표는 운영하면서 늘린다.
 */
export type DomainType =
  | "news"
  | "blog"
  | "community"
  | "shop"
  | "wiki"
  | "public"
  | "social"
  | "official"
  | "other";

const WWW_RE = /^(www|m)\./;
const NON_IDENTITY_RE = /[^a-z0-9]/g;

const BLOG = [
  "blog.naver.com",
  "post.naver.com",
  "tistory.com",
  "brunch.co.kr",
  "velog.io",
  "medium.com",
  "blogspot.com",
  "wordpress.com",
];
const COMMUNITY = [
  "cafe.naver.com",
  "kin.naver.com",
  "cafe.daum.net",
  "dcinside.com",
  "clien.net",
  "ppomppu.co.kr",
  "ruliweb.com",
  "theqoo.net",
  "82cook.com",
  "fmkorea.com",
  "mlbpark.donga.com",
  "reddit.com",
  "quora.com",
  "stackoverflow.com",
];
const SHOP = [
  "coupang.com",
  "11st.co.kr",
  "gmarket.co.kr",
  "auction.co.kr",
  "ssg.com",
  "smartstore.naver.com",
  "shopping.naver.com",
  "brand.naver.com",
  "oliveyoung.co.kr",
  "musinsa.com",
  "kurly.com",
  "tmon.co.kr",
  "danawa.com",
  "enuri.com",
  "amazon.com",
  "amazon.co.kr",
];
const WIKI = ["wikipedia.org", "namu.wiki", "wikitree.co.kr"];
const SOCIAL = [
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "facebook.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "threads.net",
  "linkedin.com",
];
const NEWS_HINT =
  /(news|press|times|herald|daily|journal|joongang|chosun|donga|hani\.co|khan\.co|hankyung|mk\.co|sedaily|edaily|etnews|zdnet|bloter|platum|venturesquare|thebell|mt\.co|yna\.co|newsis|ohmynews|fnnews|asiae|ytn|sbs\.co|kbs\.co|mbc|jtbc|outstanding|besuccess)/;
const PUBLIC_RE =
  /(\.go\.kr|\.gov$|\.gov\.|\.edu$|\.edu\.|\.ac\.kr|nih\.gov|who\.int)/;

const matches = (host: string, list: readonly string[]) =>
  list.some((d) => host === d || host.endsWith(`.${d}`));

/** 도메인 → 유형. `ownDomain` 은 자사, `competitorNames` 는 경쟁사 이름(공식 사이트 판정용). */
export function classifyDomain(
  domain: string,
  ctx: { competitorNames?: readonly string[]; ownDomain?: string } = {}
): DomainType {
  const host = domain.toLowerCase().replace(WWW_RE, "");
  if (matches(host, BLOG) || host.startsWith("blog.")) {
    return "blog";
  }
  if (matches(host, COMMUNITY)) {
    return "community";
  }
  if (matches(host, SHOP)) {
    return "shop";
  }
  if (matches(host, WIKI)) {
    return "wiki";
  }
  if (matches(host, SOCIAL)) {
    return "social";
  }
  if (PUBLIC_RE.test(host)) {
    return "public";
  }
  const compactHost = host.replace(NON_IDENTITY_RE, "");
  const own = (ctx.ownDomain ?? "").toLowerCase().replace(WWW_RE, "");
  const isBrandSite = (ctx.competitorNames ?? [])
    .map((n) => n.toLowerCase().replace(NON_IDENTITY_RE, ""))
    .some((k) => k.length >= 4 && compactHost.includes(k));
  if ((own && (host === own || host.endsWith(`.${own}`))) || isBrandSite) {
    return "official";
  }
  return NEWS_HINT.test(host) ? "news" : "other";
}
