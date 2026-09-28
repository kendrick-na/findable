import { isAdmin } from "@repo/auth/admin";
import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { NextResponse } from "next/server";
import {
  encryptMailToken,
  exchangeMailCode,
  googleMailAddress,
  MAIL_SCOPE,
  parseMailState,
} from "@/lib/ax-mail/google";

interface MailState {
  issuedAt: number;
  orgId: string;
  userId: string;
}

function finish(request: Request, status: string) {
  return NextResponse.redirect(
    new URL(`/admin/ax-mail?status=${status}`, request.url)
  );
}

export async function GET(request: Request) {
  const { orgId, userId } = await auth();
  if (!(orgId && userId && (await isAdmin()))) {
    return new Response("Forbidden", { status: 403 });
  }
  const params = new URL(request.url).searchParams;
  let state: MailState;
  try {
    state = parseMailState<MailState>(params.get("state") ?? "");
  } catch {
    return finish(request, "invalid_state");
  }
  if (
    state.orgId !== orgId ||
    state.userId !== userId ||
    !Number.isFinite(state.issuedAt) ||
    state.issuedAt > Date.now() ||
    Date.now() - state.issuedAt > 10 * 60 * 1000
  ) {
    return finish(request, "invalid_state");
  }
  if (params.has("error")) {
    return finish(request, "denied");
  }
  const code = params.get("code");
  if (!code) {
    return finish(request, "missing_code");
  }
  try {
    const token = await exchangeMailCode(code);
    const scopes = token.scope?.split(" ").filter(Boolean) ?? [];
    if (
      !(
        token.refresh_token &&
        token.access_token &&
        scopes.includes(MAIL_SCOPE)
      )
    ) {
      return finish(request, "permission");
    }
    const email = await googleMailAddress(token.access_token);
    await database.mailboxConnection.upsert({
      where: {
        organizationId_userId_provider: {
          organizationId: orgId,
          userId,
          provider: "google_workspace",
        },
      },
      create: {
        organizationId: orgId,
        userId,
        provider: "google_workspace",
        email,
        encryptedRefreshToken: encryptMailToken(token.refresh_token),
        scopes,
      },
      update: {
        email,
        encryptedRefreshToken: encryptMailToken(token.refresh_token),
        scopes,
        status: "connected",
      },
    });
    return finish(request, "connected");
  } catch {
    return finish(request, "connection_failed");
  }
}
