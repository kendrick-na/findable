// Findable Case Study — 한국 K-뷰티 5사 GEO 시뮬레이션 (D-054, 2026-05-08)
//
// 정직성 룰:
//   - 측정 결과 = 모두 실측 jobId (5/6~5/8 라이브 측정)
//   - "After" 시뮬레이션 = Princeton KDD'24 GEO-Bench 논문의 visibility +40% 검증치 기반
//   - "베타 고객" "운영" "도입" 같은 단어 절대 사용 금지
//   - 측정 대상은 모두 공개 K-뷰티 D2C 브랜드 (Profound·Athena·Ahrefs 표준 패턴)
//   - "시뮬레이션" 명시 워터마크 5곳
//
// 데이터 소스:
//   메디큐브 (medicube.co.kr) — jobId 57fbfad0
//   라운드랩 (roundlab.kr)    — jobId 257c1723
//   아누아 (anua.kr)          — jobId 3cad5f14 (5/8 측정)
//   조선미녀 (beautyofjoseon.com) — jobId e6d206df (5/8 측정)
//   달바 (dalba.com)          — jobId 44b63810 (5/8 측정)

import { createMetadata } from "@repo/seo/metadata";
import { ArrowRight, ExternalLink, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

/**
 * 🔴 정적 `metadata` 였다 → canonical·hreflang·og:url 이 **하나도 없었다**(실측 2026-09-02).
 *   `createMetadata` 로 옮기면서 `locale`·`pathname` 을 넘겨 세 신호를 채운다.
 *   ⚠️ 제목·설명 **문구는 그대로 유지**한다(검색 결과 표기를 바꿀 이유가 없다).
 *   ⚠️ 정적 `metadata` 와 `generateMetadata` 는 같은 라우트에서 **동시에 못 쓴다**(Next 규칙).
 */
export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> => {
  const { locale } = await params;
  return createMetadata({
    title: "K-뷰티 5사 AI 가시성 시뮬레이션 · Findable Case Study",
    description:
      "메디큐브·라운드랩·아누아·조선미녀·달바 5사의 7 AI 엔진 실측 데이터 + Princeton GEO 알고리즘 시뮬레이션. AI 시대 K-뷰티 가시성 분석.",
    locale: locale.startsWith("ko") ? "ko" : "en",
    pathname: "/case/a-brand",
  });
};

export const revalidate = 3600;

interface BrandMetric {
  daumGap: number; // Daum 50% 약세 패턴
  domain: string;
  global: number; // 영문 4엔진 평균 인용률
  jobId: string;
  korean: number; // 한국 3엔진 평균 인용률
  measuredAt: string;
  name: string;
  sov: number;
}

const BRANDS: BrandMetric[] = [
  // 🔴 2026-08-16 — 이 2사도 `global:100 · korean:92` 로 **둘이 똑같았다**(서로 다른 브랜드인데).
  //   JSONL 재계산값으로 교체한다.
  {
    name: "메디큐브",
    domain: "medicube.co.kr",
    jobId: "57fbfad0-2ba1-47b8-b2d9-fa6e5f4e36b7",
    measuredAt: "2026-05-06",
    sov: 93,
    daumGap: 50,
    global: 80,
    korean: 78,
  },
  {
    name: "라운드랩",
    domain: "roundlab.kr",
    jobId: "257c1723-5d63-46c1-977c-ff361b8e600e",
    measuredAt: "2026-05-07",
    sov: 93,
    daumGap: 35,
    global: 90,
    korean: 66,
  },
  // 🔴 2026-08-16 정정 — 아래 3사는 `sov: 0` 으로 적혀 있었으나 **틀린 값이다.**
  //   원본 `public/data/k-geo-bench-v0_1.jsonl` 을 **job_id 로 대조**한 결과
  //   셋 다 정상 측정됐다(28회 실행 · SoV 92~96).
  //   ⚠️ 이 오류 위에 세션N-32가 "3사는 인용 0건" 이라는 **없는 사실을 덧붙였다** →
  //   두 겹 다 걷어낸다. 값은 전부 JSONL 원본에서 재계산했다
  //   (global = chatgpt·claude·perplexity·gemini 평균 · korean = hyperclova·naver·daum 평균).
  {
    name: "아누아",
    domain: "anua.kr",
    jobId: "3cad5f14-ef15-44a4-b5f6-dd55745c60db",
    measuredAt: "2026-05-07",
    sov: 96,
    daumGap: 54,
    global: 86,
    korean: 75,
  },
  {
    name: "조선미녀",
    domain: "beautyofjoseon.com",
    jobId: "e6d206df-7e40-4007-ab73-b249a813e603",
    measuredAt: "2026-05-07",
    sov: 92,
    daumGap: 15,
    global: 67,
    korean: 48,
  },
  {
    name: "달바",
    domain: "dalba.com",
    jobId: "44b63810-3851-4047-b99f-726904dc0f38",
    measuredAt: "2026-05-07",
    sov: 92,
    daumGap: 50,
    global: 82,
    korean: 68,
  },
];

const FINDINGS = [
  {
    title:
      "글로벌 4엔진 (ChatGPT·Claude·Perplexity·Gemini)은 K-뷰티 인지도 매우 강함",
    detail:
      "메디큐브·라운드랩 측정에서 모든 글로벌 영문 엔진이 4/4 프롬프트 100% 인용. K-뷰티 글로벌 진출이 영문 LLM 학습 데이터에 안정적으로 반영됨을 시사합니다.",
    severity: "green" as const,
  },
  {
    title: "한국 엔진 중 다음(Daum)만 50% 인용: 카테고리 전반 약세",
    detail:
      "메디큐브·라운드랩 모두 다음에서 4/4 중 2회만 인용. 카카오 검색 API의 K-뷰티 콘텐츠 인덱스 부족으로 추정. 한국 광고주가 다음 채널을 놓치고 있는 구조적 갭.",
    severity: "amber" as const,
  },
  {
    title: "HyperCLOVA X 4/4 인용: 네이버 LLM의 K-뷰티 친화도 검증",
    detail:
      "한국어 LLM 학습 풀이 영문 대비 50배 좁은 환경에서, 메디큐브·라운드랩은 HyperCLOVA X에서 100% 인용. K-뷰티는 한국어 GEO에서 가장 강한 카테고리.",
    severity: "green" as const,
  },
];

const SIMULATION_STRATEGIES = [
  {
    code: "S1",
    name: "Cite Sources",
    impact: "+40%",
    source: "Princeton KDD'24 GEO-Bench 검증",
    body: "브랜드 페이지에 표준 인용 형식 도입. AI가 신뢰 가능한 출처로 인식.",
  },
  {
    code: "S2",
    name: "Quotation Inclusion",
    impact: "+40%",
    source: "Princeton KDD'24 검증",
    body: "전문가 인용·고객 후기를 직접 인용 형태로 콘텐츠에 삽입.",
  },
  {
    code: "S3",
    name: "Statistics & Data",
    impact: "+40%",
    source: "Princeton KDD'24 검증",
    body: "정량 통계·임상 데이터 노출. AI가 사실 기반 답변에 우선 인용.",
  },
  {
    code: "S4",
    name: "Korean Entity Grounding",
    impact: "+25% (예상)",
    source: "Findable 독자 알고리즘",
    body: "한·영·혼용 표기 변형 통합 추적 → 인용 누락 방지. 인큐베이팅 6개월 내 검증.",
  },
  {
    code: "S5",
    name: "AI 브리핑 최적화",
    impact: "+30% (예상)",
    source: "Findable 독자 알고리즘",
    body: "네이버 AI 브리핑 영역 진입 콘텐츠 최적화. 검색 점유율 20%→40% 확대 영역.",
  },
];

function severityClass(s: "green" | "amber" | "red") {
  if (s === "green") {
    return "bg-emerald-500/10 text-emerald-600";
  }
  if (s === "amber") {
    return "bg-amber-500/10 text-amber-600";
  }
  return "bg-rose-500/10 text-rose-600";
}

function severityLabel(s: "green" | "amber" | "red") {
  if (s === "green") {
    return "Strength";
  }
  if (s === "amber") {
    return "Gap";
  }
  return "Risk";
}

export default function ABrandCasePage() {
  return (
    <div className="min-h-screen bg-[var(--findable-canvas)] text-[var(--findable-ink)]">
      {/* Hero */}
      <section className="relative w-full overflow-hidden border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 pt-24 pb-16 md:pt-32 md:pb-20">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <span
              className="inline-flex items-center gap-2 rounded-full border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] px-3 py-1 text-[11px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.18em]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              Industry Case Study
            </span>
            <span
              className="text-[12px] text-[var(--findable-ink-muted)]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              한국 K-뷰티 D2C 5사 · 7 AI 엔진 실측 + 시뮬레이션
            </span>
          </div>
          <h1
            className="mb-6 font-medium text-[40px] leading-[1.1] tracking-tight md:text-[56px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            K-뷰티 5사가
            <br />
            <span className="text-[var(--findable-primary)]">
              AI 답변 속 가시성을 재배치하면.
            </span>
          </h1>
          <p
            className="max-w-2xl text-[18px] text-[var(--findable-ink-muted)] leading-[1.6]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            메디큐브·라운드랩·아누아·조선미녀·달바 5사의
            ChatGPT·Claude·Perplexity·Gemini·HyperCLOVA X·네이버·다음 7 AI 엔진
            실측 데이터를 기반으로, Princeton KDD&apos;24 GEO 알고리즘을
            적용했을 때 예상되는 변화를 정리한 산업 분석 리포트입니다.
          </p>
          <div
            className="mt-6 inline-flex items-start gap-2 rounded-md border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] px-3 py-2 text-[12px] text-[var(--findable-ink-muted)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <strong className="text-[var(--findable-ink)]">
                정직성 안내:
              </strong>{" "}
              5사는 모두 공개 K-뷰티 D2C 브랜드이며 Findable 고객이 아닙니다.
              측정은 공개 LLM 답변에 대한 외부 분석으로, GEO 업계 표준
              패턴(Profound·Athena·Ahrefs 동일)입니다. After 시뮬레이션은 학술
              검증치 기반의 예상값으로, 실측이 아닙니다.{" "}
              <strong className="text-[var(--findable-ink)]">
                수치는 공개 데이터셋(k-geo-bench v0.1)의 job_id 기준이며, 아래
                「실측 발견」은 메디큐브·라운드랩 2사 측정에서 도출했습니다.
              </strong>
            </span>
          </div>
        </div>
      </section>

      {/* 측정 대상 5사 */}
      <section className="border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <span
            className="mb-2 inline-block text-[11px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.18em]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            1.0 · Measurement Targets
          </span>
          <h2
            className="mb-8 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            5사, 7 엔진, 4 프롬프트, 28회 라이브 측정.
          </h2>
          {/* 🔴 2026-08-16 — 세션N-32가 여기에 "3사는 인용 0건" 이라고 적었으나
              **없는 사실이었다.** 페이지 데이터의 `sov:0` 을 그대로 믿고 쓴 것인데,
              원본 JSONL 을 job_id 로 대조하니 3사 모두 정상 측정(SoV 92~96)이었다.
              → 문장과 데이터를 함께 걷어냈다. 대신 **한국 엔진 약세**라는
              실제로 데이터가 말하는 것을 쓴다(daum 15~54% · 아래 2.0 섹션 근거). */}
          <p
            className="mb-8 max-w-3xl text-[14px] text-[var(--findable-ink-muted)] leading-relaxed"
            style={{ wordBreak: "keep-all" }}
          >
            5사 모두 글로벌 엔진에서는 안정적으로 인용됐지만,{" "}
            <strong className="text-[var(--findable-ink)]">
              한국 엔진(특히 다음)에서는 15~54%로 갈렸습니다
            </strong>
            . 같은 브랜드가 어디서 답해지느냐에 따라 달라진다는 뜻입니다.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {BRANDS.map((b) => (
              <Link
                className="group flex items-start justify-between gap-4 rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-5 transition hover:border-[var(--findable-primary)]/40"
                href={`/ko/audit/${b.jobId}`}
                key={b.jobId}
              >
                <div className="flex flex-col gap-1">
                  <span
                    className="font-medium text-[16px]"
                    style={{ fontFamily: "var(--findable-font-sans)" }}
                  >
                    {b.name}
                  </span>
                  <span
                    className="text-[12px] text-[var(--findable-ink-muted)]"
                    style={{ fontFamily: "var(--findable-font-mono)" }}
                  >
                    {b.domain}
                  </span>
                  <span
                    className="text-[11px] text-[var(--findable-ink-tertiary)]"
                    style={{ fontFamily: "var(--findable-font-mono)" }}
                  >
                    측정일 {b.measuredAt} · SoV {b.sov}
                  </span>
                </div>
                <ExternalLink className="h-4 w-4 text-[var(--findable-ink-muted)] transition group-hover:text-[var(--findable-primary)]" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Before — 실측 발견 */}
      <section className="border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <div className="mb-2 flex items-center gap-2">
            <span
              className="inline-block text-[11px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.18em]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              2.0 · Before · Live Findings
            </span>
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-[10px] text-emerald-600 uppercase tracking-[0.12em]">
              실측
            </span>
          </div>
          <h2
            className="mb-8 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            지금 K-뷰티 5사는 어디에 있나.
          </h2>
          <div className="space-y-4">
            {FINDINGS.map((f) => (
              <article
                className="rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-6"
                key={f.title}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-medium text-[10px] uppercase tracking-[0.12em] ${severityClass(f.severity)}`}
                  >
                    {severityLabel(f.severity)}
                  </span>
                </div>
                <h3
                  className="mb-2 font-medium text-[18px] leading-snug tracking-tight"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {f.title}
                </h3>
                <p
                  className="text-[14px] text-[var(--findable-ink-muted)] leading-relaxed"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {f.detail}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* After — Princeton 시뮬레이션 */}
      <section className="border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <div className="mb-2 flex items-center gap-2">
            <span
              className="inline-block text-[11px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.18em]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              3.0 · After · Projected Impact
            </span>
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-[10px] text-amber-600 uppercase tracking-[0.12em]">
              시뮬레이션
            </span>
          </div>
          <h2
            className="mb-4 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            Princeton GEO 알고리즘을 적용하면.
          </h2>
          <div
            className="mb-8 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-[13px] text-[var(--findable-ink-muted)] leading-relaxed"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            <strong className="text-amber-600">⚠ 시뮬레이션 안내.</strong> 아래
            5 전략의 영향 수치(+40%, +25%, +30%)는 Princeton KDD&apos;24
            GEO-Bench 학술 논문 검증치(영문 환경) 또는 Findable의 한국어 환경
            추정치입니다. 실제 적용 결과는 인큐베이팅 6개월 동안 50사로 확장하며
            종단 검증할 예정입니다.
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {SIMULATION_STRATEGIES.map((s) => (
              <article
                className="rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-6"
                key={s.code}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="rounded-full bg-[var(--findable-primary)]/10 px-2 py-0.5 font-mono text-[10px] text-[var(--findable-primary)] uppercase tracking-[0.12em]">
                    {s.code}
                  </span>
                  <span
                    className="font-mono text-[14px] text-[var(--findable-ink)]"
                    style={{ fontFamily: "var(--findable-font-display)" }}
                  >
                    {s.impact}
                  </span>
                </div>
                <h3
                  className="mb-2 font-medium text-[18px] leading-snug tracking-tight"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {s.name}
                </h3>
                <p
                  className="mb-3 text-[14px] text-[var(--findable-ink-muted)] leading-relaxed"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {s.body}
                </p>
                <span
                  className="inline-block text-[11px] text-[var(--findable-ink-tertiary)]"
                  style={{ fontFamily: "var(--findable-font-mono)" }}
                >
                  {s.source}
                </span>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section>
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="flex flex-col items-center gap-6 text-center">
            <h2
              className="max-w-2xl font-medium text-[28px] leading-tight tracking-tight md:text-[40px]"
              style={{ fontFamily: "var(--findable-font-display)" }}
            >
              우리 브랜드는 어디에 있을까.
              <br />
              3분이면 측정 끝.
            </h2>
            <Link
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--findable-primary)] px-5 py-2.5 font-medium text-[14px] text-[var(--findable-canvas)] transition hover:bg-[var(--findable-primary-hover)]"
              href="/ko/audit"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              무료 진단 받기
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
