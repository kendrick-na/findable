// Findable 라이브 카운터 (D-044, 2026-05-07)
// Hero 직후 배치. DB count로 베타 운영 정직성 시각화.
//
// D2SF 양상환 평가 신호: "빠르고 집요한 창업팀" → 라이브 운영 숫자가 곧 증거.
//
// 데이터 소스: AuditJob 테이블 (Prisma + Neon)
// 캐시: 30분 ISR (베타 정밀 실시간 불필요, AI Gateway 비용 절감)
// 디자인 톤: hero.tsx와 동일한 --findable-* CSS 변수 + fadeup 애니메이션

import { database } from "@repo/database";

const BETA_LAUNCH_DATE = new Date("2026-05-04T00:00:00Z");

export const revalidate = 1800; // 30분

async function getLiveStats() {
  const now = new Date();
  const daysSinceLaunch = Math.max(
    1,
    Math.floor((now.getTime() - BETA_LAUNCH_DATE.getTime()) / 86400000)
  );

  try {
    const [auditCount, distinctDomains] = await Promise.all([
      database.auditJob.count({ where: { status: "completed" } }),
      database.auditJob.findMany({
        where: { status: "completed" },
        select: { domain: true },
        distinct: ["domain"],
      }),
    ]);

    return {
      daysSinceLaunch,
      auditCount,
      brandCount: distinctDomains.length,
      isLive: true,
    };
  } catch {
    return {
      daysSinceLaunch,
      auditCount: 0,
      brandCount: 0,
      isLive: false,
    };
  }
}

interface CounterCardProps {
  value: string;
  label: string;
  delay: string;
}

function CounterCard({ value, label, delay }: CounterCardProps) {
  return (
    <div
      className="flex flex-col items-center gap-2 opacity-0"
      style={{
        animation: `findable-fade-up-sm 0.5s var(--findable-ease-out-soft) ${delay} forwards`,
      }}
    >
      <span
        className="font-medium text-[40px] text-[var(--findable-ink)] leading-none tracking-tight md:text-[56px]"
        style={{ fontFamily: "var(--findable-font-display)" }}
      >
        {value}
      </span>
      <span
        className="text-[12px] uppercase tracking-[0.18em] text-[var(--findable-ink-tertiary)]"
        style={{ fontFamily: "var(--findable-font-sans)" }}
      >
        {label}
      </span>
    </div>
  );
}

interface LiveCounterProps {
  locale?: string;
}

export async function LiveCounter({ locale = "ko" }: LiveCounterProps) {
  const stats = await getLiveStats();
  const isKo = locale.startsWith("ko");
  const liveLabel = isKo ? "Live · 운영 중" : "Live · running now";
  const heading = isKo
    ? "지금 이 순간에도 한국 브랜드를 측정하고 있습니다"
    : "Right now, we're measuring Korean brands";
  const labels = isKo
    ? ["베타 운영", "진단 완료", "추적 브랜드"]
    : ["days in beta", "audits run", "brands tracked"];
  const numLocale = isKo ? "ko-KR" : "en-US";

  return (
    <section className="relative w-full bg-[var(--findable-canvas)] py-16 md:py-24">
      <div className="mx-auto max-w-5xl px-6">
        <div
          className="mb-10 flex flex-col items-center gap-3 opacity-0"
          style={{
            animation:
              "findable-fade-up-sm 0.5s var(--findable-ease-out-soft) 0.1s forwards",
          }}
        >
          <span
            className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--findable-ink-tertiary)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full bg-[var(--findable-primary)]"
              style={{
                boxShadow: stats.isLive
                  ? "0 0 0 0 var(--findable-glow-purple)"
                  : undefined,
                animation: stats.isLive
                  ? "findable-glow-pulse 2s ease-in-out infinite"
                  : undefined,
              }}
            />
            {liveLabel}
          </span>
          <h2
            className="text-center font-medium text-[20px] text-[var(--findable-ink-muted)] md:text-[22px]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {heading}
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-6 md:gap-12">
          <CounterCard
            value={`D+${stats.daysSinceLaunch}`}
            label={labels[0]}
            delay="0.2s"
          />
          <CounterCard
            value={stats.auditCount.toLocaleString(numLocale)}
            label={labels[1]}
            delay="0.3s"
          />
          <CounterCard
            value={stats.brandCount.toLocaleString(numLocale)}
            label={labels[2]}
            delay="0.4s"
          />
        </div>
      </div>
    </section>
  );
}
