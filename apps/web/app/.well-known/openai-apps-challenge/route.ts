// ChatGPT 플러그인(앱) 디렉터리 도메인 인증 — 제출 포털이 준 토큰을 text/plain 으로 돌려준다.
// env `OPENAI_APPS_CHALLENGE_TOKEN` 이 없으면 404(제출 전까지 아무것도 노출하지 않는다).

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const token = process.env.OPENAI_APPS_CHALLENGE_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new Response(token, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
