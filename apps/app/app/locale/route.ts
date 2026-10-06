import { NextResponse } from "next/server";

const LOCALES = new Set(["ko", "en"]);

// 백슬래시·제어문자(탭·개행 등)는 URL 파서가 "/" 로 바꾸거나 지워 버려
// "/\evil.example" 같은 값이 다른 도메인으로 풀린다. 아예 받지 않는다.
// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어문자를 걸러내는 것이 목적
const UNSAFE_CHARS = /[\\\u0000-\u001F\u007F]/;

function resolveSafeNext(next: string | null, origin: string): URL {
  const fallback = new URL("/", origin);
  if (
    !next?.startsWith("/") ||
    next.startsWith("//") ||
    UNSAFE_CHARS.test(next)
  ) {
    return fallback;
  }
  try {
    const target = new URL(next, origin);
    // 최종 방어선: 파서가 어떻게 해석하든 같은 출처(origin)가 아니면 버린다.
    return target.origin === origin ? target : fallback;
  } catch {
    return fallback;
  }
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") ?? "ko";
  const target = resolveSafeNext(url.searchParams.get("next"), url.origin);

  if (!LOCALES.has(locale)) {
    return NextResponse.redirect(target);
  }

  const response = NextResponse.redirect(target);
  response.cookies.set("NEXT_LOCALE", locale, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
    secure: url.protocol === "https:",
  });
  return response;
}
