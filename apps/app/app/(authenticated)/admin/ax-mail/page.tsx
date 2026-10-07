import { isAdmin } from "@repo/auth/admin";
import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { env } from "@/env";
import { salesDiscoveryEnabled } from "@/lib/ax-mail/discovery/guard";
import { DISCOVER_PATH } from "@/lib/ax-mail/discovery/view";
import {
  composeOutreachDraft,
  leadReadiness,
  loadLeads,
  OUTREACH_SENDER,
} from "@/lib/ax-mail/leads";
import {
  approvedReportUrlByDomain,
  bareDomain,
  listIssuedReports,
  reportWebUrl,
} from "@/lib/client-report/admin";
import { getAppDictionary } from "@/lib/i18n";
import { Header } from "../../components/header";
import { LeadWorkbench, type WorkbenchLead } from "./lead-workbench";
import { senderState } from "./sender-state";

export const metadata: Metadata = { title: "영업 실행" };
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
  const webUrl = reportWebUrl(env.NEXT_PUBLIC_WEB_URL);
  const [t, params, sender, drafted, issued] = await Promise.all([
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
    // T8 — 승인·공개 중인 v12 발행본만 영업 링크로 쓴다(초안·만료·폐기·v1 제외).
    listIssuedReports(webUrl).catch(() => []),
  ]);
  const reportUrls = approvedReportUrlByDomain(issued);
  const draftedIds = new Set(drafted.map((row) => row.leadId));
  const leads: WorkbenchLead[] = loadLeads().map((snapshotLead) => {
    const lead = {
      ...snapshotLead,
      reportUrl: reportUrls.get(bareDomain(snapshotLead.domain)) ?? null,
    };
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
        {salesDiscoveryEnabled() && (
          <Link
            className="self-end rounded-md border border-[color:var(--findable-hairline,#23252a)] px-3 py-1.5 text-sm transition hover:border-emerald-400"
            href={DISCOVER_PATH}
          >
            {t.salesDiscover.openLink}
          </Link>
        )}
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
