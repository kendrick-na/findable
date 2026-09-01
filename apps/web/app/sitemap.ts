import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { env } from "@/env";
import {
  getPublicPublisherByDomain,
  listAllPublishedContentForDiscovery,
  listPublishedContent,
} from "@/lib/content";

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
 */
const LOCALES = ["ko"] as const;
/** hreflang `x-default` 가 가리킬 로케일 — **실제 도달 가능한 것**이어야 한다. */
const DEFAULT_LOCALE = "ko";

/**
 * 로케일 접두사를 뺀 공개 경로. 홈은 `/`.
 *
 * ⚠️ **CMS(BASEHUB) 조회를 하지 않는다** — 실측(2026-08-08): `/blog` 는 "Coming Soon" 이고
 *   `/legal/[slug]` 는 **BASEHUB 를 우회**해 `privacy`·`terms` 두 슬러그를 하드코딩해 서비스한다.
 *   즉 CMS 가 만드는 페이지가 **0개**여서 조회할 이유가 없다(조회는 타입 오류만 만들었고,
 *   원본 파일은 그걸 `@ts-nocheck` 로 덮고 있었다). CMS 로 콘텐츠를 실제로 발행하기 시작하면
 *   그때 동적 조회를 되살릴 것.
 */
const STATIC_PATHS = [
  "/",
  // 🟡 2026-08-19(👤 결정 A): 무료 진단은 **동선에서 뺐다**(랜딩 CTA → `/sign-up`).
  //   페이지는 남기므로 사이트맵에도 남긴다 — 다만 신규 유입 설계의 기준점은 아니다.
  "/audit",
  "/pricing",
  "/contact",
  "/insights",
  "/glossary",
  "/glossary/seo",
  "/glossary/geo",
  "/glossary/aeo",
  "/glossary/ai-search-visibility",
  // 🔴 2026-08-17 세션N-38 — `/synergy` 는 **페이지째 삭제**됐다(👤 *"필요 없어"*).
  //   N-34 는 *"제안 자산일 수 있어 색인만 끊는다"* 로 남겼으나, D2SF(5월 신청)가 끝났고
  //   진입 경로도 0 이라 유지 근거가 사라졌다. 백업만 남긴다.
  "/case/a-brand",
  "/report/k-beauty-geo-2026q2",
  "/research/k-geo-bench-v0_1",
  "/legal/privacy",
  "/legal/terms",
] as const;

// This is an intentionally locale-neutral machine-readable endpoint.
const ROOT_STATIC_PATHS = ["/ai-instructions"] as const;

const TRAILING_SLASH_RE = /\/$/;

/**
 * 🔴 접두사 규칙은 **i18n 전략**이 정한다 — `x-default` 로 뭘 골랐는지와 무관하다.
 *   `urlMappingStrategy: "rewriteDefault"` 라 **`en` 만** 접두사가 없고(`/pricing`),
 *   `ko` 는 항상 `/ko` 를 단다(`/ko/pricing`).
 *   ⚠️ 여기서 `DEFAULT_LOCALE`(=`ko`)을 기준으로 접두사를 떼면 `/pricing` 이 나오는데
 *     그건 **307 로 튕기는 바로 그 URL** 이다(= 고치려던 문제를 다시 만든다).
 */
const UNPREFIXED_LOCALE = "en";

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
  const now = new Date();
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
    requestHost !== "localhost" &&
    requestHost !== "127.0.0.1" &&
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
  const staticEntries = STATIC_PATHS.flatMap((path) => entriesFor(path, now));
  const rootStaticEntries = ROOT_STATIC_PATHS.map((path) => ({
    url: `${origin}${path}`,
    lastModified: now,
  }));
  try {
    const posts = await listAllPublishedContentForDiscovery();
    const visible = posts.filter((post) =>
      LOCALES.includes(post.locale as (typeof LOCALES)[number])
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
    return [
      ...staticEntries,
      ...rootStaticEntries,
      ...publisherEntries,
      ...postEntries,
    ];
  } catch {
    // 빌드·일시 DB 장애 때 정적 사이트맵 전체를 500으로 만들지 않는다.
    return [...staticEntries, ...rootStaticEntries];
  }
};

export default sitemap;
