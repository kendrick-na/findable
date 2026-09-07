import { NextResponse } from "next/server";

const LOCALES = new Set(["ko", "en"]);

export function GET(request: Request) {
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") ?? "ko";
  const next = url.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!LOCALES.has(locale)) {
    return NextResponse.redirect(new URL(safeNext, url.origin));
  }

  const response = NextResponse.redirect(new URL(safeNext, url.origin));
  response.cookies.set("NEXT_LOCALE", locale, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
    secure: url.protocol === "https:",
  });
  return response;
}
