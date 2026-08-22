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

export const config = {
  // matcher tells Next.js which routes to run the middleware on. This runs the
  // middleware on all routes except for static assets, Posthog ingest, and API routes.
  // `api` 제외: i18n middleware가 /api/* 를 /ko/api/* 등으로 rewrite하지 않게 함.
  //
  // 🔴 `sitemap.xml`·`robots.txt` 제외 필수 (2026-08-08): 이 둘은 사이트에 하나뿐인
  //   표준 파일인데, 제외하지 않으면 i18n 이 로케일 접두사를 붙여 크롤러가 못 읽는다.
  //   실측 피해: `/sitemap.xml` → 307 `/ko/sitemap.xml` → **500** · `/robots.txt` → **404**.
  //   (확장자 목록에 `xml`·`txt` 가 없어서 새는 것이라 확장자로 막는다 — 파일을 `app/` 루트로
  //   옮기는 것만으로는 미들웨어가 여전히 가로챈다.)
  matcher: [
    "/((?!api|_next/static|_next/image|ingest|favicon.ico|.*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|xml|txt)).*)",
  ],
};

const securityHeaders = env.FLAGS_SECRET
  ? securityMiddleware(noseconeOptionsWithToolbar)
  : securityMiddleware(noseconeOptions);

// Custom middleware for Arcjet security checks
const arcjetMiddleware = async (request: NextRequest) => {
  if (!env.ARCJET_KEY) {
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
    before: [internationalizationMiddleware, arcjetMiddleware],
  }
);

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
  const headersResponse = securityHeaders();
  const domainResponse = customDomainRewrite(request as NextRequest);
  if (domainResponse) {
    return domainResponse;
  }

  // Then run composed middleware (i18n + arcjet)
  const middlewareResponse = await composedMiddleware(
    request as unknown as NextRequest,
    event
  );

  // Return middleware response if it exists, otherwise headers response
  return middlewareResponse || headersResponse;
}) as unknown as NextProxy;
