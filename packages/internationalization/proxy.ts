import { match as matchLocale } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";
import type { NextRequest } from "next/server";
import { createI18nMiddleware } from "next-international/middleware";
import languine from "./languine.json" with { type: "json" };

const locales = [languine.locale.source, ...languine.locale.targets];

// D-060 (2026-05-12): IP 기반 언어 결정 — 한국 IP=한국어, 그 외=영어
//   Vercel Geolocation 헤더 x-vercel-ip-country 사용 (KR이면 ko).
//   localhost·헤더 없음·기타 케이스는 브라우저 Accept-Language 폴백 → 영어 기본.
const I18nMiddleware = createI18nMiddleware({
  locales,
  defaultLocale: "en",
  urlMappingStrategy: "rewriteDefault",
  resolveLocaleFromRequest: (request: NextRequest) => {
    // 1순위: Vercel IP 국가 — 한국 IP면 무조건 한국어
    const country =
      request.headers.get("x-vercel-ip-country") ??
      request.headers.get("cf-ipcountry"); // Cloudflare 폴백 (만약 프록시 경유 시)
    if (country === "KR") {
      return "ko";
    }
    // 국가 헤더가 있고 KR이 아니면 → 무조건 영어 (외국 IP)
    if (country) {
      return "en";
    }
    // 2순위: 국가 헤더 없음 (localhost 등) → 브라우저 Accept-Language 폴백
    try {
      const headers = Object.fromEntries(request.headers.entries());
      const negotiator = new Negotiator({ headers });
      const acceptedLanguages = negotiator
        .languages()
        .filter((lang) => lang !== "*");

      if (acceptedLanguages.length === 0) {
        return "en";
      }

      return matchLocale(acceptedLanguages, locales, "en");
    } catch {
      return "en";
    }
  },
});

export const internationalizationMiddleware = (request: NextRequest) =>
  I18nMiddleware(request);

export const config = {
  matcher: [
    "/((?!api|data|_next/static|_next/image|favicon.ico|.*\\.(?:html?|css|js|jsonl?|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};

//https://nextjs.org/docs/app/building-your-application/routing/internationalization
//https://github.com/vercel/next.js/tree/canary/examples/i18n-routing
//https://github.com/QuiiBz/next-international
//https://next-international.vercel.app/docs/app-middleware-configuration
