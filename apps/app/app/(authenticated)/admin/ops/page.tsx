import { isAdmin } from "@repo/auth/admin";
import { database } from "@repo/database";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "../../components/header";

export const metadata: Metadata = {
  title: "운영 현황",
  description: "audit·리드·파트너 신청 읽기전용 운영 대시보드",
};

// sweep-stuck-jobs cron 의 STALE_AFTER_MS(15분)와 동일 기준.
const STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * 과금 방식 이름표. 🔴 영문 슬러그를 화면에 그대로 내보내지 않는다
 * (📕 N-38 에 `naver-briefing` 이 화면에 노출된 사고와 같은 유형).
 */
const COST_BASIS_LABEL: Record<string, string> = {
  token: "토큰 과금",
  browser: "브라우저 세션",
  free: "무료 티어",
  unknown: "미측정",
};

const AUDIT_STATUSES = ["queued", "processing", "completed", "failed"] as const;
const CREW_STATUSES = [
  "not_requested",
  "queued",
  "processing",
  "completed",
  "failed",
] as const;
const PARTNER_STATUSES = ["pending", "approved", "rejected"] as const;

type AuditStatus = (typeof AUDIT_STATUSES)[number];
type CrewStatus = (typeof CREW_STATUSES)[number];
type PartnerStatus = (typeof PARTNER_STATUSES)[number];

// groupBy 결과([{ status, _count }])를 label→count 맵으로 접어 안전하게 조회.
function countByStatus<T extends string>(
  rows: { status: T; _count: number }[],
  labels: readonly T[]
): Record<T, number> {
  const map = {} as Record<T, number>;
  for (const label of labels) {
    map[label] = 0;
  }
  for (const row of rows) {
    map[row.status] = row._count;
  }
  return map;
}

const numberFormatter = new Intl.NumberFormat("ko-KR");
const fmt = (n: number) => numberFormatter.format(n);

const AdminOpsPage = async () => {
  if (!(await isAdmin())) {
    notFound();
  }

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);

  const [
    auditToday,
    audit7d,
    auditTotal,
    auditByStatus,
    auditByCrewStatus,
    stuckCount,
    leadToday,
    lead7d,
    leadTotal,
    partnerByStatus,
    brandCount,
    trackingCount,
    costAgg,
    costByBasis,
    costMeasured,
  ] = await Promise.all([
    database.auditJob.count({ where: { createdAt: { gte: startOfToday } } }),
    database.auditJob.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    database.auditJob.count(),
    database.auditJob.groupBy({ by: ["status"], _count: true }),
    database.auditJob.groupBy({ by: ["crewStatus"], _count: true }),
    database.auditJob.count({
      where: {
        status: { in: ["queued", "processing"] },
        createdAt: { lt: staleBefore },
      },
    }),
    database.lead.count({ where: { createdAt: { gte: startOfToday } } }),
    database.lead.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    database.lead.count(),
    database.partnerApplication.groupBy({ by: ["status"], _count: true }),
    database.brand.count(),
    database.tracking.count(),
    // 🔴 **원가 계기**(세션N-47). 여기 오기 전엔 측정 1건 원가를 **아무도 몰랐다**
    //   (`cost.ts` 는 있었는데 프로덕션 호출 0곳 · 토큰을 저장조차 안 했다).
    //   ⚠️ `costKrw: { not: null }` 로 **못 잰 회차를 분모에서 뺀다** —
    //   null 을 0원으로 더하면 "공짜로 돌고 있다"는 착각을 만든다(📕 최다 사고 유형).
    database.tracking.aggregate({
      _sum: { costKrw: true, inputTokens: true, outputTokens: true },
      where: { costKrw: { not: null } },
    }),
    database.tracking.groupBy({
      by: ["costBasis"],
      _count: true,
      _sum: { costKrw: true },
    }),
    database.tracking.count({ where: { costKrw: { not: null } } }),
  ]);

  // 원가 집계 — 「못 잼」을 0원으로 세지 않는다.
  const totalCostKrw = costAgg._sum.costKrw ?? 0;
  const avgPerCall = costMeasured > 0 ? totalCostKrw / costMeasured : 0;
  const unmeasuredCount = trackingCount - costMeasured;
  // 과금 방식별 분포(token/browser/free/unknown) — 어디에 돈이 나가는지 가른다.
  const costBasisRows = costByBasis
    .filter((r) => r.costBasis !== null)
    .sort((a, b) => (b._sum.costKrw ?? 0) - (a._sum.costKrw ?? 0));

  const auditStatus = countByStatus(
    auditByStatus.map((r) => ({
      status: r.status as AuditStatus,
      _count: r._count,
    })),
    AUDIT_STATUSES
  );
  const crewStatus = countByStatus(
    auditByCrewStatus.map((r) => ({
      status: r.crewStatus as CrewStatus,
      _count: r._count,
    })),
    CREW_STATUSES
  );
  const partnerStatus = countByStatus(
    partnerByStatus.map((r) => ({
      status: r.status as PartnerStatus,
      _count: r._count,
    })),
    PARTNER_STATUSES
  );

  return (
    <>
      <Header page="운영 현황" pages={["관리자"]} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tracking-tight">
            운영 현황
          </h1>
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
            audit·리드·파트너 신청을 한눈에 보는 읽기전용 운영 대시보드입니다.
          </p>
        </div>

        {/* 🔴 원가 — 요금제 설계의 분모. 측정 1건이 얼마인지 여기서만 알 수 있다. */}
        <Section
          note={
            costMeasured === 0
              ? "아직 원가를 잰 측정이 없어요. 다음 측정부터 쌓입니다(기존 회차는 소급 불가)."
              : `원가를 잰 측정 ${fmt(costMeasured)}건 기준 · 단가는 추정이라 청구서로 보정해야 해요`
          }
          title="측정 원가"
        >
          <CardGrid>
            {/* ⚠️ 0건일 때 `0원`을 찍지 않는다 — 「공짜」가 아니라 「아직 못 쟀다」이다. */}
            <StatCard
              hint="원가를 잰 회차 합계"
              label="누적 원가"
              value={
                costMeasured === 0 ? "—" : `₩${fmt(Math.round(totalCostKrw))}`
              }
            />
            <StatCard
              hint={costMeasured === 0 ? undefined : "엔진 호출 1회 평균"}
              label="호출 1회 평균"
              value={costMeasured === 0 ? "—" : `₩${avgPerCall.toFixed(1)}`}
            />
            <StatCard
              hint="토큰 과금 엔진 합계"
              label="누적 토큰"
              muted
              value={
                costMeasured === 0
                  ? "—"
                  : fmt(
                      (costAgg._sum.inputTokens ?? 0) +
                        (costAgg._sum.outputTokens ?? 0)
                    )
              }
            />
            <StatCard
              hint="원가를 못 잰 회차 — 0원이 아니다"
              label="미측정"
              muted
              tone={unmeasuredCount > 0 ? "warn" : "ok"}
              value={fmt(unmeasuredCount)}
            />
          </CardGrid>
          {costBasisRows.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
              {costBasisRows.map((r) => (
                <span key={r.costBasis}>
                  {COST_BASIS_LABEL[r.costBasis as string] ?? r.costBasis}{" "}
                  {fmt(r._count)}회 · ₩{fmt(Math.round(r._sum.costKrw ?? 0))}
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* audit 현황 */}
        <Section title="Audit 잡">
          <CardGrid>
            <StatCard label="오늘 생성" value={fmt(auditToday)} />
            <StatCard label="최근 7일" value={fmt(audit7d)} />
            <StatCard label="누적" muted value={fmt(auditTotal)} />
            <StatCard
              label="Stuck (15분 초과 대기/진행)"
              tone={stuckCount > 0 ? "warn" : "ok"}
              value={fmt(stuckCount)}
            />
          </CardGrid>
        </Section>

        {/* audit status 분포 */}
        <Section title="Audit status 분포">
          <CardGrid>
            <StatCard label="대기 (queued)" value={fmt(auditStatus.queued)} />
            <StatCard
              label="진행 (processing)"
              value={fmt(auditStatus.processing)}
            />
            <StatCard
              label="완료 (completed)"
              tone="ok"
              value={fmt(auditStatus.completed)}
            />
            <StatCard
              label="실패 (failed)"
              tone={auditStatus.failed > 0 ? "warn" : "ok"}
              value={fmt(auditStatus.failed)}
            />
          </CardGrid>
        </Section>

        {/* crewStatus 분포 (강화 모드 4에이전트) */}
        <Section title="Crew status 분포 (강화 모드)">
          <CardGrid>
            <StatCard
              label="미요청 (not_requested)"
              muted
              value={fmt(crewStatus.not_requested)}
            />
            <StatCard label="대기 (queued)" value={fmt(crewStatus.queued)} />
            <StatCard
              label="진행 (processing)"
              value={fmt(crewStatus.processing)}
            />
            <StatCard
              label="완료 (completed)"
              tone="ok"
              value={fmt(crewStatus.completed)}
            />
            <StatCard
              label="실패 (failed)"
              tone={crewStatus.failed > 0 ? "warn" : "ok"}
              value={fmt(crewStatus.failed)}
            />
          </CardGrid>
        </Section>

        {/* Lead */}
        <Section title="리드 (Lead)">
          <CardGrid>
            <StatCard label="오늘 유입" value={fmt(leadToday)} />
            <StatCard label="최근 7일" value={fmt(lead7d)} />
            <StatCard label="누적" muted value={fmt(leadTotal)} />
          </CardGrid>
        </Section>

        {/* PartnerApplication */}
        <Section title="파트너 신청 (PartnerApplication)">
          <CardGrid>
            <StatCard
              hint="승인 대기 — 처리 필요"
              label="대기 (pending)"
              tone={partnerStatus.pending > 0 ? "warn" : "ok"}
              value={fmt(partnerStatus.pending)}
            />
            <StatCard
              label="승인 (approved)"
              tone="ok"
              value={fmt(partnerStatus.approved)}
            />
            <StatCard
              label="거절 (rejected)"
              muted
              value={fmt(partnerStatus.rejected)}
            />
          </CardGrid>
        </Section>

        {/* Brand / Tracking — runner 미적재라 정직하게 표기 */}
        <Section
          note="아직 runner 가 적재하지 않았습니다. 0 이면 미적재로 읽으세요."
          title="Brand · Tracking (미적재)"
        >
          <CardGrid>
            <StatCard
              label="Brand"
              muted
              value={brandCount === 0 ? "미적재" : fmt(brandCount)}
            />
            <StatCard
              label="Tracking"
              muted
              value={trackingCount === 0 ? "미적재" : fmt(trackingCount)}
            />
          </CardGrid>
        </Section>
      </div>
    </>
  );
};

// ── 프레젠테이션 헬퍼 (서버 컴포넌트, 인터랙션 없음) ──

const Section = ({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) => (
  <section className="flex flex-col gap-3">
    <div className="flex flex-col gap-0.5">
      <h2 className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm tracking-tight">
        {title}
      </h2>
      {note ? (
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
          {note}
        </p>
      ) : null}
    </div>
    {children}
  </section>
);

const CardGrid = ({ children }: { children: React.ReactNode }) => (
  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
    {children}
  </div>
);

const TONE_VALUE_CLASS: Record<"ok" | "warn", string> = {
  ok: "text-[color:var(--findable-ink,#f7f8f8)]",
  warn: "text-[color:var(--findable-primary,#ff7a4d)]",
};

const StatCard = ({
  label,
  value,
  hint,
  muted,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  muted?: boolean;
  tone?: "ok" | "warn";
}) => {
  const mutedClass = muted
    ? "text-[color:var(--findable-ink-muted,#d0d6e0)]"
    : "text-[color:var(--findable-ink,#f7f8f8)]";
  const valueClass = tone ? TONE_VALUE_CLASS[tone] : mutedClass;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-4">
      <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
        {label}
      </span>
      <span className={`font-semibold text-2xl tracking-tight ${valueClass}`}>
        {value}
      </span>
      {hint ? (
        <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
          {hint}
        </span>
      ) : null}
    </div>
  );
};

export default AdminOpsPage;
