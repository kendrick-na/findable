import "server-only";

import { database } from "@repo/database";
import {
  findSenderAlias,
  listSenderAliases,
  refreshMailAccessToken,
} from "@/lib/ax-mail/google";
import { OUTREACH_SENDER } from "@/lib/ax-mail/leads";
import type { SenderState } from "./lead-workbench";

/** 보낸사람(회사 주소 별칭) 확인 — 「영업 실행」·「회사 찾기」가 같이 쓴다. */
export async function senderState(
  orgId: string,
  userId: string
): Promise<SenderState> {
  const configured = Boolean(
    process.env.GOOGLE_MAIL_CLIENT_ID &&
      process.env.GOOGLE_MAIL_CLIENT_SECRET &&
      process.env.MAILBOX_ENCRYPTION_KEY
  );
  if (!configured) {
    return { kind: "not_configured" };
  }
  const connection = await database.mailboxConnection.findUnique({
    where: {
      organizationId_userId_provider: {
        organizationId: orgId,
        userId,
        provider: "google_workspace",
      },
    },
    select: { email: true, status: true, encryptedRefreshToken: true },
  });
  if (connection?.status !== "connected") {
    return { kind: "not_connected" };
  }
  let token: string;
  try {
    token = await refreshMailAccessToken(connection.encryptedRefreshToken);
  } catch {
    // Google OAuth 「테스트」 상태 앱은 refresh token 이 7일 뒤 만료된다 → 다시 연결.
    return { kind: "token_expired", account: connection.email };
  }
  try {
    const alias = findSenderAlias(
      await listSenderAliases(token),
      OUTREACH_SENDER.email
    );
    return alias
      ? { kind: "ok", account: connection.email, smtpHost: alias.smtpHost }
      : { kind: "alias_missing", account: connection.email };
  } catch {
    return { kind: "alias_missing", account: connection.email };
  }
}
