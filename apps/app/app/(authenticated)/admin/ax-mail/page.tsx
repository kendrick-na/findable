import { isAdmin } from "@repo/auth/admin";
import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  findSenderAlias,
  listSenderAliases,
  refreshMailAccessToken,
} from "@/lib/ax-mail/google";
import {
  composeOutreachDraft,
  leadReadiness,
  loadLeads,
  OUTREACH_SENDER,
} from "@/lib/ax-mail/leads";
import { getAppDictionary } from "@/lib/i18n";
import { Header } from "../../components/header";
import {
  LeadWorkbench,
  type SenderState,
  type WorkbenchLead,
} from "./lead-workbench";

export const metadata: Metadata = { title: "영업 실행" };
export const dynamic = "force-dynamic";

async function senderState(
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

export default async function AxMailPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; status?: string }>;
}) {
  const { orgId, userId } = await auth();
  if (!(orgId && userId && (await isAdmin()))) {
    notFound();
  }
  const [t, params, sender, drafted] = await Promise.all([
    getAppDictionary(),
    searchParams,
    senderState(orgId, userId),
    database.outreachDraft
      .findMany({
        where: {
          organizationId: orgId,
          status: "created",
          leadId: { not: null },
        },
        select: { leadId: true },
      })
      .catch(() => []),
  ]);
  const draftedIds = new Set(drafted.map((row) => row.leadId));
  const leads: WorkbenchLead[] = loadLeads().map((lead) => {
    const readiness = leadReadiness(lead);
    return {
      lead,
      readiness,
      draft: composeOutreachDraft(lead, readiness),
      drafted: draftedIds.has(lead.id),
    };
  });

  return (
    <>
      <Header page={t.axMail.title} pages={["관리자"]} />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-8">
        <LeadWorkbench
          connectFailed={Boolean(
            params.error || (params.status && params.status !== "connected")
          )}
          labels={t.axMail}
          leads={leads}
          sender={sender}
          senderEmail={OUTREACH_SENDER.email}
        />
      </main>
    </>
  );
}
