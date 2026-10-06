import { hasPlan } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { database } from "@repo/database";
import { cn } from "@repo/design-system/lib/utils";
import { ScanSearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  scopedBrands,
  scopedCompletedSiteReadinessRuns,
  scopedLatestSiteReadinessRun,
} from "@/lib/db/scoped";
import { getAppDictionary } from "@/lib/i18n";
import { readinessUrlMatchesBrand } from "@/lib/site-readiness/brand-domain";
import type {
  SiteReadinessReport,
  StoredSiteReadinessRun,
} from "@/lib/site-readiness/types";
import { Header } from "../components/header";
import { LockedSurface } from "../components/locked-surface";
import { SiteReadinessForm } from "../features/site-readiness/site-readiness-form";

export async function generateMetadata(): Promise<Metadata> {
  const { siteAudit } = await getAppDictionary();
  return { title: siteAudit.metaTitle, description: siteAudit.metaDescription };
}

const SiteAuditPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) => {
  const [plan, dictionary] = await Promise.all([
    getCurrentPlan(),
    getAppDictionary(),
  ]);
  const t = dictionary.siteAudit;
  const canAudit = hasPlan(plan, "growth");
  const brands = canAudit ? await scopedBrands() : [];
  const { brand: requestedBrandId } = await searchParams;
  const brand =
    brands.find((candidate) => candidate.id === requestedBrandId) ??
    brands[0] ??
    null;
  const candidateRun = brand
    ? await scopedLatestSiteReadinessRun(brand.id)
    : null;
  const latestRun =
    candidateRun &&
    brand &&
    readinessUrlMatchesBrand(candidateRun.targetUrl, brand.domain)
      ? candidateRun
      : null;
  const completedRuns = brand
    ? await scopedCompletedSiteReadinessRuns(brand.id)
    : [];
  const matchingCompletedRuns = brand
    ? completedRuns.filter((run) =>
        readinessUrlMatchesBrand(run.targetUrl, brand.domain)
      )
    : [];
  const previousRun =
    latestRun?.status === "completed"
      ? (matchingCompletedRuns[1] ?? null)
      : (matchingCompletedRuns[0] ?? null);
  const siteTaskCompletions = brand
    ? await database.actionCompletion.findMany({
        where: { brandId: brand.id, kind: "site_readiness" },
        select: { target: true },
      })
    : [];

  return (
    <>
      <Header page={t.navLabel} pages={["Findable"]} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
        {canAudit ? (
          <>
            <section className="findable-card flex flex-wrap items-center justify-between gap-4 p-5">
              <div>
                <p className="font-medium text-sm">{t.googleConnectTitle}</p>
                <p className="mt-1 text-sm text-white/50">
                  {t.googleConnectBody}
                </p>
              </div>
              <Link
                className="rounded-md border border-white/15 px-4 py-2 text-sm hover:bg-white/5"
                href={`/site-audit/integrations${brand ? `?brand=${brand.id}` : ""}`}
              >
                {t.googleConnectCta}
              </Link>
            </section>
            {brands.length > 1 ? (
              <nav
                aria-label={t.brandLabel}
                className="flex min-w-0 flex-wrap items-center gap-2"
              >
                {brands.map((option) => (
                  <Link
                    aria-current={option.id === brand?.id ? "page" : undefined}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm transition-colors",
                      option.id === brand?.id
                        ? "border-[color:var(--findable-primary,#ff7a4d)] bg-[color:var(--findable-primary,#ff7a4d)]/12 text-[color:var(--findable-ink,#f7f8f8)]"
                        : "border-[color:var(--findable-hairline,#23252a)] text-[color:var(--findable-ink-subtle,#8a8f98)] hover:border-[color:var(--findable-hairline-strong,#34343a)] hover:text-[color:var(--findable-ink,#f7f8f8)]"
                    )}
                    href={`/site-audit?brand=${option.id}`}
                    key={option.id}
                  >
                    {option.name}
                  </Link>
                ))}
              </nav>
            ) : null}
            <SiteReadinessForm
              brandId={brand?.id ?? ""}
              completedTaskIds={siteTaskCompletions.map(
                (completion) => completion.target
              )}
              defaultUrl={brand?.domain ?? ""}
              initialRun={latestRun as unknown as StoredSiteReadinessRun | null}
              labels={t}
              previousReport={
                (previousRun?.report as unknown as SiteReadinessReport) ?? null
              }
            />
          </>
        ) : (
          <LockedSurface
            bullets={t.lockedBullets}
            desc={t.lockedDescription}
            preview={
              <div className="grid gap-3 sm:grid-cols-2">
                {t.lockedPreview.map((item) => (
                  <div
                    className="findable-card flex items-center gap-3 p-5"
                    key={item}
                  >
                    <ScanSearchIcon className="size-5 text-[color:var(--findable-primary,#ff7a4d)]" />
                    <span className="text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm">
                      {item}
                    </span>
                  </div>
                ))}
              </div>
            }
            t={dictionary.lockedSurface}
            title={t.lockedTitle}
            unlockPlan="Growth"
          />
        )}
      </div>
    </>
  );
};

export default SiteAuditPage;
