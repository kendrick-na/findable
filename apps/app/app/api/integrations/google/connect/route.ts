import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { NextResponse } from "next/server";
import { googleAuthorizationUrl } from "@/lib/search-performance/google";
import { signOAuthState } from "@/lib/search-performance/crypto";

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

function integrationsUrl(request: Request, brandId?: string, error?: string) {
  const url = new URL("/site-audit/integrations", request.url);
  if (brandId) {
    url.searchParams.set("brand", brandId);
  }
  if (error) {
    url.searchParams.set("error", error);
  }
  return url;
}

/** Google OAuth 시작: 현재 로그인한 조직의 브랜드만 연결 대상으로 허용한다. */
export async function GET(request: Request) {
  const { orgId, userId } = await auth();
  if (!(orgId && userId)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  const brandId = new URL(request.url).searchParams.get("brandId") ?? "";
  const brand = await database.brand.findFirst({
    where: { id: brandId, organizationId: orgId },
    select: { id: true },
  });
  if (!brand) {
    return NextResponse.redirect(integrationsUrl(request, undefined, "brand"));
  }

  try {
    const state = signOAuthState({
      brandId: brand.id,
      issuedAt: Date.now(),
      orgId,
      userId,
      expiresAt: Date.now() + STATE_MAX_AGE_MS,
    });
    return NextResponse.redirect(googleAuthorizationUrl(state));
  } catch {
    return NextResponse.redirect(
      integrationsUrl(request, brand.id, "oauth_config")
    );
  }
}
