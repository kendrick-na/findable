import {
  ActivityIcon,
  AlertTriangleIcon,
  BarChart3Icon,
  CheckCircle2Icon,
  ChevronDownIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  GaugeIcon,
  Globe2Icon,
  Link2Icon,
  SearchCheckIcon,
  XCircleIcon,
} from "lucide-react";
import type {
  ConsultingBrand,
  ConsultingEngineResponse,
} from "@/app/actions/admin/consulting";
import { env } from "@/env";

const fmt = (value: Date | null) =>
  value
    ? new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

const number = (value: number | null) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("ko-KR").format(Math.round(value));

const providerName: Record<string, string> = {
  google_analytics_4: "Google Analytics 4",
  google_search_console: "Google Search Console",
  naver_search_advisor_csv: "네이버 서치어드바이저 CSV",
};

const statusTone: Record<string, string> = {
  completed: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  connected: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  fail: "border-red-400/20 bg-red-400/10 text-red-200",
  failed: "border-red-400/20 bg-red-400/10 text-red-200",
  error: "border-red-400/20 bg-red-400/10 text-red-200",
  warning: "border-amber-400/20 bg-amber-400/10 text-amber-100",
  pending_property: "border-amber-400/20 bg-amber-400/10 text-amber-100",
  processing: "border-sky-400/20 bg-sky-400/10 text-sky-100",
  queued: "border-sky-400/20 bg-sky-400/10 text-sky-100",
  pass: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  info: "border-slate-400/20 bg-slate-400/10 text-slate-200",
};

function Status({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-medium text-[11px] ${
        statusTone[value] ??
        "border-slate-400/20 bg-slate-400/10 text-slate-200"
      }`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof GaugeIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="border-[color:var(--findable-hairline,#23252a)] border-l px-4 py-3 first:border-l-0">
      <div className="flex items-center gap-1.5 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="mt-1.5 font-mono font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-xl tabular-nums">
        {value}
      </p>
    </div>
  );
}

function responseState(response: ConsultingEngineResponse) {
  if (response.brandMentioned) {
    return {
      Icon: CheckCircle2Icon,
      iconClassName: "text-emerald-300",
      label: "브랜드 확인",
    };
  }
  if (response.errorMessage) {
    return {
      Icon: XCircleIcon,
      iconClassName: "text-red-300",
      label: "응답 오류",
    };
  }
  return {
    Icon: Globe2Icon,
    iconClassName: "text-[color:var(--findable-ink-tertiary,#7e8289)]",
    label: "브랜드 미확인",
  };
}

function EngineResponseRow({
  response,
}: {
  response: ConsultingEngineResponse;
}) {
  const state = responseState(response);
  const { Icon } = state;
  return (
    <details className="group/response px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <Icon className={`size-4 shrink-0 ${state.iconClassName}`} />
          <b className="font-mono text-xs">{response.engineId}</b>
          <span className="truncate text-[color:var(--findable-ink-subtle,#8a8f98)]">
            {state.label}
          </span>
        </span>
        <span className="flex items-center gap-2 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
          {response.mentionPosition ? `${response.mentionPosition}번째` : ""}
          인용 {response.citedSources.length}
          <ChevronDownIcon className="size-3.5 transition-transform group-open/response:rotate-180" />
        </span>
      </summary>
      <div className="mt-3 space-y-3 border-[color:var(--findable-hairline,#23252a)] border-t pt-3">
        {response.errorMessage ? (
          <p className="text-red-200 text-sm">{response.errorMessage}</p>
        ) : null}
        {response.excerpt ? (
          <p className="whitespace-pre-wrap break-words text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm leading-6">
            {response.excerpt}
          </p>
        ) : null}
        {response.citedSources.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {response.citedSources.map((source) => (
              <a
                className="flex items-center gap-1.5 break-all text-[color:var(--findable-primary,#ff7a4d)] text-xs hover:underline"
                href={source.url}
                key={source.url}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLinkIcon className="size-3 shrink-0" />
                {source.title ?? source.domain}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function AuditData({ brand }: { brand: ConsultingBrand }) {
  const audit = brand.lastAudit;
  if (!audit) {
    return (
      <div className="border border-[color:var(--findable-hairline,#23252a)] border-dashed bg-[color:var(--findable-surface-1,#101114)] p-4 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
        아직 AI 검색 측정이 없습니다. 가입 정보는 있지만 결과 데이터가 생성되지
        않은 상태입니다.
      </div>
    );
  }

  const zeroMention = audit.usable && audit.mentionedResponses === 0;
  const partialMeasurement = audit.failedEngineIds.length > 0;
  return (
    <div className="overflow-hidden rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#101114)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-[color:var(--findable-hairline,#23252a)] border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ActivityIcon className="size-4 text-[color:var(--findable-primary,#ff7a4d)]" />
          <span className="font-medium text-sm">최근 AI 검색 측정</span>
          <Status value={audit.status} />
          {audit.usable ? null : <Status value="info" />}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
            {fmt(audit.measuredAt)}
          </span>
          <a
            className="inline-flex items-center gap-1 text-[color:var(--findable-primary,#ff8a62)] text-xs underline-offset-4 hover:underline"
            href={`${env.NEXT_PUBLIC_WEB_URL}/ko/audit/${audit.id}`}
            rel="noreferrer"
            target="_blank"
          >
            공개 리포트 열기 <ExternalLinkIcon className="size-3" />
          </a>
        </div>
      </div>

      <div className="grid divide-x divide-[color:var(--findable-hairline,#23252a)] sm:grid-cols-4">
        <Metric
          icon={GaugeIcon}
          label="GEO 종합"
          value={audit.geoScore === null ? "—" : `${number(audit.geoScore)}점`}
        />
        <Metric
          icon={BarChart3Icon}
          label="AI 언급률"
          value={audit.sov === null ? "—" : `${number(audit.sov)}%`}
        />
        <Metric
          icon={DatabaseIcon}
          label="엔진 응답"
          value={`${number(audit.responseCount)}개`}
        />
        <Metric
          icon={SearchCheckIcon}
          label="브랜드 확인"
          value={`${number(audit.mentionedResponses)}개`}
        />
      </div>

      {zeroMention ? (
        <div className="mx-4 mt-4 flex gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-amber-100 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            응답 데이터 {audit.responseCount}개는 정상 저장됐지만, 등록한
            브랜드명 <b>{brand.name}</b>으로 확인된 응답이 없어 0점입니다.
            사이트의 실제 표기·별칭과 등록 브랜드명을 먼저 대조하세요.
          </p>
        </div>
      ) : null}

      {partialMeasurement ? (
        <div className="mx-4 mt-4 flex gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-amber-100 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            부분 측정입니다. <b>{audit.failedEngineIds.join(", ")}</b> 응답이
            실패해, 현재 점수는 성공한 엔진 응답만으로 계산했습니다. 다음
            재측정에서 해당 엔진을 다시 확인해야 합니다.
          </p>
        </div>
      ) : null}

      {audit.errorMessage ? (
        <p className="mx-4 mt-4 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-red-200 text-sm">
          작업 오류: {audit.errorMessage}
        </p>
      ) : null}

      <details
        className="group mt-4 border-[color:var(--findable-hairline,#23252a)] border-t"
        open
      >
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-medium text-sm">
          엔진별 원본 응답과 인용 근거{" "}
          <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="divide-y divide-[color:var(--findable-hairline,#23252a)]">
          {audit.engineResponses.map((response) => (
            <EngineResponseRow
              key={`${response.engineId}-${response.excerpt}-${response.errorMessage ?? ""}`}
              response={response}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

function ReadinessData({ brand }: { brand: ConsultingBrand }) {
  const readiness = brand.readiness;
  if (!readiness) {
    return (
      <p className="rounded-lg border border-[color:var(--findable-hairline,#23252a)] border-dashed p-4 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
        아직 사이트 준비도 측정을 실행하지 않았습니다. 기존 가입 고객은 자동
        백필 대상에 포함되지 않았을 수 있습니다.
      </p>
    );
  }
  const report = readiness.report;
  return (
    <div className="rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#101114)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-[color:var(--findable-hairline,#23252a)] border-b px-4 py-3">
        <span className="flex items-center gap-2 font-medium text-sm">
          <GaugeIcon className="size-4 text-[color:var(--findable-primary,#ff7a4d)]" />{" "}
          사이트 준비도 <Status value={readiness.status} />
        </span>
        <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
          {readiness.trigger} ·{" "}
          {fmt(readiness.completedAt ?? readiness.createdAt)}
        </span>
      </div>
      {report ? (
        <div className="p-4">
          <div className="grid grid-cols-4 divide-x divide-[color:var(--findable-hairline,#23252a)] rounded-lg border border-[color:var(--findable-hairline,#23252a)]">
            <Metric
              icon={CheckCircle2Icon}
              label="통과"
              value={`${report.summary.pass}`}
            />
            <Metric
              icon={AlertTriangleIcon}
              label="경고"
              value={`${report.summary.warning}`}
            />
            <Metric
              icon={XCircleIcon}
              label="실패"
              value={`${report.summary.fail}`}
            />
            <Metric
              icon={DatabaseIcon}
              label="점검"
              value={`${report.checks.length}`}
            />
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {report.checks.map((check) => (
              <div
                className="flex items-start justify-between gap-3 rounded-lg border border-[color:var(--findable-hairline,#23252a)] px-3 py-2.5 text-sm"
                key={check.id}
              >
                <div>
                  <p className="font-mono text-xs">{check.id}</p>
                  <p className="mt-1 break-words text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                    {check.evidence}
                  </p>
                </div>
                <Status value={check.status} />
              </div>
            ))}
          </div>
          {report.findings?.length ? (
            <div className="mt-4 space-y-2">
              {report.findings.map((finding) => (
                <div
                  className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-sm"
                  key={finding.code}
                >
                  <div className="flex justify-between gap-3">
                    <b>{finding.code}</b>
                    <Status value={finding.severity} />
                  </div>
                  <p className="mt-1 text-amber-50/80">{finding.evidence}</p>
                </div>
              ))}
            </div>
          ) : null}
          {report.crawl?.pages.length ? (
            <details className="group mt-4 border-[color:var(--findable-hairline,#23252a)] border-t pt-3">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm">
                크롤링 페이지 {report.crawl.audited}/{report.crawl.discovered}
                <ChevronDownIcon className="size-4 group-open:rotate-180" />
              </summary>
              <div className="mt-3 space-y-2">
                {report.crawl.pages.map((page) => (
                  <div
                    className="rounded-lg border border-[color:var(--findable-hairline,#23252a)] p-3 text-xs"
                    key={page.url}
                  >
                    <p className="break-all font-mono text-[color:var(--findable-ink-muted,#d0d6e0)]">
                      {page.finalUrl}
                    </p>
                    <p className="mt-1 text-[color:var(--findable-ink-tertiary,#7e8289)]">
                      HTTP {page.statusCode} ·{" "}
                      {page.indexable ? "색인 가능" : "색인 불가"} · H1{" "}
                      {page.h1Count} · {page.ttfbMs}ms
                    </p>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : (
        <p className="p-4 text-red-200 text-sm">
          결과가 저장되지 않았습니다. 오류 코드:{" "}
          {readiness.errorCode ?? "알 수 없음"}
        </p>
      )}
    </div>
  );
}

function SearchData({ brand }: { brand: ConsultingBrand }) {
  if (brand.searchConnections.length === 0) {
    return (
      <p className="rounded-lg border border-[color:var(--findable-hairline,#23252a)] border-dashed p-4 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
        연결된 검색 데이터 소스가 없습니다. 고객이 Google 또는 네이버 데이터를
        승인해야 합니다.
      </p>
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {brand.searchConnections.map((connection) => (
        <div
          className="rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#101114)] p-4"
          key={connection.provider}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium text-sm">
                {providerName[connection.provider] ?? connection.provider}
              </p>
              <p className="mt-1 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                {connection.propertyName ?? "속성 미선택"} · 동기화{" "}
                {fmt(connection.lastSyncedAt)}
              </p>
            </div>
            <Status value={connection.status} />
          </div>
          {connection.lastErrorCode ? (
            <p className="mt-3 text-red-200 text-xs">
              오류: {connection.lastErrorCode}
            </p>
          ) : null}
          <details className="group mt-4 border-[color:var(--findable-hairline,#23252a)] border-t pt-3">
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm">
              최근 일별 데이터 {connection.daily.length}일
              <ChevronDownIcon className="size-4 group-open:rotate-180" />
            </summary>
            <div className="mt-3 max-h-64 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-[color:var(--findable-surface-1,#101114)] text-[color:var(--findable-ink-tertiary,#7e8289)]">
                  <tr>
                    <th className="py-1">날짜</th>
                    <th>클릭/세션</th>
                    <th>노출</th>
                    <th>순위</th>
                  </tr>
                </thead>
                <tbody>
                  {connection.daily.map((day) => (
                    <tr
                      className="border-[color:var(--findable-hairline,#23252a)] border-t"
                      key={day.date.toISOString()}
                    >
                      <td className="py-1.5">
                        {new Intl.DateTimeFormat("ko-KR", {
                          month: "numeric",
                          day: "numeric",
                        }).format(day.date)}
                      </td>
                      <td>{day.clicks ?? day.sessions ?? "—"}</td>
                      <td>{day.impressions ?? "—"}</td>
                      <td>{day.averagePosition?.toFixed(1) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      ))}
    </div>
  );
}

export function CustomerDataPanel({ brands }: { brands: ConsultingBrand[] }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] text-[color:var(--findable-primary,#ff7a4d)] uppercase tracking-[0.16em]">
            Operator data room
          </p>
          <h2 className="mt-1 font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-xl">
            고객사 전체 측정 데이터
          </h2>
        </div>
        <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
          운영자 전용 · 원본 응답 포함
        </p>
      </div>
      {brands.map((brand) => (
        <article className="findable-card overflow-hidden" key={brand.id}>
          <div className="border-[color:var(--findable-hairline,#23252a)] border-b bg-[linear-gradient(115deg,rgba(255,122,77,.12),transparent_42%)] px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg">
                  {brand.name}
                </h3>
                <p className="mt-1 font-mono text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                  {brand.domain}
                </p>
              </div>
              <span className="rounded-full border border-[color:var(--findable-hairline,#23252a)] px-2.5 py-1 font-mono text-[11px] text-[color:var(--findable-ink-subtle,#8a8f98)]">
                측정 이력 {brand.audits.length}회
              </span>
            </div>
          </div>
          <div className="space-y-6 p-5">
            <div>
              <h4 className="mb-2 flex items-center gap-2 font-medium text-sm">
                <ActivityIcon className="size-4 text-[color:var(--findable-primary,#ff7a4d)]" />{" "}
                AI 검색 실측
              </h4>
              <AuditData brand={brand} />
            </div>
            <div>
              <h4 className="mb-2 flex items-center gap-2 font-medium text-sm">
                <Link2Icon className="size-4 text-[color:var(--findable-primary,#ff7a4d)]" />{" "}
                검색 성과 연동
              </h4>
              <SearchData brand={brand} />
            </div>
            <div>
              <h4 className="mb-2 flex items-center gap-2 font-medium text-sm">
                <GaugeIcon className="size-4 text-[color:var(--findable-primary,#ff7a4d)]" />{" "}
                사이트 준비도
              </h4>
              <ReadinessData brand={brand} />
            </div>
            <details className="group border-[color:var(--findable-hairline,#23252a)] border-t pt-4">
              <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-sm">
                측정 이력 {brand.audits.length}회
                <ChevronDownIcon className="size-4 group-open:rotate-180" />
              </summary>
              <div className="mt-3 overflow-auto">
                <table className="w-full min-w-[620px] text-left text-xs">
                  <thead className="text-[color:var(--findable-ink-tertiary,#7e8289)]">
                    <tr>
                      <th className="pb-2">시점</th>
                      <th>상태</th>
                      <th>GEO</th>
                      <th>언급률</th>
                      <th>응답</th>
                      <th>브랜드 확인</th>
                      <th>오류</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brand.audits.map((audit) => (
                      <tr
                        className="border-[color:var(--findable-hairline,#23252a)] border-t"
                        key={audit.id}
                      >
                        <td className="py-2">{fmt(audit.measuredAt)}</td>
                        <td>
                          <Status value={audit.status} />
                        </td>
                        <td>
                          {audit.geoScore === null
                            ? "—"
                            : `${number(audit.geoScore)}점`}
                        </td>
                        <td>
                          {audit.sov === null ? "—" : `${number(audit.sov)}%`}
                        </td>
                        <td>{audit.responseCount}</td>
                        <td>{audit.mentionedResponses}</td>
                        <td>{audit.errorCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </article>
      ))}
    </section>
  );
}
