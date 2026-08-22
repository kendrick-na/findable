// Findable 라이브 카운터 (D-044, 2026-05-07)
// Hero 직후 배치. DB count로 베타 운영 정직성 시각화.
//
// D2SF 양상환 평가 신호: "빠르고 집요한 창업팀" → 라이브 운영 숫자가 곧 증거.
//
// 데이터 소스: AuditJob 테이블 (Prisma + Neon)
// 캐시: 30분 ISR (베타 정밀 실시간 불필요, AI Gateway 비용 절감)
// 디자인 톤: hero.tsx와 동일한 --findable-* CSS 변수 + fadeup 애니메이션

import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import Link from "next/link";
import { loadDatasetResponseCount } from "./sov-chart-data";

const BETA_LAUNCH_DATE = new Date("2026-05-04T00:00:00Z");

// ⚠️ revalidate 는 page/layout 세그먼트에서만 유효 — 컴포넌트 파일 export 는 무효라 제거(2026-07-30).
//    실제 30분 캐시는 (home)/page.tsx 의 `export const revalidate = 1800` 이 담당.

async function getLiveStats() {
  const now = new Date();
  const daysSinceLaunch = Math.max(
    1,
    Math.floor((now.getTime() - BETA_LAUNCH_DATE.getTime()) / 86_400_000)
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
  } catch (error) {
    // 🔴 세션N-38: 원래 `catch {}` 로 **아무 말 없이** 0 을 반환했다.
    //   그래서 DB 조회가 실패하면 랜딩 히어로 바로 아래에 `0 진단 · 0 브랜드` 가
    //   **사실인 것처럼** 서고, 로그가 없어 아무도 모른다
    //   (실측: 로컬에서 정확히 이 상태가 재현됐고 원인을 찾는 데 조회를 세 번 돌려야 했다.
    //    프로덕션은 `103 · 29` 로 정상이었다 — 즉 **조용해서 구분이 안 되는 것**이 문제다).
    //
    //   ⚠️ 0 은 이 저장소가 반복해 온 **"못 잰 것을 0이라 부르기"** 그 자체다.
    //   게다가 이 숫자는 **신뢰도 증거**로 쓰려고 둔 자리라, 실패했을 때 0 을 보여주면
    //   증거가 아니라 **역효과**(= "아무도 안 쓰는 서비스")를 낸다.
    //
    //   → 값은 그대로 0 을 두되(레이아웃 보존) **`isLive: false` 로 표시**하고
    //     반드시 로그를 남긴다. 표시 측은 `isLive` 로 렌더 여부를 정한다.
    log.error("landing.live_counter.query_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      daysSinceLaunch,
      auditCount: 0,
      brandCount: 0,
      isLive: false,
    };
  }
}

interface CounterCardProps {
  delay: string;
  /** 주면 카드 전체가 링크가 된다(데이터셋 → /research) */
  href?: string;
  label: string;
  value: string;
}

function CounterCard({ value, label, delay, href }: CounterCardProps) {
  const body = (
    <>
      <span
        className="font-medium text-[40px] text-[var(--findable-ink)] leading-none tracking-tight md:text-[56px]"
        style={{ fontFamily: "var(--findable-font-display)" }}
      >
        {value}
      </span>
      <span
        className="text-center text-[12px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.18em]"
        style={{ fontFamily: "var(--findable-font-sans)" }}
      >
        {label}
      </span>
    </>
  );
  const className = "flex flex-col items-center gap-2 opacity-0";
  const style = {
    animation: `findable-fade-up-sm 0.5s var(--findable-ease-out-soft) ${delay} forwards`,
  };

  // 🔴 숫자를 보여주고 근거로 갈 곳이 없으면 그냥 자랑이다.
  //   데이터셋 카드만 눌러서 원본까지 갈 수 있게 한다.
  if (href) {
    return (
      <Link
        className={`${className} transition hover:opacity-80`}
        href={href}
        style={style}
      >
        {body}
      </Link>
    );
  }
  return (
    <div className={className} style={style}>
      {body}
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
  // 🔴 카드가 「누적 진단 + 공개 데이터셋」으로 바뀌었으니 제목도 맞춘다.
  //   "지금 이 순간에도 측정 중"은 누적 수치와 어긋나는 문장이었다.
  const heading = isKo
    ? "측정한 것만 이야기합니다"
    : "We only talk about what we measured";
  const labels = isKo
    ? ["진단 완료", "추적 브랜드", "측정 데이터셋"]
    : ["audits run", "brands tracked", "open dataset"];
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
            className="inline-flex items-center gap-2 text-[11px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.18em]"
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

        {/* 🔴 2026-08-16 (E) — `D+101 베타 운영` 을 뺐다.
            v4 §6-g 가 이 섹션을 **🟡약함**으로 판정했는데, 이유가 여기 있었다:
            "며칠째 운영 중"은 **우리 사정**이지 방문자에게는 증거가 아니다.
            (오히려 D+101 인데 진단 88건 = "느리다"로 읽힐 수도 있다.)

            ⭐ 경쟁사가 이 자리에 두는 3가지를 우리는 **하나도 못 쓴다**(실측):
              Profound 고객 로고 18개 · Scrunch "500개사" · Peec 실명 인용
              → 고객 0명이라 흉내내면 그 순간 날조가 된다.
            ⭐ 대신 **경쟁사 4곳이 못 가진 것**을 쓴다 — 라이브 fetch 확인 결과
              peec·scrunch·otterly·profound **전부 공개 데이터셋이 없다**.
              우리는 `k-geo-bench v0.1` 을 **CC BY 4.0** 으로 공개했다.
            → 「측정 응답 140건 · 공개 데이터셋」 이 고객 없이도 성립하는 증거다. */}
        <div className="grid grid-cols-3 gap-6 md:gap-12">
          {/* 🔴 세션N-38: 조회가 실패하면 `0` 이 아니라 `—` 를 세운다.
              `0 진단 · 0 브랜드` 는 **사실처럼 읽히는 거짓**이고, 하필 이 자리가
              신뢰도 증거라 "아무도 안 쓰는 서비스"라는 **역효과**를 낸다.
              (이 저장소의 「못 잰 것을 0이라 부르기」 계열 — apple.com 사고와 같다.
               `sources-board` 도 분모 0 이면 `—` 로 막는다. 같은 규칙을 여기도 적용.) */}
          <CounterCard
            delay="0.2s"
            label={labels[0]}
            value={
              stats.isLive ? stats.auditCount.toLocaleString(numLocale) : "—"
            }
          />
          <CounterCard
            delay="0.3s"
            label={labels[1]}
            value={
              stats.isLive ? stats.brandCount.toLocaleString(numLocale) : "—"
            }
          />
          {/* 🔴 세 번째 칸은 **숫자**여야 한다 — 옆 두 칸이 숫자인데 "공개"만 글자면
              같은 축으로 안 읽힌다. 140 = 데이터셋의 실제 측정 응답 수이고
              `/research` 가 이미 쓰는 값이다(수치 두 벌 금지). */}
          <CounterCard
            delay="0.4s"
            href={`${isKo ? "/ko" : ""}/research/k-geo-bench-v0_1`}
            label={labels[2]}
            value={loadDatasetResponseCount().toLocaleString(numLocale)}
          />
        </div>
      </div>
    </section>
  );
}
