import { isAdmin } from "@repo/auth/admin";
import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAppDictionary } from "@/lib/i18n";
import { Header } from "../../components/header";
import { CosmeticsWorkbench } from "./cosmetics-workbench";

export const metadata: Metadata = { title: "영업 메일 초안" };
export const dynamic = "force-dynamic";

export default async function AxMailPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; status?: string }>;
}) {
  const { orgId, userId } = await auth();
  if (!(orgId && userId && (await isAdmin()))) {
    notFound();
  }
  const mailConfigured = Boolean(
    process.env.GOOGLE_MAIL_CLIENT_ID &&
      process.env.GOOGLE_MAIL_CLIENT_SECRET &&
      process.env.MAILBOX_ENCRYPTION_KEY
  );
  const [t, params, connection] = await Promise.all([
    getAppDictionary(),
    searchParams,
    mailConfigured
      ? database.mailboxConnection.findUnique({
          where: {
            organizationId_userId_provider: {
              organizationId: orgId,
              userId,
              provider: "google_workspace",
            },
          },
          select: { email: true, status: true },
        })
      : Promise.resolve(null),
  ]);
  const labels = t.axMail;
  const connected = connection?.status === "connected";

  return (
    <>
      <Header page={labels.title} pages={["관리자"]} />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 md:px-8">
        <div className="space-y-2">
          <p className="font-medium text-emerald-400 text-xs uppercase tracking-[0.2em]">
            AX / OUTREACH
          </p>
          <h1 className="font-semibold text-3xl text-[color:var(--findable-ink,#f7f8f8)] tracking-tight">
            {labels.title}
          </h1>
          <p className="max-w-2xl text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-6">
            {labels.description}
          </p>
        </div>

        <section className="rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-5 md:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <h2 className="font-semibold text-sm">{labels.connection}</h2>
              <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
                {connected ? connection.email : labels.notConnected}
              </p>
            </div>
            {mailConfigured ? (
              <a
                className="inline-flex min-h-10 items-center justify-center rounded-md border border-[color:var(--findable-hairline,#23252a)] px-4 font-medium text-sm transition hover:border-emerald-400 hover:text-emerald-300"
                href="/api/ax-mail/google/connect"
              >
                {connected ? labels.reconnect : labels.connect}
              </a>
            ) : (
              <span className="rounded-md border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-amber-300 text-xs">
                {labels.setupRequired}
              </span>
            )}
          </div>
          <p className="mt-4 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs leading-5">
            {labels.permissionNote}
          </p>
          {(params.error ||
            (params.status && params.status !== "connected")) && (
            <p
              className="mt-4 rounded-md border border-amber-800/60 bg-amber-950/30 p-3 text-amber-300 text-sm"
              role="alert"
            >
              {labels.connectFailed}
            </p>
          )}
        </section>

        <CosmeticsWorkbench connected={connected} labels={labels} />
      </main>
    </>
  );
}
