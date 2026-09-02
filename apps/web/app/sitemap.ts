import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { env } from "@/env";
import {
  getPublicPublisherByDomain,
  listAllPublishedContentForDiscovery,
  listPublishedContent,
} from "@/lib/content";
import { isCanonicalOnSite } from "@/lib/public-url";

/**
 * sitemap.xml — 언어별(ko·en) URL 을 hreflang 과 함께 제출한다.
 *
 * 🔴 **왜 `app/` 루트로 옮겼나**(2026-08-08): 원래 `app/[locale]/sitemap.ts` 였다.
 *   그러면 라우트가 `/[locale]/sitemap.xml` 로만 생겨서 실측 결과:
 *   `/sitemap.xml` → **307** `/ko/sitemap.xml` → **500**. 즉 **아무도 못 읽는 상태**였다.
 *   sitemap·robots 는 사이트에 하나뿐인 표준 파일이라 로케일과 무관해야 한다.
 *
 * 🔴 **왜 폴더 스캔(`fs.readdirSync("app")`)을 없앴나**: 그게 500의 원인이었다
 *   (서버리스 번들에 `app` 디렉터리가 없다). 게다가 스캔은 색인하면 안 되는 것까지 담았다 —
 *   `logo-preview`(내부 확인용)·`checkout/success`(결제 완료 화면)·`audit/[jobId]`(개인 진단 결과).
 *   → **공개·색인 대상만 명시적으로** 나열한다. 새 페이지는 여기 한 줄 추가.
 *
 * ⚠️ URL 규칙은 i18n 전략(`urlMappingStrategy: "rewriteDefault"`)에 묶인다:
 *   기본 로케일 `en` 은 접두사 없이(`/`), `ko` 는 `/ko` 접두사.
 *   ⚠️ hreflang 대상은 **실제 번역이 채워진 ko·en 뿐**이다 — es·de·zh·fr·pt 사전은
 *   next-forge 템플릿 기본 문구가 그대로라(Findable 무관) 제출하면 안 된다.
 */

// 🔴 프로토콜 판정 (2026-08-08): 원래 `VERCEL_PROJECT_PRODUCTION_URL?.startsWith("https")` 였는데
//   이 변수는 Vercel 표준상 **프로토콜 없는 호스트명**(`www.findable.co.kr`)이라 그 검사가
//   **항상 false** 였다 → sitemap·robots 전체가 `http://` 로 발행됐다(실측).
//   https 사이트에 http URL 을 제출하면 정규 URL 이 어긋난다. `NODE_ENV` 로 판정한다
//   (`packages/seo/metadata.ts` 와 같은 방식).
const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
const origin = `${protocol}://${env.VERCEL_PROJECT_PRODUCTION_URL ?? "www.findable.co.kr"}`;

/**
 * 실제 번역이 채워진 로케일. `en` 이 기본(접두사 없음).
 *
 * 🔴🔴 **2026-08-17 세션N-39 — 사이트맵의 절반이 무효였다.**
 *   [실측] 등재 20 URL 중 **EN 10개가 전부 307 → `/ko`** 로 튕긴다.
 *   원인은 i18n 프록시(`packages/internationalization/proxy.ts`)의 로케일 판정:
 *   `x-vercel-ip-country` 가 **KR 이면 무조건 `ko`**, 그 외 국가면 `en` 이다.
 *   ⚠️ 한국 IP 로만 확인하면 지오 때문이라고 오진하기 쉬운데, **해외 경유로 재확인해도
 *     `/pricing` → `/ko/pricing` 이었다.** 즉 지오가 아니라 **EN 경로가 실제로 안 산다.**
 *
 *   🔴 리다이렉트되는 URL 을 사이트맵에 싣고 `x-default` 까지 그쪽을 가리키면
 *     구글은 **hreflang 클러스터를 통째로 무시**한다(정규 URL 신호가 깨진다).
 *     = EN 10개가 색인을 돕기는커녕 **KO 10개의 신호까지 갉아먹고 있었다.**
 *
 *   → **실제로 200 을 주는 `ko` 만 제출**한다. `x-default` 도 `ko` 로 내린다.
 *   ⚠️ **EN 을 되살리려면 사이트맵이 아니라 프록시부터 고쳐야 한다** —
 *     여기 `en` 을 다시 넣는 건 그 다음이다(순서를 뒤집으면 같은 상태로 되돌아간다).
 *
 * 🟢 **2026-09-02 `en` 을 되살렸다 — 위 주석이 요구한 순서를 지켰다.**
 *   프록시 matcher 가 명시적 `/ko`·`/en` 경로를 i18n 미들웨어에서 제외하도록 함께 고쳤고,
 *   [실측] EN 23 페이지가 전부 200 이다. `packages/seo/metadata.ts` 와 **동시에** 바꿨다.
 */
const LOCALES = ["ko", "en"] as const;
/** hreflang `x-default` 가 가리킬 로케일 — **실제 도달 가능한 것**이어야 한다. */
const DEFAULT_LOCALE = "en";

/**
 * 로케일 접두사를 뺀 공개 경로. 홈은 `/`.
 *
 * ⚠️ **CMS(BASEHUB) 조회를 하지 않는다** — 실측(2026-08-08): `/blog` 는 "Coming Soon" 이고
 *   `/legal/[slug]` 는 **BASEHUB 를 우회**해 `privacy`·`terms` 두 슬러그를 하드코딩해 서비스한다.
 *   즉 CMS 가 만드는 페이지가 **0개**여서 조회할 이유가 없다(조회는 타입 오류만 만들었고,
 *   원본 파일은 그걸 `@ts-nocheck` 로 덮고 있었다). CMS 로 콘텐츠를 실제로 발행하기 시작하면
 *   그때 동적 조회를 되살릴 것.
 */
/**
 * 🔴🔴 **`lastmod` 를 "지금"으로 찍지 않는다**(2026-09-02 실측으로 발견).
 *
 *   [실측] 사이트맵을 3초 간격으로 두 번 받으니 `lastmod` 가 **매번 달랐다**
 *   (`04:41:39` → `04:41:42`). 정적 페이지 30개(15경로×2언어)가 요청마다
 *   **"방금 수정됨"** 으로 신고되고 있었다.
 *
 *   🔴 구글 공식: `lastmod` 는 **정확할 때만** 쓰이고, 부정확하면 **무시**한다.
 *     즉 ① "언제 바뀌었는지" 신호가 통째로 무력화되고 ② 안 바뀐 페이지에 크롤 예산이 샌다.
 *     신생 도메인(등록 2026-04-16)에서 크롤 예산은 특히 아깝다.
 *
 *   → 경로별로 **실제 마지막 수정일**을 적는다. 값은 각 페이지 파일의 마지막 커밋일
 *     (`git log -1 --format=%cs -- <파일>`)에서 가져왔다.
 *   ⚠️ **페이지 내용을 고치면 이 날짜도 같이 고친다.** 안 고치면 거짓말이 되고,
 *     거짓 `lastmod` 는 없느니만 못하다(구글이 사이트 전체의 lastmod 를 불신하게 된다).
 */
const STATIC_PATHS: readonly { lastModified: string; path: string }[] = [
  { path: "/", lastModified: "2026-08-31" },
  // 🟡 2026-08-19(👤 결정 A): 무료 진단은 **동선에서 뺐다**(랜딩 CTA → `/sign-up`).
  //   페이지는 남기므로 사이트맵에도 남긴다 — 다만 신규 유입 설계의 기준점은 아니다.
  { path: "/audit", lastModified: "2026-08-22" },
  { path: "/pricing", lastModified: "2026-08-22" },
  { path: "/contact", lastModified: "2026-09-02" },
  { path: "/insights", lastModified: "2026-08-31" },
  { path: "/glossary", lastModified: "2026-09-01" },
  { path: "/glossary/seo", lastModified: "2026-08-31" },
  { path: "/glossary/geo", lastModified: "2026-08-31" },
  { path: "/glossary/aeo", lastModified: "2026-08-31" },
  { path: "/glossary/ai-search-visibility", lastModified: "2026-08-31" },
  // 🔴 2026-08-17 세션N-38 — `/synergy` 는 **페이지째 삭제**됐다(👤 *"필요 없어"*).
  //   N-34 는 *"제안 자산일 수 있어 색인만 끊는다"* 로 남겼으나, D2SF(5월 신청)가 끝났고
  //   진입 경로도 0 이라 유지 근거가 사라졌다. 백업만 남긴다.
  { path: "/case/a-brand", lastModified: "2026-09-02" },
  { path: "/report/k-beauty-geo-2026q2", lastModified: "2026-09-02" },
  { path: "/research/k-geo-bench-v0_1", lastModified: "2026-09-02" },
  { path: "/legal/privacy", lastModified: "2026-09-02" },
  { path: "/legal/terms", lastModified: "2026-09-02" },
];

// This is an intentionally locale-neutral machine-readable endpoint.
// ⚠️ 내용을 고치면 `lastModified` 도 함께 고친다(거짓 lastmod 는 없느니만 못하다).
const ROOT_STATIC_PATHS: readonly { lastModified: string; path: string }[] = [
  { path: "/ai-instructions", lastModified: "2026-09-02" },
];

const TRAILING_SLASH_RE = /\/$/;

/**
 * 🔴 접두사 규칙은 **i18n 전략**이 정한다 — `x-default` 로 뭘 골랐는지와 무관하다.
 *   `urlMappingStrategy: "rewriteDefault"` 라 **`en` 만** 접두사가 없고(`/pricing`),
 *   `ko` 는 항상 `/ko` 를 단다(`/ko/pricing`).
 *   ⚠️ 여기서 `DEFAULT_LOCALE` 을 기준으로 접두사를 떼면 `/pricing` 이 나오는데
 *     그건 **국가에 따라 언어가 바뀌는 바로 그 URL** 이다(= 고치려던 문제를 다시 만든다).
 *
 * 🔴 **2026-09-02: 무접두사 경로를 아예 쓰지 않는다.** 무접두사 경로는 방문자 국가로
 *   로케일이 결정되므로(`x-vercel-ip-country`) 정규 URL 로 신고할 수 없다.
 *   `ko`·`en` 모두 접두사를 붙인다. (센티널이라 어떤 로케일과도 일치하지 않는다.)
 */
const UNPREFIXED_LOCALE = "__no_unprefixed_locale__";

function localizedUrl(locale: string, pathname: string): string {
  const prefix = locale === UNPREFIXED_LOCALE ? "" : `/${locale}`;
  const clean = pathname === "/" ? "" : pathname.replace(TRAILING_SLASH_RE, "");
  return `${origin}${prefix}${clean}` || `${origin}/`;
}

/** 한 경로 → 언어별 엔트리(각각 alternates 로 서로를 가리킴). */
function entriesFor(pathname: string, lastModified: Date) {
  return LOCALES.map((locale) => ({
    url: localizedUrl(locale, pathname),
    lastModified,
    alternates: {
      languages: Object.fromEntries([
        ...LOCALES.map((l) => [l, localizedUrl(l, pathname)]),
        ["x-default", localizedUrl(DEFAULT_LOCALE, pathname)],
      ]),
    },
  }));
}

const sitemap = async (): Promise<MetadataRoute.Sitemap> => {
  const requestHeaders = await headers();
  const requestHost = (
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    ""
  )
    .split(":")[0]
    .toLowerCase();
  if (
    requestHost &&
    requestHost !== "findable.co.kr" &&
    requestHost !== "www.findable.co.kr" &&
    !requestHost.endsWith(".vercel.app")
  ) {
    const publisher = await getPublicPublisherByDomain(requestHost);
    if (!publisher) {
      return [];
    }
    const [koPosts, enPosts] = await Promise.all([
      listPublishedContent("ko", publisher.slug),
      listPublishedContent("en", publisher.slug),
    ]);
    return [
      { url: `https://${requestHost}/`, lastModified: publisher.updatedAt },
      ...koPosts.map((post) => ({
        url: `https://${requestHost}/p/${post.slug}`,
        lastModified: post.updatedAt,
      })),
      ...enPosts.map((post) => ({
        url: `https://${requestHost}/en/p/${post.slug}`,
        lastModified: post.updatedAt,
      })),
    ];
  }
  // 🔴 각 경로의 **실제 마지막 수정일**을 쓴다(2026-09-02). `now` 를 쓰면 요청마다 값이
  //   바뀌어 구글이 lastmod 자체를 불신한다(실측으로 그 상태였다 — 위 STATIC_PATHS 주석).
  const staticEntries = STATIC_PATHS.flatMap((entry) =>
    entriesFor(entry.path, new Date(entry.lastModified))
  );
  const rootStaticEntries = ROOT_STATIC_PATHS.map((entry) => ({
    url: `${origin}${entry.path}`,
    lastModified: new Date(entry.lastModified),
  }));
  try {
    const posts = await listAllPublishedContentForDiscovery();
    // 🔴 커스텀 도메인으로 **정본을 넘긴 글은 제외**한다(2026-09-02). 그 글의 정규 URL 은
    //   고객 도메인이고, 우리 사이트맵에 남의 호스트 URL 을 담으면 교차제출이 되어
    //   양쪽 도메인 소유확인이 없으면 무시된다. 고객 도메인 사이트맵(위 호스트 분기)이 담당한다.
    const visible = posts.filter(
      (post) =>
        LOCALES.includes(post.locale as (typeof LOCALES)[number]) &&
        isCanonicalOnSite(post.publisher)
    );
    const publisherEntries = [
      ...new Map(
        visible.map((post) => [
          `${post.locale}:${post.publisher.slug}`,
          {
            url: localizedUrl(post.locale, `/p/${post.publisher.slug}`),
            lastModified: post.updatedAt,
          },
        ])
      ).values(),
    ];
    const postEntries = visible.map((post) => ({
      url: localizedUrl(post.locale, `/p/${post.publisher.slug}/${post.slug}`),
      lastModified: post.updatedAt,
    }));
    return [...staticEntries, ...publisherEntries, ...postEntries];
  } catch {
    // 빌드·일시 DB 장애 때 정적 사이트맵 전체를 500으로 만들지 않는다.
    return staticEntries;
  }
};

export default sitemap;
