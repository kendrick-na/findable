import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { NextResponse } from "next/server";
import { encryptRefreshToken, verifyOAuthState } from "@/lib/search-performance/crypto";
import { exchangeGoogleCode } from "@/lib/search-performance/google";

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

interface GoogleOAuthState {
  brandId: string;
  expiresAt: number;
  issuedAt: number;
  orgId: string;
  userId: string;
}

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

/**
 * Google OAuth 완료: 서명·만료·현재 세션을 모두 확인한 뒤에만 토큰을 저장한다.
 * Search Console과 GA4는 같은 Google 권한을 쓰되 속성은 고객이 다음 화면에서 각각 고른다.
 */
export async function GET(request: Request) {
  const { orgId, userId } = await auth();
  if (!(orgId && userId)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  const params = new URL(request.url).searchParams;
  const stateValue = params.get("state");
  if (!stateValue) {
    return NextResponse.redirect(integrationsUrl(request, undefined, "state"));
  }

  let state: GoogleOAuthState;
  try {
    state = verifyOAuthState<GoogleOAuthState>(stateValue);
  } catch {
    return NextResponse.redirect(integrationsUrl(request, undefined, "state"));
  }
  if (
    !(
      state.brandId &&
      state.orgId === orgId &&
      state.userId === userId &&
      Number.isFinite(state.issuedAt) &&
      Number.isFinite(state.expiresAt) &&
      state.expiresAt >= Date.now() &&
      Date.now() - state.issuedAt <= STATE_MAX_AGE_MS
    )
  ) {
    return NextResponse.redirect(integrationsUrl(request, state.brandId, "state"));
  }

  if (params.get("error")) {
    return NextResponse.redirect(
      integrationsUrl(request, state.brandId, "google_denied")
    );
  }
  const code = params.get("code");
  if (!code) {
    return NextResponse.redirect(
      integrationsUrl(request, state.brandId, "callback")
    );
  }

  const brand = await database.brand.findFirst({
    where: { id: state.brandId, organizationId: orgId },
    select: { id: true },
  });
  if (!brand) {
    return NextResponse.redirect(integrationsUrl(request, undefined, "brand"));
  }

  try {
    const token = await exchangeGoogleCode(code);
    if (!token.refreshToken) {
      return NextResponse.redirect(
        integrationsUrl(request, brand.id, "refresh_token")
      );
    }
    const encryptedRefreshToken = encryptRefreshToken(token.refreshToken);
    await database.$transaction(
      ["google_search_console", "google_analytics_4"].map((provider) =>
        database.searchPerformanceConnection.upsert({
          where: { brandId_provider: { brandId: brand.id, provider } },
          create: {
            brandId: brand.id,
            createdBy: userId,
            encryptedRefreshToken,
            organizationId: orgId,
            provider,
            scopes: token.scopes,
            status: "pending_property",
          },
          update: {
            encryptedRefreshToken,
            lastErrorCode: null,
            propertyId: null,
            propertyName: null,
            scopes: token.scopes,
            status: "pending_property",
            tokenUpdatedAt: new Date(),
          },
        })
      )
    );
  } catch {
    return NextResponse.redirect(
      integrationsUrl(request, brand.id, "callback")
    );
  }

  return NextResponse.redirect(
    integrationsUrl(request, brand.id, "connected")
  );
}
