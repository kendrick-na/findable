import merge from "lodash.merge";
import type { Metadata } from "next";

type MetadataGenerator = Omit<Metadata, "description" | "title"> & {
  title: string;
  description: string;
  image?: string;
  /**
   * 현재 페이지 언어. 주면 `openGraph.locale` 을 맞추고, `pathname` 과 함께 주면
   * hreflang(`alternates.languages`)까지 만든다. 없으면 기존 동작 그대로(하위 호환).
   */
  locale?: string;
  /**
   * 로케일 접두사를 **뺀** 경로(예: `/pricing`, 홈은 `/`).
   * hreflang 을 만들려면 `locale` 과 **함께** 필요하다 — 언어별 정규 URL 을 조립해야 하기 때문.
   */
  pathname?: string;
};

const applicationName = "Findable";
const author: Metadata["authors"] = {
  name: "Findable",
  url: "https://www.findable.co.kr",
};
const publisher = "Findable";
const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;

// ──────────────────────────────────────────────────────────────────
// hreflang (2026-08-08)
//
// 왜 필요한가: 한국어·영어 두 벌을 서비스하는데 **언어 관계를 알려주는 태그가 하나도 없었다**.
//   검색엔진은 `/`(영어)와 `/ko`(한국어)를 별개 페이지로 보거나 중복으로 볼 수 있다.
//
// 🔴 **왜 ko·en 만인가**: `dictionaries/` 에 es·de·zh·fr·pt 도 있지만 실측 결과
//   **next-forge 템플릿 기본 문구가 그대로**다("Transform your business operations today" —
//   Findable 과 무관). 여기에 hreflang 을 걸면 **우리 서비스가 아닌 내용을 정식 등록**하는 것이라
//   없는 것보다 나쁘다. 번역이 실제로 채워지면 그때 이 배열에 추가할 것.
//
// ⚠️ URL 규칙은 i18n 전략(`urlMappingStrategy: "rewriteDefault"`)에 묶여 있다:
//   기본 로케일 `en` 은 **접두사 없이**(`/`), 나머지는 `/{locale}` 접두사.
//   전략을 바꾸면 여기도 함께 고쳐야 한다.
// ──────────────────────────────────────────────────────────────────

/**
 * hreflang 을 낼 언어 = 실제 번역이 채워지고 **도달 가능한** 것만.
 *
 * 🔴🔴 **2026-08-17 세션N-39 — `en` 을 뺐다.** 번역은 있으나 **URL 이 안 산다.**
 *   [실측] `/pricing` → **307** `/ko/pricing`. 해외 경유로 재확인해도 같다
 *   (i18n 프록시가 `x-vercel-ip-country` 로 로케일을 강제한다).
 *   🔴 리다이렉트되는 URL 을 hreflang·x-default 로 신고하면 구글은 **클러스터를
 *     통째로 무시**한다 → 있는 것보다 나쁘다(ko 신호까지 깎였다).
 *   ⚠️ `sitemap.ts` 와 **같은 판단**이다. 되살릴 땐 **둘을 함께**, 그리고
 *     **프록시를 먼저** 고친 뒤에.
 */
const HREFLANG_LOCALES = ["ko"] as const;

/**
 * `x-default` 가 가리킬 로케일 — **실제 200 인 곳**이어야 한다.
 * ⚠️ URL 접두사 규칙(`UNPREFIXED_LOCALE`)과는 **다른 축**이다. 혼동 금지.
 */
const DEFAULT_LOCALE = "ko";

/**
 * 접두사가 **없는** 로케일 — i18n `urlMappingStrategy: "rewriteDefault"` 가 정한다.
 * 🔴 `en` 만 접두사가 없다(`/pricing`). `ko` 는 항상 `/ko` 를 단다.
 *   여기에 `DEFAULT_LOCALE` 을 쓰면 `/ko` 가 사라져 **307 URL 을 정규 URL 로 신고**하게 된다.
 */
const UNPREFIXED_LOCALE = "en";

/** OG 규격(`ll_CC`) 매핑. 하드코딩된 `en_US` 를 언어별로 교정한다. */
const OG_LOCALES: Record<string, string> = {
  ko: "ko_KR",
  en: "en_US",
};

const siteOrigin = productionUrl
  ? `${protocol}://${productionUrl}`
  : "https://www.findable.co.kr";

const TRAILING_SLASH_RE = /\/$/;

/** 로케일별 정규 URL. `en` 은 접두사 없음, 나머지는 `/{locale}` 접두사. */
function localizedUrl(locale: string, pathname: string): string {
  const clean = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const withoutTrailing =
    clean === "/" ? "" : clean.replace(TRAILING_SLASH_RE, "");
  const prefix = locale === UNPREFIXED_LOCALE ? "" : `/${locale}`;
  return `${siteOrigin}${prefix}${withoutTrailing}` || `${siteOrigin}/`;
}

/**
 * `alternates` 생성 — canonical(자기 언어) + languages(hreflang) + x-default.
 * `x-default` 는 "언어 미지정 방문자용"이라 기본 로케일을 가리킨다(Google 권장).
 */
function buildAlternates(
  locale: string,
  pathname: string
): NonNullable<Metadata["alternates"]> {
  const languages: Record<string, string> = {};
  for (const l of HREFLANG_LOCALES) {
    languages[l] = localizedUrl(l, pathname);
  }
  languages["x-default"] = localizedUrl(DEFAULT_LOCALE, pathname);

  return {
    canonical: localizedUrl(locale, pathname),
    languages,
  };
}

export const createMetadata = ({
  title,
  description,
  image,
  locale,
  pathname,
  ...properties
}: MetadataGenerator): Metadata => {
  const parsedTitle = `${title} | ${applicationName}`;
  // 언어를 알면 OG locale 을 맞춘다. 몰랐던 시절엔 전 언어가 en_US 로 나가
  // 한국어 페이지가 영어로 신고되고 있었다.
  const ogLocale = (locale && OG_LOCALES[locale]) ?? "en_US";
  const defaultMetadata: Metadata = {
    title: parsedTitle,
    description,
    applicationName,
    metadataBase: productionUrl
      ? new URL(`${protocol}://${productionUrl}`)
      : undefined,
    authors: [author],
    creator: author.name,
    formatDetection: {
      telephone: false,
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: parsedTitle,
    },
    openGraph: {
      title: parsedTitle,
      description,
      type: "website",
      siteName: applicationName,
      locale: ogLocale,
    },
    publisher,
    twitter: {
      card: "summary_large_image",
    },
  };

  // hreflang 은 언어 + 경로가 **둘 다** 있을 때만. 하나라도 없으면 URL 을 지어내야 하므로 넣지 않는다.
  if (locale && pathname !== undefined) {
    defaultMetadata.alternates = buildAlternates(locale, pathname);
    // 🔴 `og:url` 이 **전 페이지에 없었다**(2026-08-17 실측). OG 는 이 값으로 정규 URL 을
    //   판정하므로, 없으면 공유 링크가 파라미터 붙은 주소로 각각 다른 페이지처럼 집계된다.
    //   canonical 과 **같은 값**을 쓴다(두 신호가 갈리면 안 된다).
    defaultMetadata.openGraph = {
      ...defaultMetadata.openGraph,
      url: localizedUrl(locale, pathname),
    };
  }

  // 🔴 검색엔진 소유권 인증 (2026-08-17 세션N-39).
  //   [실측] 구글 `site:findable.co.kr` **색인 0건** · 인증 메타태그도 **0개**였다
  //   = 서치콘솔·네이버 서치어드바이저에 **등록 자체가 안 된 상태**로 보인다.
  //   ⚠️ 값은 각 콘솔에서 발급받아 **env 로만** 넣는다(코드에 박지 않는다).
  //     미설정이면 태그를 아예 안 낸다 — 빈 값 태그는 인증 실패로 읽힌다.
  const googleVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;
  const naverVerification = process.env.NEXT_PUBLIC_NAVER_SITE_VERIFICATION;
  if (googleVerification) {
    defaultMetadata.verification = {
      ...defaultMetadata.verification,
      google: googleVerification,
    };
  }
  if (naverVerification) {
    // 네이버는 Next 의 `verification` 표준 키에 없다 → `other` 로 낸다.
    defaultMetadata.verification = {
      ...defaultMetadata.verification,
      other: {
        ...defaultMetadata.verification?.other,
        "naver-site-verification": naverVerification,
      },
    };
  }

  const metadata: Metadata = merge(defaultMetadata, properties);

  // ──────────────────────────────────────────────────────────────────
  // og:image (2026-08-11 세션N-18)
  //
  // 🔴 **왜 필요한가**: 라이브 실측 결과 `/`·`/ko`·`/ko/pricing` 전부 `og:image` **0개**였다.
  //   카톡·슬랙에 링크를 붙이면 썸네일이 없는 회색 카드로 나간다. GEO 를 파는 회사가
  //   정작 자기 링크의 첫인상을 비워 둔 상태였다.
  //
  // 🔬 이미지가 없어서가 아니다 — `app/[locale]/opengraph-image.png` 가 실재하고
  //   `/ko/opengraph-image.png` 는 **200 image/png** 로 서빙된다(실측). 태그만 안 나갔다.
  //   `createMetadata` 가 `openGraph` 객체를 명시적으로 만들어 넘기고 있어서
  //   파일 컨벤션 자동 태그에 기대는 것보다 **여기서 직접 박는 게 확실하다**.
  //
  // ⚠️ 호출부를 전부 고치지 않는다 — 기본값을 **이 한 곳**에만 둔다.
  //   `image` 를 명시한 페이지(진단 결과의 동적 OG 등)는 그대로 그 값이 이긴다.
  // ⚠️ 절대 URL 로 만든다: OG 크롤러는 상대경로를 못 읽는다(`metadataBase` 에 기대지 않는다).
  //
  // 🔴 **접두사를 붙이지 않는다 — 2026-09-02 변경**. 이 PNG 는 이제
  //   `apps/web/public/opengraph-image.png` 다(예전엔 `app/[locale]/` 안이었다).
  //
  //   ⚠️ 왜 옮겼나: `app/[locale]/` 안의 메타데이터 이미지가 **Vercel 빌드를 통째로**
  //     깨뜨렸다 — `Invariant: failed to find source route /[locale]/opengraph-image.png
  //     for prerender /[locale]/opengraph-image.png`. 같은 커밋·같은 Next 16.2.11·같은
  //     빌더(webpack)인데 **macOS 로컬은 통과, Vercel(Linux) 만 실패**했다(3회 재현:
  //     자동 2·수동 1). Next 가 이 PNG 를 로케일별 프리렌더 대상으로 잡아놓고 정작
  //     자기 source route 목록에서 못 찾는다. `public/` 은 라우트 계산을 아예 타지
  //     않으므로 이 실패 경로가 원천적으로 없어진다.
  //     → 같은 빌드에서 `app/` 루트의 `apple-icon.png`·`icon.svg` 는 정상 생성됐다
  //       (○ /apple-icon.png). 즉 문제는 **`[locale]` 세그먼트 안에 있다는 것**이었다.
  //
  //   📕 (이력) `app/[locale]/` 시절 실측: `/opengraph-image.png` → **500** ❌ ·
  //     `/en/…` → 200 ✅ · `/ko/…` → 200 ✅. 그때 루트가 500 이던 이유는 파일이
  //     로케일 세그먼트 안에만 있었기 때문이고, **지금은 그 주소에 실제 파일이 있다**.
  //     (그 실측이 이번에 파일을 `app/` 루트로 옮기려던 시도를 막아줬다 — 옮기기만
  //      하면 이 줄의 URL 이 404 가 됐다.)
  // ──────────────────────────────────────────────────────────────────
  const ogImageUrl = image ?? `${siteOrigin}/opengraph-image.png`;

  if (metadata.openGraph) {
    metadata.openGraph.images = [
      {
        url: ogImageUrl,
        width: 1200,
        height: 630,
        alt: title,
      },
    ];
  }

  // twitter card 도 같은 이미지를 쓴다 — `summary_large_image` 로 선언해 놓고 이미지가
  // 없으면 X/트위터는 작은 카드로 **강등**한다(선언과 실제가 어긋난 상태였다).
  if (metadata.twitter) {
    metadata.twitter.images = [ogImageUrl];
  }

  return metadata;
};
