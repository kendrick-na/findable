import { isAdmin } from "@repo/auth/admin";
import { auth } from "@repo/auth/server";
import { NextResponse } from "next/server";
import { googleMailAuthorizationUrl, mailState } from "@/lib/ax-mail/google";

export async function GET(request: Request) {
  const { orgId, userId } = await auth();
  if (!(orgId && userId && (await isAdmin()))) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    const state = mailState({ orgId, userId, issuedAt: Date.now() });
    return NextResponse.redirect(googleMailAuthorizationUrl(state));
  } catch {
    return NextResponse.redirect(
      new URL("/admin/ax-mail?error=config", request.url)
    );
  }
}
