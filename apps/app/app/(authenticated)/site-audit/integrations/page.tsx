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
  type GoogleProperty,
  listGoogleProperties,
  refreshGoogleAccessToken,
} from "@/lib/search-performance/google";
import { Header } from "../../components/header";

const PROVIDERS: Record<string, { name: string; description: string }> = {
  google_search_console: {
    name: "Google Search Console",
    description: "검색 노출·클릭·CTR·평균 게재순위",
  },
  google_analytics_4: {
    name: "Google Analytics 4",
    description: "검색 이후 세션·참여 세션·핵심 이벤트·매출",
  },
};
const PROTOCOL_RE = /^https?:\/\//;

const CONNECTION_ERRORS: Record<string, string> = {
  brand: "연결할 브랜드를 확인하지 못했습니다.",
  brand_domain: "브랜드 도메인이 없어 Google 속성을 검증할 수 없습니다.",
  callback: "Google 연결을 완료하지 못했습니다. 다시 시도해 주세요.",
  google_denied: "Google 권한 요청이 취소되었습니다.",
  oauth_config:
    "Google 연결 설정이 아직 완료되지 않았습니다. 운영팀에 문의해 주세요.",
  property: "선택한 속성을 확인할 수 없습니다. 목록에서 다시 선택해 주세요.",
  property_list:
    "Google 속성 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  property_domain:
    "선택한 속성의 웹 도메인이 현재 브랜드 도메인과 다릅니다. 같은 도메인의 속성을 선택해 주세요.",
  property_save:
    "선택한 속성을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  refresh_token:
    "장기 연결 권한을 받지 못했습니다. Google 연결을 다시 진행해 주세요.",
  state: "연결 요청이 만료되었거나 유효하지 않습니다. 다시 연결해 주세요.",
  indexnow_domain: "등록된 브랜드 도메인의 HTTPS URL만 제출할 수 있습니다.",
  indexnow_input: "IndexNow 키와 URL 형식을 확인해 주세요.",
  indexnow_key_file:
    "도메인 루트의 IndexNow 키 파일을 확인하지 못했습니다. 파일 주소와 내용을 확인해 주세요.",
  indexnow_network:
    "네이버 IndexNow에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  naver_csv_empty: "CSV에 가져올 데이터가 없습니다.",
  naver_csv_invalid_clicks: "클릭 수는 0 이상의 정수여야 합니다.",
  naver_csv_invalid_date: "날짜는 YYYY-MM-DD 형식이어야 합니다.",
  naver_csv_invalid_impressions: "노출 수는 0 이상의 정수여야 합니다.",
  naver_csv_required_columns: "날짜·클릭·노출 열이 필요합니다.",
  naver_csv_too_many_rows: "한 번에 최대 400행까지 가져올 수 있습니다.",
  naver_file: "가져올 CSV 파일을 선택해 주세요.",
  naver_size: "CSV 파일은 1MB 이하여야 합니다.",
};

function number(value: number | null | undefined) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(
    value ?? 0
  );
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
  isGsc: boolean
) {
  if (!isGsc) {
    return [
      { label: "자연 검색 세션", value: number(sum(rows, "sessions")) },
      { label: "참여 세션", value: number(sum(rows, "engagedSessions")) },
      { label: "핵심 이벤트", value: number(sum(rows, "keyEvents")) },
      {
        label: "매출 (속성 통화)",
        value: number(sum(rows, "totalRevenue")),
      },
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
    { label: "클릭", value: number(clicks) },
    { label: "노출", value: number(impressions) },
    {
      label: "CTR",
      value: impressions > 0 ? `${number((clicks / impressions) * 100)}%` : "—",
    },
    {
      label: "평균 순위",
      value: averagePosition === null ? "—" : `${number(averagePosition)}위`,
    },
  ];
}

function indexNowBadge(status: string | null | undefined) {
  if (status === "configured") {
    return {
      className: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
      label: "키 확인 완료",
    };
  }
  if (status === "error") {
    return {
      className: "border-red-400/20 bg-red-400/10 text-red-100",
      label: "확인 필요",
    };
  }
  return {
    className: "border-sky-400/20 bg-sky-400/10 text-sky-100",
    label: "설정 필요",
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
  const indexNowBadgeState = indexNowBadge(indexNowConfiguration?.status);

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
      <Header page="검색 성과 연동" pages={["Findable", "사이트 준비도"]} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-medium text-[color:var(--findable-primary,#ff7a4d)] text-sm">
              FIRST-PARTY SEARCH DATA
            </p>
            <h1 className="mt-2 font-semibold text-2xl">검색 성과 연동</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/55">
              공개 사이트 진단과 실제 검색 성과를 분리해 보여줍니다. 연결 전에는
              노출·클릭을 0으로 추정하지 않습니다.
            </p>
          </div>
          <Link
            className="text-sm text-white/65 hover:text-white"
            href="/site-audit"
          >
            ← 사이트 준비도로 돌아가기
          </Link>
        </div>

        {brands.length > 1 ? (
          <nav aria-label="브랜드 선택" className="flex flex-wrap gap-2">
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
            Google 권한 연결을 완료했습니다. 아래에서 각 데이터 속성을
            선택하세요.
          </div>
        ) : null}
        {params.error ? (
          <div
            aria-live="polite"
            className="rounded-lg border border-red-400/20 bg-red-400/10 p-4 text-red-200 text-sm"
          >
            <p>
              {CONNECTION_ERRORS[params.error] ??
                "연결을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요."}
            </p>
            {brand ? (
              <a
                className="mt-2 inline-flex font-medium text-red-100 underline underline-offset-4 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
                href={`/api/integrations/google/connect?brandId=${brand.id}`}
              >
                Google 연결 다시 시도
              </a>
            ) : null}
          </div>
        ) : null}
        {params.naverImported ? (
          <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4 text-emerald-200 text-sm">
            네이버 성과 {params.naverImported}일치를 가져왔습니다. 기존 날짜는
            최신 파일 값으로 갱신했습니다.
          </div>
        ) : null}
        {params.indexNowSubmitted ? (
          <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4 text-emerald-200 text-sm">
            URL {params.indexNowSubmitted}개를 네이버 IndexNow에 전달했습니다.
            수신 성공이며 색인을 보장하는 결과는 아닙니다.
          </div>
        ) : null}

        {brand ? (
          googleConnections.length === 0 ? (
            <section className="findable-card grid gap-5 p-6 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <div className="flex items-center gap-2 font-semibold text-lg">
                  <DatabaseZapIcon className="size-5 text-orange-300" /> Google
                  데이터 연결
                </div>
                <p className="mt-2 text-sm text-white/55">
                  {brand.name}의 Search Console과 GA4에 읽기 전용으로
                  연결합니다. 수정·광고 집행 권한은 요청하지 않습니다.
                </p>
                <ol className="mt-4 grid gap-2 text-sm text-white/65 sm:grid-cols-3">
                  <li className="rounded-md border border-white/10 bg-black/10 px-3 py-2">
                    <span className="mr-1 font-mono text-orange-200">01</span>
                    Google 계정 선택
                  </li>
                  <li className="rounded-md border border-white/10 bg-black/10 px-3 py-2">
                    <span className="mr-1 font-mono text-orange-200">02</span>
                    읽기 전용 권한 동의
                  </li>
                  <li className="rounded-md border border-white/10 bg-black/10 px-3 py-2">
                    <span className="mr-1 font-mono text-orange-200">03</span>
                    브랜드와 같은 도메인 속성 선택
                  </li>
                </ol>
                <p className="mt-3 text-xs text-white/40">
                  동의 후에는 이 앱의 속성 선택 화면으로 돌아옵니다. 계정의 보안
                  정책에 따른 Google 확인 화면은 Google이 직접 표시할 수 있으며,
                  비밀번호나 이메일 인증 정보를 Findable에 입력하지 않습니다.
                </p>
              </div>
              <a
                className="findable-btn-primary inline-flex h-10 items-center justify-center rounded-md px-5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                href={`/api/integrations/google/connect?brandId=${brand.id}`}
              >
                Google 연결
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
                const metrics = buildConnectionMetrics(rows, isGsc);
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
                          ? "속성 선택 필요"
                          : connection.status === "syncing"
                            ? "동기화 중"
                            : connection.status === "error"
                              ? "오류"
                              : "연결됨"}
                      </span>
                    </div>

                    {connection.status === "pending_property" ? (
                      propertyLoadError ? (
                        <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-4 text-amber-100 text-sm">
                          Google 속성을 불러오지 못했습니다. 잠시 후 페이지를
                          새로고침하거나 다시 연결해 주세요.
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
                            측정할 속성
                          </label>
                          <select
                            className="h-11 rounded-md border border-white/10 bg-black/30 px-3 text-sm"
                            id={`property-${connection.id}`}
                            name="propertyId"
                            required
                          >
                            <option value="">선택하세요</option>
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
                            선택하고 첫 동기화
                          </button>
                        </form>
                      ) : (
                        <p className="rounded-lg border border-white/10 p-4 text-sm text-white/55">
                          이 Google 계정에서 접근 가능한 속성이 없습니다. 해당
                          사이트의 Search Console 또는 GA4 권한을 먼저
                          확인하세요.
                        </p>
                      )
                    ) : (
                      <>
                        <div className="rounded-lg border border-white/10 bg-black/15 p-4">
                          <p className="text-white/40 text-xs">연결 속성</p>
                          <p className="mt-1 break-all font-medium text-sm">
                            {connection.propertyName ?? connection.propertyId}
                          </p>
                        </div>
                        {domainMismatch ? (
                          <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-4 text-red-100 text-sm">
                            연결 속성의 웹 도메인이 {brand.domain}과 다릅니다.
                            잘못된 수치는 표시하지 않습니다. 연결을 해제한 뒤
                            같은 도메인의 속성을 다시 선택하세요.
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-3">
                            {metrics.map((metric) => (
                              <div
                                className="rounded-lg border border-white/10 p-4"
                                key={metric.label}
                              >
                                <p className="text-white/40 text-xs">
                                  최근 30일
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
                            최근 오류: {connection.lastErrorCode}
                          </p>
                        ) : null}
                        <p className="flex items-center gap-2 text-white/45 text-xs">
                          <CheckCircle2Icon className="size-3.5" /> 마지막
                          동기화:{" "}
                          {connection.lastSyncedAt?.toLocaleString("ko-KR") ??
                            "아직 없음"}
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
                              <RefreshCwIcon className="size-4" /> 지금 동기화
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
                              <UnplugIcon className="size-4" /> 연결 해제
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
            먼저 브랜드와 도메인을 등록해 주세요.
          </section>
        )}

        {brand ? (
          <section className="findable-card overflow-hidden">
            <div className="grid gap-6 p-6 lg:grid-cols-2">
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-lg">네이버 검색 성과</p>
                    <p className="mt-1 text-sm text-white/50">
                      현재는 서치어드바이저에서 내보낸 성과 CSV를 실측값으로
                      가져옵니다. 수집요청 API는 제휴된 사용자용이라 성과 데이터
                      연결과는 별도입니다.
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-amber-100 text-xs">
                    {naverConnection ? "데이터 가져옴" : "CSV 필요"}
                  </span>
                </div>
                {naverConnection ? (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-white/10 p-4">
                      <p className="text-white/40 text-xs">최근 30일 클릭</p>
                      <p className="mt-2 font-semibold text-xl">
                        {number(naverClicks)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/10 p-4">
                      <p className="text-white/40 text-xs">최근 30일 노출</p>
                      <p className="mt-2 font-semibold text-xl">
                        {number(naverImpressions)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/10 p-4">
                      <p className="text-white/40 text-xs">네이버 CTR</p>
                      <p className="mt-2 font-semibold text-xl">
                        {naverImpressions > 0
                          ? `${number((naverClicks / naverImpressions) * 100)}%`
                          : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/10 p-4">
                      <p className="text-white/40 text-xs">네이버 평균 순위</p>
                      <p className="mt-2 font-semibold text-xl">
                        {naverAveragePosition === null
                          ? "—"
                          : `${number(naverAveragePosition)}위`}
                      </p>
                    </div>
                    <p className="col-span-2 text-white/40 text-xs">
                      마지막 가져오기:{" "}
                      {naverConnection.lastSyncedAt?.toLocaleString("ko-KR") ??
                        "기록 없음"}
                    </p>
                  </div>
                ) : (
                  <p className="mt-4 rounded-lg border border-white/10 p-4 text-sm text-white/50">
                    아직 가져온 데이터가 없습니다. 네이버 서치어드바이저에서
                    성과 CSV를 내려받아 업로드하면 실측값이 표시됩니다.
                  </p>
                )}
                <form
                  action={importNaverSearchPerformance}
                  className="mt-4 grid gap-3"
                >
                  <input name="brandId" type="hidden" value={brand.id} />
                  <label className="text-sm text-white/65" htmlFor="naver-csv">
                    성과 CSV
                  </label>
                  <input
                    accept=".csv,text/csv"
                    className="rounded-md border border-white/10 bg-black/20 p-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-white"
                    id="naver-csv"
                    name="file"
                    required
                    type="file"
                  />
                  <p className="text-white/40 text-xs">
                    필수 열: 날짜, 클릭, 노출 · 선택 열: CTR, 평균순위 · 최대
                    400행. 가져오기 전 서치어드바이저에서 해당 기간의 성과를
                    CSV로 내보내세요.
                  </p>
                  <button
                    className="findable-btn-primary h-10 rounded-md px-4 text-sm"
                    type="submit"
                  >
                    CSV 검증 후 가져오기
                  </button>
                </form>
              </div>

              <div className="border-white/10 lg:border-l lg:pl-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-lg">
                      IndexNow 수동 갱신 알림
                    </p>
                    <p className="mt-1 text-sm text-white/50">
                      입력한 새 URL이나 수정 URL을 네이버에 직접 알립니다. 고객
                      사이트 변경을 자동 감지하지 않으며, 검색 노출이나 색인
                      완료를 뜻하지 않습니다.
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
                      키 확인:{" "}
                      {indexNowConfiguration.keyVerifiedAt?.toLocaleString(
                        "ko-KR"
                      ) ?? "확인 실패"}
                    </p>
                    <p className="mt-1">
                      마지막 제출:{" "}
                      {indexNowConfiguration.lastSubmittedAt?.toLocaleString(
                        "ko-KR"
                      ) ?? "제출 기록 없음"}
                      {indexNowConfiguration.lastSubmittedCount
                        ? ` · URL ${indexNowConfiguration.lastSubmittedCount}개`
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
                    도메인 루트에 올린 IndexNow 키
                  </label>
                  <input
                    className="h-11 rounded-md border border-white/10 bg-black/30 px-3 font-mono text-sm"
                    defaultValue={indexNowConfiguration?.key ?? undefined}
                    id="indexnow-key"
                    minLength={8}
                    name="key"
                    placeholder="8–128자 키"
                    required
                  />
                  <label
                    className="text-sm text-white/65"
                    htmlFor="indexnow-urls"
                  >
                    갱신 URL · 한 줄에 하나
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
                      키 파일 설치 방법 ↗
                    </a>
                    <button
                      className="h-10 rounded-md border border-white/15 px-4 text-sm hover:bg-white/5"
                      type="submit"
                    >
                      네이버에 갱신 알림
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
            <h2 className="font-semibold">
              측정값을 합성 점수로 숨기지 않습니다
            </h2>
            <p className="mt-2 text-sm text-white/55">
              Search Console, GA4, 사이트 준비도, AI 답변 노출은 출처와 날짜가
              다른 별도 지표입니다. 각 원천 데이터와 마지막 동기화 시각을 함께
              표시합니다.
            </p>
          </div>
        </section>

        <section className="findable-card grid gap-4 p-6 md:grid-cols-[auto_1fr]">
          <DatabaseZapIcon className="size-6 text-sky-300" />
          <div>
            <h2 className="font-semibold">연동 범위와 다음 확장</h2>
            <p className="mt-2 text-sm text-white/55">
              지금은 Google Search Console·GA4를 직접 읽기 전용으로 연결하고,
              네이버 성과는 CSV, IndexNow는 색인 갱신 알림으로 분리합니다. Bing
              Webmaster Tools는 다음 직접 연동 후보입니다. 고객 데이터가 없는
              상태에서 0으로 표시하지 않으며, 새 외부 연동은 권한 범위와 데이터
              보관 기준을 확인한 뒤 추가합니다.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
