import { authMiddleware } from "@repo/auth/proxy";
import { internationalizationMiddleware } from "@repo/internationalization/proxy";
import { parseError } from "@repo/observability/error";
import { secure } from "@repo/security";
import {
  noseconeOptions,
  noseconeOptionsWithToolbar,
  securityMiddleware,
} from "@repo/security/proxy";
import { createNEMO } from "@rescale/nemo";
import { type NextProxy, type NextRequest, NextResponse } from "next/server";
import { env } from "@/env";

const SEARCH_CRAWLER_USER_AGENT =
  /Googlebot|Google-InspectionTool|AdsBot-Google|Bingbot|NaverBot|Yeti|Daumoa/i;

/**
 * 이미 로케일이 **명시된** 공개 경로. `/ko/...`·`/en/...`.
 *
 * 🔴 **왜 이 목록이 필요한가**(2026-09-02): i18n 미들웨어는 방문자 국가로 로케일을
 *   강제한다(`x-vercel-ip-country` 가 KR 이면 `ko`). 그래서 **한국에서 `/en/...` 을 열면
 *   `/ko/...` 로 튕겼다** — 사이트맵·hreflang 의 EN URL 절반이 무효였던 원인(N-39).
 *   방문자가 URL 로 언어를 이미 지정했으면 그 지정을 존중해야 한다.
 *
 * ⚠️ **matcher 에서 제외하는 방식으로 고치지 않는다.** 라이브(2026-09-02 실측)는
 *   matcher 에서 `/ko`·`/en` 을 통째로 뺐는데, 그러면 프록시 자체가 안 돌아
 *   **nosecone 보안 헤더(CSP 등)까지 사라진다** — 실측: `/ko` 응답에 HSTS 만 있고
 *   `/`(무접두사)에는 CSP 가 있었다. 프록시는 계속 태우고 **i18n 만 건너뛴다.**
 */
const EXPLICIT_LOCALE_PATH_RE = /^\/(?:ko|en)(?:\/|$)/;

/**
 * 로케일과 무관한 기계 판독용 루트 경로. 여기에 접두사를 붙이면 존재하지 않는
 * `/ko/ai-instructions` 로 rewrite 되어 AI 에이전트가 404 를 받는다.
 * (`.xml`·`.txt` 는 matcher 의 확장자 목록에서 이미 제외된다.)
 */
const LOCALE_NEUTRAL_PATHS = new Set(["/ai-instructions"]);

/**
 * Public landing pages are the first unauthenticated entry point. A bot
 * classification false positive must not turn a visitor's first request into
 * a 403. Form/API routes retain their route-level rate limits.
 */
const isPublicLandingPath = (pathname: string): boolean =>
  pathname === "/" ||
  LOCALE_NEUTRAL_PATHS.has(pathname) ||
  EXPLICIT_LOCALE_PATH_RE.test(pathname);

export const config = {
  // matcher tells Next.js which routes to run the middleware on. This runs the
  // middleware on all routes except for static assets, Posthog ingest, and API routes.
  //
  // 🔴 `sitemap.xml`·`robots.txt` 제외 필수 (2026-08-08): 이 둘은 사이트에 하나뿐인
  //   표준 파일인데, 제외하지 않으면 i18n 이 로케일 접두사를 붙여 크롤러가 못 읽는다.
  //   실측 피해: `/sitemap.xml` → 307 `/ko/sitemap.xml` → **500** · `/robots.txt` → **404**.
  //   (확장자 목록에 `xml`·`txt` 가 없어서 새는 것이라 확장자로 막는다 — 파일을 `app/` 루트로
  //   옮기는 것만으로는 미들웨어가 여전히 가로챈다.)
  //
  // ⚠️ `/(api|trpc)(.*)` 를 **일부러 포함**한다: `apps/web/app/api/audit/*` 가
  //   `auth()`·`currentUser()` 를 쓰는데(→ `app/api/audit/_lib/owner.ts`) Clerk 프록시가
  //   돌지 않으면 요청 컨텍스트가 없다. 대신 핸들러에서 **i18n·Arcjet 합성 전에 반환**해
  //   `/api/*` 가 `/ko/api/*` 로 rewrite 되지 않게 한다.
  matcher: [
    "/((?!api|_next/static|_next/image|ingest|favicon.ico|.*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|xml|txt)).*)",
    "/(api|trpc)(.*)",
  ],
};

const securityHeaders = env.FLAGS_SECRET
  ? securityMiddleware(noseconeOptionsWithToolbar)
  : securityMiddleware(noseconeOptions);

/**
 * i18n 미들웨어 — **언어가 이미 정해진 요청은 건너뛴다.**
 * 무접두사 경로(`/pricing` 등)만 국가·Accept-Language 로 로케일을 고른다.
 */
const localeAwareInternationalization = (request: NextRequest) => {
  const { pathname } = request.nextUrl;
  if (
    EXPLICIT_LOCALE_PATH_RE.test(pathname) ||
    LOCALE_NEUTRAL_PATHS.has(pathname)
  ) {
    return;
  }
  return internationalizationMiddleware(request);
};

// Custom middleware for Arcjet security checks
const arcjetMiddleware = async (request: NextRequest) => {
  if (!env.ARCJET_KEY) {
    return;
  }

  if (isPublicLandingPath(request.nextUrl.pathname)) {
    return;
  }

  // 검색 크롤러는 아래 Arcjet 규칙의 허용 카테고리에 이미 들어 있다. 그런데도
  // URL 검사(URL Inspection)가 보안 엣지에서 5xx 를 받는 사례가 있었다(원본은 같은
  // 페이지를 200 으로 렌더). 공개 HTML 경로에서는 네트워크 판정을 건너뛴다.
  // ⚠️ User-Agent 는 위조 가능하다 — 이 우회는 **차단이 목적이 아닌 공개 페이지**에만
  //   적용된다. `/api/*` 는 핸들러에서 먼저 반환되고 각 라우트의 가드가 지킨다.
  const userAgent = request.headers.get("user-agent") ?? "";
  if (SEARCH_CRAWLER_USER_AGENT.test(userAgent)) {
    return;
  }

  try {
    await secure(
      [
        // See https://docs.arcjet.com/bot-protection/identifying-bots
        "CATEGORY:SEARCH_ENGINE", // Allow search engines
        "CATEGORY:PREVIEW", // Allow preview links to show OG images
        "CATEGORY:MONITOR", // Allow uptime monitoring services
      ],
      request
    );
  } catch (error) {
    const message = parseError(error);
    return NextResponse.json({ error: message }, { status: 403 });
  }
};

// Compose non-Clerk middleware with Nemo
const composedMiddleware = createNEMO(
  {},
  {
    before: [localeAwareInternationalization, arcjetMiddleware],
  }
);

/**
 * 🔴 보안 헤더를 **최종 응답에 합친다**(2026-09-02). 이전에는 i18n·rewrite 가 자기
 *   응답을 돌려주면 그 응답을 그대로 반환해서 nosecone 헤더가 **버려졌다.**
 *   제어 흐름 헤더(`x-middleware-next`)와 쿠키(`set-cookie`)는 건드리지 않는다.
 */
const withSecurityHeaders = <T extends Response>(
  response: T,
  securityResponse: Response
): T => {
  securityResponse.headers.forEach((value, key) => {
    if (key !== "x-middleware-next" && key !== "set-cookie") {
      response.headers.set(key, value);
    }
  });

  return response;
};

export function customDomainRewrite(request: NextRequest) {
  const hostname = request.nextUrl.hostname.toLowerCase();
  if (
    hostname === "findable.co.kr" ||
    hostname === "www.findable.co.kr" ||
    hostname.endsWith(".vercel.app") ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  ) {
    return null;
  }
  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  const firstSegment = segments[0];
  const locale =
    firstSegment === "en" || firstSegment === "ko" ? firstSegment : "ko";
  if (firstSegment === "en" || firstSegment === "ko") {
    segments.shift();
  }
  const url = request.nextUrl.clone();
  if (segments.length === 0) {
    url.pathname = `/${locale}/site/${encodeURIComponent(hostname)}`;
    return NextResponse.rewrite(url);
  }
  if (segments[0] === "p" && segments[1]) {
    url.pathname = `/${locale}/site/${encodeURIComponent(hostname)}/${encodeURIComponent(segments[1])}`;
    return NextResponse.rewrite(url);
  }
  return null;
}

// Clerk middleware wraps other middleware in its callback
export default authMiddleware(async (_auth, request, event) => {
  // Run security headers first
  const headersResponse = await securityHeaders();

  // API 핸들러는 Clerk 컨텍스트가 필요하지만, 로케일 rewrite·공개 페이지 Arcjet 합성을
  // 타면 안 된다. 보안 헤더만 붙여 여기서 반환한다.
  const { pathname } = request.nextUrl;
  if (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/trpc" ||
    pathname.startsWith("/trpc/")
  ) {
    return headersResponse;
  }

  const domainResponse = customDomainRewrite(request as NextRequest);
  if (domainResponse) {
    return withSecurityHeaders(domainResponse, headersResponse);
  }

  // Then run composed middleware (i18n + arcjet)
  const middlewareResponse = await composedMiddleware(
    request as unknown as NextRequest,
    event
  );

  return middlewareResponse
    ? withSecurityHeaders(middlewareResponse, headersResponse)
    : headersResponse;
}) as unknown as NextProxy;
