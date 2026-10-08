import { hasPlan } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { database } from "@repo/database";
import {
  BarChart3Icon,
  CheckCircle2Icon,
  DatabaseZapIcon,
  RefreshCwIcon,
  UnplugIcon,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  disconnectSearchPerformance,
  importNaverSearchPerformance,
  selectSearchProperty,
  submitIndexNow,
  syncSearchPerformance,
} from "@/app/actions/search-performance/manage";
import { requireOrg, scopedBrands } from "@/lib/db/scoped";
import {
  type AppDictionary,
  dateLocaleFor,
  getAppDictionary,
  getAppLocale,
} from "@/lib/i18n";
import {
  type GoogleProperty,
  listGoogleProperties,
  refreshGoogleAccessToken,
} from "@/lib/search-performance/google";
import { Header } from "../../components/header";

type IntegrationsT = AppDictionary["integrations"];

function providers(
  t: IntegrationsT
): Record<string, { name: string; description: string }> {
  return {
    google_search_console: {
      name: "Google Search Console",
      description: t.gscDescription,
    },
    google_analytics_4: {
      name: "Google Analytics 4",
      description: t.ga4Description,
    },
  };
}
const PROTOCOL_RE = /^https?:\/\//;

function number(value: number | null | undefined, numberLocale: string) {
  return new Intl.NumberFormat(numberLocale, {
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}

function sum(rows: Record<string, unknown>[], key: string): number {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function weightedAverage(
  rows: Record<string, unknown>[],
  valueKey: string,
  weightKey: string
): number | null {
  const weight = sum(rows, weightKey);
  if (weight <= 0) {
    return null;
  }
  return (
    rows.reduce(
      (total, row) =>
        total + Number(row[valueKey] ?? 0) * Number(row[weightKey] ?? 0),
      0
    ) / weight
  );
}

function buildConnectionMetrics(
  rows: Record<string, unknown>[],
  isGsc: boolean,
  t: IntegrationsT,
  numberLocale: string
) {
  const fmt = (value: number) => number(value, numberLocale);
  if (!isGsc) {
    return [
      { label: t.organicSessions, value: fmt(sum(rows, "sessions")) },
      { label: t.engagedSessions, value: fmt(sum(rows, "engagedSessions")) },
      { label: t.keyEvents, value: fmt(sum(rows, "keyEvents")) },
      { label: t.revenue, value: fmt(sum(rows, "totalRevenue")) },
    ];
  }

  const clicks = sum(rows, "clicks");
  const impressions = sum(rows, "impressions");
  const averagePosition = weightedAverage(
    rows,
    "averagePosition",
    "impressions"
  );
  return [
    { label: t.clicks, value: fmt(clicks) },
    { label: t.impressions, value: fmt(impressions) },
    {
      label: "CTR",
      value: impressions > 0 ? `${fmt((clicks / impressions) * 100)}%` : "—",
    },
    {
      label: t.avgPosition,
      value:
        averagePosition === null
          ? "—"
          : t.rankValue.replace("{n}", fmt(averagePosition)),
    },
  ];
}

function indexNowBadge(status: string | null | undefined, t: IntegrationsT) {
  if (status === "configured") {
    return {
      className: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
      label: t.keyVerified,
    };
  }
  if (status === "error") {
    return {
      className: "border-red-400/20 bg-red-400/10 text-red-100",
      label: t.needsCheck,
    };
  }
  return {
    className: "border-sky-400/20 bg-sky-400/10 text-sky-100",
    label: t.needsSetup,
  };
}

export default async function SearchPerformanceIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    brand?: string;
    connected?: string;
    error?: string;
    indexNowSubmitted?: string;
    naverImported?: string;
  }>;
}) {
  if (!hasPlan(await getCurrentPlan(), "growth")) {
    redirect("/billing");
  }
  const orgId = await requireOrg();
  const dict = await getAppDictionary();
  const t = dict.integrations;
  const errors: Record<string, string> = dict.integrationErrors;
  const numberLocale = dateLocaleFor(await getAppLocale());
  const PROVIDERS = providers(t);
  const fmt = (value: number) => number(value, numberLocale);
  const brands = await scopedBrands();
  const params = await searchParams;
  const brand =
    brands.find((item) => item.id === params.brand) ?? brands[0] ?? null;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const connections = brand
    ? await database.searchPerformanceConnection.findMany({
        where: { organizationId: orgId, brandId: brand.id },
        include: {
          daily: { where: { date: { gte: since } }, orderBy: { date: "asc" } },
        },
        orderBy: { provider: "asc" },
      })
    : [];
  const indexNowConfiguration = brand
    ? await database.indexNowConfiguration.findFirst({
        where: { organizationId: orgId, brandId: brand.id },
      })
    : null;
  const indexNowBadgeState = indexNowBadge(indexNowConfiguration?.status, t);

  let properties: GoogleProperty[] = [];
  let propertyLoadError: string | null = null;
  const googleConnections = connections.filter((connection) =>
    ["google_search_console", "google_analytics_4"].includes(
      connection.provider
    )
  );
  const naverConnection = connections.find(
    (connection) => connection.provider === "naver_search_advisor_csv"
  );
  const naverRows = (naverConnection?.daily ?? []) as unknown as Record<
    string,
    unknown
  >[];
  const naverClicks = sum(naverRows, "clicks");
  const naverImpressions = sum(naverRows, "impressions");
  const naverAveragePosition = weightedAverage(
    naverRows,
    "averagePosition",
    "impressions"
  );
  const pending = googleConnections.find(
    (connection) =>
      connection.status === "pending_property" &&
      connection.encryptedRefreshToken
  );
  const pendingRefreshToken = pending?.encryptedRefreshToken;
  if (pendingRefreshToken) {
    try {
      const token = await refreshGoogleAccessToken(pendingRefreshToken);
      properties = await listGoogleProperties(token);
    } catch (error) {
      propertyLoadError =
        error instanceof Error ? error.message : "PROPERTY_LIST_FAILED";
    }
  }

  return (
    <>
      <Header page={t.headerTitle} pages={["Findable", t.headerParent]} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-medium text-[color:var(--findable-primary,#ff7a4d)] text-sm">
              FIRST-PARTY SEARCH DATA
            </p>
            <h1 className="mt-2 font-semibold text-2xl">{t.title}</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/55">{t.lede}</p>
          </div>
          <Link
            className="text-sm text-white/65 hover:text-white"
            href={`/site-audit?brand=${brand.id}`}
          >
            {t.back}
          </Link>
        </div>

        {brands.length > 1 ? (
          <nav aria-label={t.brandNav} className="flex flex-wrap gap-2">
            {brands.map((option) => (
              <Link
                className={`rounded-full border px-3 py-1 text-sm ${
                  option.id === brand?.id
                    ? "border-orange-400/60 bg-orange-400/10 text-orange-200"
                    : "border-white/10 text-white/55"
                }`}
                href={`/site-audit/integrations?brand=${option.id}`}
                key={option.id}
              >
                {option.name}
              </Link>
            ))}
          </nav>
        ) : null}

        {params.connected ? (
          <div
            aria-live="polite"
            className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4 text-emerald-200 text-sm"
          >
            {t.connected}
          </div>
        ) : null}
        {params.error ? (
          <div
            aria-live="polite"
            className="rounded-lg border border-red-400/20 bg-red-400/10 p-4 text-red-200 text-sm"
          >
            <p>{errors[params.error] ?? t.genericError}</p>
            {brand ? (
              <a
                className="mt-2 inline-flex font-medium text-red-100 underline underline-offset-4 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
                href={`/api/integrations/google/connect?brandId=${brand.id}`}
              >
                {t.retryGoogle}
              </a>
            ) : null}
          </div>
        ) : null}
        {params.naverImported ? (
          <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4 text-emerald-200 text-sm">
            {t.naverImported.replace("{n}", params.naverImported)}
          </div>
        ) : null}
        {params.indexNowSubmitted ? (
          <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4 text-emerald-200 text-sm">
            {t.indexNowSubmitted.replace("{n}", params.indexNowSubmitted)}
          </div>
        ) : null}

        {brand ? (
          googleConnections.length === 0 ? (
            <section className="findable-card grid gap-5 p-6 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <div className="flex items-center gap-2 font-semibold text-lg">
                  <DatabaseZapIcon className="size-5 text-orange-300" />{" "}
                  {t.googleDataTitle}
                </div>
                <p className="mt-2 text-sm text-white/55">
                  {t.googleDataBody.replace("{brand}", brand.name)}
                </p>
                <ol className="mt-4 grid gap-2 text-sm text-white/65 sm:grid-cols-3">
                  <li className="rounded-md border border-white/10 bg-black/10 px-3 py-2">
                    <span className="mr-1 font-mono text-orange-200">01</span>
                    {t.step1}
                  </li>
                  <li className="rounded-md border border-white/10 bg-black/10 px-3 py-2">
                    <span className="mr-1 font-mono text-orange-200">02</span>
                    {t.step2}
                  </li>
                  <li className="rounded-md border border-white/10 bg-black/10 px-3 py-2">
                    <span className="mr-1 font-mono text-orange-200">03</span>
                    {t.step3}
                  </li>
                </ol>
                <p className="mt-3 text-white/40 text-xs">{t.consentNote}</p>
              </div>
              <a
                className="findable-btn-primary inline-flex h-10 items-center justify-center rounded-md px-5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                href={`/api/integrations/google/connect?brandId=${brand.id}`}
              >
                {t.connectGoogle}
              </a>
            </section>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              {googleConnections.map((connection) => {
                const provider = PROVIDERS[connection.provider];
                const available = properties.filter(
                  (property) => property.provider === connection.provider
                );
                const rows = connection.daily as unknown as Record<
                  string,
                  unknown
                >[];
                const isGsc = connection.provider === "google_search_console";
                const metrics = buildConnectionMetrics(
                  rows,
                  isGsc,
                  t,
                  numberLocale
                );
                const domainMismatch =
                  connection.lastErrorCode === "PROPERTY_DOMAIN_MISMATCH";
                return (
                  <section
                    className="findable-card flex flex-col gap-5 p-6"
                    key={connection.id}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="font-semibold text-lg">
                          {provider?.name ?? connection.provider}
                        </h2>
                        <p className="mt-1 text-sm text-white/50">
                          {provider?.description}
                        </p>
                      </div>
                      <span className="rounded-full border border-white/10 px-2.5 py-1 text-white/60 text-xs">
                        {connection.status === "pending_property"
                          ? t.statusPending
                          : connection.status === "syncing"
                            ? t.statusSyncing
                            : connection.status === "error"
                              ? t.statusError
                              : t.statusConnected}
                      </span>
                    </div>

                    {connection.status === "pending_property" ? (
                      propertyLoadError ? (
                        <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-4 text-amber-100 text-sm">
                          {t.propertyLoadFailed}
                        </div>
                      ) : available.length ? (
                        <form
                          action={selectSearchProperty}
                          className="grid gap-3"
                        >
                          <input
                            name="connectionId"
                            type="hidden"
                            value={connection.id}
                          />
                          <label
                            className="text-sm text-white/65"
                            htmlFor={`property-${connection.id}`}
                          >
                            {t.propertyLabel}
                          </label>
                          <select
                            className="h-11 rounded-md border border-white/10 bg-black/30 px-3 text-sm"
                            id={`property-${connection.id}`}
                            name="propertyId"
                            required
                          >
                            <option value="">{t.choose}</option>
                            {available.map((property) => (
                              <option key={property.id} value={property.id}>
                                {property.name}
                              </option>
                            ))}
                          </select>
                          <button
                            className="findable-btn-primary h-10 rounded-md px-4 text-sm"
                            type="submit"
                          >
                            {t.selectAndSync}
                          </button>
                        </form>
                      ) : (
                        <p className="rounded-lg border border-white/10 p-4 text-sm text-white/55">
                          {t.noProperties}
                        </p>
                      )
                    ) : (
                      <>
                        <div className="rounded-lg border border-white/10 bg-black/15 p-4">
                          <p className="text-white/40 text-xs">
                            {t.connectedProperty}
                          </p>
                          <p className="mt-1 break-all font-medium text-sm">
                            {connection.propertyName ?? connection.propertyId}
                          </p>
                        </div>
                        {domainMismatch ? (
                          <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-4 text-red-100 text-sm">
                            {t.domainMismatch.replace("{domain}", brand.domain)}
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-3">
                            {metrics.map((metric) => (
                              <div
                                className="rounded-lg border border-white/10 p-4"
                                key={metric.label}
                              >
                                <p className="text-white/40 text-xs">
                                  {t.last30}
                                </p>
                                <p className="mt-2 font-semibold text-xl tabular-nums">
                                  {metric.value}
                                </p>
                                <p className="text-white/45 text-xs">
                                  {metric.label}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                        {connection.lastErrorCode ? (
                          <p className="text-red-300 text-xs">
                            {t.lastError.replace(
                              "{code}",
                              connection.lastErrorCode
                            )}
                          </p>
                        ) : null}
                        <p className="flex items-center gap-2 text-white/45 text-xs">
                          <CheckCircle2Icon className="size-3.5" />{" "}
                          {t.lastSynced.replace(
                            "{when}",
                            connection.lastSyncedAt?.toLocaleString(
                              numberLocale
                            ) ?? t.notYet
                          )}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <form action={syncSearchPerformance}>
                            <input
                              name="connectionId"
                              type="hidden"
                              value={connection.id}
                            />
                            <button
                              className="inline-flex h-9 items-center gap-2 rounded-md border border-white/15 px-3 text-sm"
                              type="submit"
                            >
                              <RefreshCwIcon className="size-4" /> {t.syncNow}
                            </button>
                          </form>
                          <form action={disconnectSearchPerformance}>
                            <input
                              name="connectionId"
                              type="hidden"
                              value={connection.id}
                            />
                            <button
                              className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-red-300 text-sm"
                              type="submit"
                            >
                              <UnplugIcon className="size-4" /> {t.disconnect}
                            </button>
                          </form>
                        </div>
                      </>
                    )}
                  </section>
                );
              })}
            </div>
          )
        ) : (
          <section className="findable-card p-6 text-sm text-white/55">
            {t.noBrand}
          </section>
        )}

        {brand ? (
          <section className="findable-card overflow-hidden">
            <div className="grid gap-6 p-6 lg:grid-cols-2">
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-lg">{t.naverTitle}</p>
                    <p className="mt-1 text-sm text-white/50">{t.naverBody}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-amber-100 text-xs">
                    {naverConnection ? t.naverImportedBadge : t.naverCsvNeeded}
                  </span>
                </div>
                {naverConnection ? (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-white/10 p-4">
                      <p className="text-white/40 text-xs">{t.naverClicks30}</p>
                      <p className="mt-2 font-semibold text-xl">
                        {fmt(naverClicks)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/10 p-4">
                      <p className="text-white/40 text-xs">
                        {t.naverImpressions30}
                      </p>
                      <p className="mt-2 font-semibold text-xl">
                        {fmt(naverImpressions)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/10 p-4">
                      <p className="text-white/40 text-xs">{t.naverCtr}</p>
                      <p className="mt-2 font-semibold text-xl">
                        {naverImpressions > 0
                          ? `${fmt((naverClicks / naverImpressions) * 100)}%`
                          : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/10 p-4">
                      <p className="text-white/40 text-xs">
                        {t.naverAvgPosition}
                      </p>
                      <p className="mt-2 font-semibold text-xl">
                        {naverAveragePosition === null
                          ? "—"
                          : t.rankValue.replace(
                              "{n}",
                              fmt(naverAveragePosition)
                            )}
                      </p>
                    </div>
                    <p className="col-span-2 text-white/40 text-xs">
                      {t.lastImport.replace(
                        "{when}",
                        naverConnection.lastSyncedAt?.toLocaleString(
                          numberLocale
                        ) ?? t.noRecord
                      )}
                    </p>
                  </div>
                ) : (
                  <p className="mt-4 rounded-lg border border-white/10 p-4 text-sm text-white/50">
                    {t.naverEmpty}
                  </p>
                )}
                <form
                  action={importNaverSearchPerformance}
                  className="mt-4 grid gap-3"
                >
                  <input name="brandId" type="hidden" value={brand.id} />
                  <label className="text-sm text-white/65" htmlFor="naver-csv">
                    {t.csvLabel}
                  </label>
                  <input
                    accept=".csv,text/csv"
                    className="rounded-md border border-white/10 bg-black/20 p-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-white"
                    id="naver-csv"
                    name="file"
                    required
                    type="file"
                  />
                  <p className="text-white/40 text-xs">{t.csvHint}</p>
                  <button
                    className="findable-btn-primary h-10 rounded-md px-4 text-sm"
                    type="submit"
                  >
                    {t.csvImport}
                  </button>
                </form>
              </div>

              <div className="border-white/10 lg:border-l lg:pl-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-lg">{t.indexNowTitle}</p>
                    <p className="mt-1 text-sm text-white/50">
                      {t.indexNowBody}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${indexNowBadgeState.className}`}
                  >
                    {indexNowBadgeState.label}
                  </span>
                </div>
                {indexNowConfiguration ? (
                  <div className="mt-4 rounded-lg border border-white/10 p-4 text-white/55 text-xs">
                    <p>
                      {t.keyChecked.replace(
                        "{when}",
                        indexNowConfiguration.keyVerifiedAt?.toLocaleString(
                          numberLocale
                        ) ?? t.keyCheckFailed
                      )}
                    </p>
                    <p className="mt-1">
                      {t.lastSubmitted.replace(
                        "{when}",
                        indexNowConfiguration.lastSubmittedAt?.toLocaleString(
                          numberLocale
                        ) ?? t.noSubmission
                      )}
                      {indexNowConfiguration.lastSubmittedCount
                        ? t.submittedCount.replace(
                            "{n}",
                            String(indexNowConfiguration.lastSubmittedCount)
                          )
                        : ""}
                    </p>
                  </div>
                ) : null}
                <form action={submitIndexNow} className="mt-4 grid gap-3">
                  <input name="brandId" type="hidden" value={brand.id} />
                  <label
                    className="text-sm text-white/65"
                    htmlFor="indexnow-key"
                  >
                    {t.keyLabel}
                  </label>
                  <input
                    className="h-11 rounded-md border border-white/10 bg-black/30 px-3 font-mono text-sm"
                    defaultValue={indexNowConfiguration?.key ?? undefined}
                    id="indexnow-key"
                    minLength={8}
                    name="key"
                    placeholder={t.keyPlaceholder}
                    required
                  />
                  <label
                    className="text-sm text-white/65"
                    htmlFor="indexnow-urls"
                  >
                    {t.urlsLabel}
                  </label>
                  <textarea
                    className="min-h-28 rounded-md border border-white/10 bg-black/30 p-3 font-mono text-sm"
                    id="indexnow-urls"
                    name="urls"
                    placeholder={`https://${brand.domain.replace(PROTOCOL_RE, "")}/new-page`}
                    required
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <a
                      className="text-sky-300 text-xs hover:underline"
                      href="https://searchadvisor.naver.com/guide/indexnow-api-key"
                      rel="noreferrer"
                      target="_blank"
                    >
                      {t.keyHowTo}
                    </a>
                    <button
                      className="h-10 rounded-md border border-white/15 px-4 text-sm hover:bg-white/5"
                      type="submit"
                    >
                      {t.notifyNaver}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </section>
        ) : null}

        <section className="findable-card grid gap-4 p-6 md:grid-cols-[auto_1fr]">
          <BarChart3Icon className="size-6 text-orange-300" />
          <div>
            <h2 className="font-semibold">{t.noCompositeTitle}</h2>
            <p className="mt-2 text-sm text-white/55">{t.noCompositeBody}</p>
          </div>
        </section>

        <section className="findable-card grid gap-4 p-6 md:grid-cols-[auto_1fr]">
          <DatabaseZapIcon className="size-6 text-sky-300" />
          <div>
            <h2 className="font-semibold">{t.scopeTitle}</h2>
            <p className="mt-2 text-sm text-white/55">{t.scopeBody}</p>
          </div>
        </section>
      </div>
    </>
  );
}
