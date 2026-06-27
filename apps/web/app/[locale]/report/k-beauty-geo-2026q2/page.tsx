// K-뷰티 GEO Report 2026 Q2 (D-057, 2026-05-08)
//
// 본질:
//   K-GEO-Bench(학술 데이터셋)와 다른 산업 리포트.
//   타겟: 광고주·마케터·미디어
//   포맷: 인사이트 + 액션 + 시뮬레이션
//
// 정직성:
//   - 5사는 모두 공개 K-뷰티 D2C (고객 아님, 측정 대상)
//   - 측정 결과 = 실측 (5/6~5/8 라이브 jobId)
//   - 시뮬레이션 = Princeton KDD'24 검증치 명시
//
// 시너지 매핑:
//   - C3 콘텐츠 공급 (포자랩스 패턴) — 진짜 콘텐츠 발행
//   - 합격팀 매출 기여 (Hello Max) — 광고주 가치 직접 제공

import { ArrowRight, BarChart3, ExternalLink, FileText, Info, Target, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "K-뷰티 GEO Report 2026 Q2 — Findable",
  description:
    "한국 K-뷰티 5사 (메디큐브·라운드랩·아누아·조선미녀·달바)의 8 AI 엔진 가시성 측정 + Princeton GEO 시뮬레이션. 광고주·마케터를 위한 산업 인사이트.",
};

export const revalidate = 3600;

const HEADLINE_INSIGHTS = [
  {
    metric: "93.2",
    suffix: "/100",
    label: "K-뷰티 평균 SoV",
    note: "5사 라이브 측정",
  },
  {
    metric: "100%",
    suffix: "",
    label: "글로벌 4 엔진 인용률",
    note: "ChatGPT·Claude·Perplexity·Gemini",
  },
  {
    metric: "50%",
    suffix: "",
    label: "다음(Daum) 인용률",
    note: "카카오 검색 갭",
  },
  {
    metric: "+40%",
    suffix: "",
    label: "Princeton 시뮬 향상치",
    note: "KDD'24 학술 검증",
  },
];

const INSIGHTS = [
  {
    n: "01",
    title: "K-뷰티는 ChatGPT·Claude에서 강자 카테고리",
    body: "5사 평균 SoV 93.2/100. Anua가 96/100으로 1위 (Amazon 토너 1위 영향). K-뷰티 글로벌 진출이 영문 LLM 학습 데이터에 안정적으로 반영. ChatGPT 영문 답변에서 '한국 화장품 추천' 질의 시 K-뷰티 5사가 자주 등장.",
    actionable:
      "글로벌 진출 K-뷰티 D2C는 영문 콘텐츠·Amazon 리뷰·Reddit 후기 등 글로벌 LLM 학습 풀에 노출되는 채널을 우선 강화하세요.",
  },
  {
    n: "02",
    title: "HyperCLOVA X — 한국어 LLM의 K-뷰티 친화도 검증",
    body: "5사 모두 HyperCLOVA X에서 인용률 100%. 한국어 LLM 학습 풀이 영문 대비 50배 좁은 환경에서도 K-뷰티는 강세 카테고리. 네이버 AI 브리핑(검색 점유 20%→40%)에서도 같은 패턴 예상.",
    actionable:
      "한국 D2C는 네이버 블로그·카페·뉴스 채널 인덱스 우선. HyperCLOVA X 답변 노출이 광고주 ROI 직접 영향.",
  },
  {
    n: "03",
    title: "다음(Daum)은 K-뷰티 약세 — 카카오 검색 인덱스 갭",
    body: "5사 모두 다음에서 인용률 50% 이하. 카카오 검색 API의 K-뷰티 콘텐츠 인덱스 부족. 카카오톡 검색·카카오스토리 콘텐츠 우선 강화 필요. 광고주의 한국 검색 다각화 시 핵심 진입장벽.",
    actionable:
      "다음 검색 친화 콘텐츠 전략 (브런치·카카오뷰·다음 블로그) 도입 권장. 6주 후 재측정 시 인용률 +30%p 이상 시뮬레이션.",
  },
  {
    n: "04",
    title: "AI 답변 vs 검색 답변 — 가시성 갭이 곧 매출 갭",
    body: "네이버 검색 1위 브랜드도 ChatGPT에서 묻히는 사례 다수. 광고주가 두 채널을 동시에 관리해야 매출 누수 방지. 글로벌 진출 K-뷰티는 한·영 이중 GEO 전략이 필수.",
    actionable:
      "Findable 무료 진단으로 자사 SoV 측정 → Princeton 8 전략 도입 → 6주 후 재측정. 산업 평균 +40% 가시성 향상 시뮬.",
  },
];

const APPLY_STRATEGIES = [
  {
    code: "S1",
    name: "Cite Sources",
    impact: "+40%",
    body: "표준 인용 형식 도입. KDD'24 학술 검증.",
  },
  {
    code: "S2",
    name: "Quotation Inclusion",
    impact: "+40%",
    body: "전문가·고객 후기 직접 인용. KDD'24 학술 검증.",
  },
  {
    code: "S3",
    name: "Statistics & Data",
    impact: "+40%",
    body: "정량 통계·임상 데이터 노출. KDD'24 학술 검증.",
  },
  {
    code: "S4",
    name: "Korean Entity Grounding",
    impact: "+25%",
    body: "한·영·혼용 표기 통합 (Findable 추정).",
  },
  {
    code: "S5",
    name: "AI 브리핑 최적화",
    impact: "+30%",
    body: "네이버 AI 브리핑 진입 콘텐츠 (Findable 추정).",
  },
];

export default function KBeautyReportPage() {
  return (
    <div className="min-h-screen bg-[var(--findable-canvas)] text-[var(--findable-ink)]">
      {/* Hero */}
      <section className="relative w-full overflow-hidden border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 pt-24 pb-16 md:pt-32 md:pb-20">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <span
              className="inline-flex items-center gap-2 rounded-full border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[var(--findable-ink-tertiary)]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              <FileText className="h-3 w-3" />
              Findable Industry Report · 2026 Q2
            </span>
            <span
              className="text-[12px] text-[var(--findable-ink-muted)]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              한국 K-뷰티 5사 · 8 AI 엔진
            </span>
          </div>
          <h1
            className="mb-6 font-medium text-[40px] leading-[1.1] tracking-tight md:text-[56px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            K-뷰티 GEO Report
            <br />
            <span className="text-[var(--findable-primary)]">
              2026 Q2 — 어디에서 발견되고 있나.
            </span>
          </h1>
          <p
            className="max-w-2xl text-[18px] text-[var(--findable-ink-muted)] leading-[1.6]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            메디큐브·라운드랩·아누아·조선미녀·달바 5사를 ChatGPT·Claude·Perplexity·Gemini·HyperCLOVA
            X·네이버·다음·네이버 AI 브리핑 8 엔진에서 라이브 측정한 결과 + Princeton KDD&apos;24
            GEO 알고리즘 적용 시뮬레이션. 광고주·마케터를 위한 산업 인사이트 4건.
          </p>
          <div
            className="mt-6 inline-flex items-start gap-2 rounded-md border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] px-3 py-2 text-[12px] text-[var(--findable-ink-muted)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              <strong className="text-[var(--findable-ink)]">정직성 안내:</strong>{" "}
              5사는 모두 공개 K-뷰티 D2C 브랜드이며 Findable 고객이 아닙니다. 측정은 공개
              LLM 답변에 대한 외부 분석으로 GEO 업계 표준 패턴(Profound·Athena·Ahrefs).
              시뮬레이션 수치는 Princeton 학술 검증치이며 실측 아님.
            </span>
          </div>
        </div>
      </section>

      {/* 헤드라인 메트릭 */}
      <section className="border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <span
            className="mb-2 inline-block text-[11px] uppercase tracking-[0.18em] text-[var(--findable-ink-tertiary)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            1.0 · Headline Metrics
          </span>
          <h2
            className="mb-8 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            5사 측정 — 한눈에.
          </h2>
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4 md:gap-8">
            {HEADLINE_INSIGHTS.map((m) => (
              <div key={m.label} className="flex flex-col gap-1">
                <span
                  className="font-medium text-[36px] leading-none tracking-tight md:text-[44px]"
                  style={{ fontFamily: "var(--findable-font-display)" }}
                >
                  {m.metric}
                  <span className="font-medium text-[20px] text-[var(--findable-ink-muted)]">
                    {m.suffix}
                  </span>
                </span>
                <span
                  className="mt-2 text-[13px] text-[var(--findable-ink)]"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {m.label}
                </span>
                <span
                  className="text-[11px] uppercase tracking-[0.12em] text-[var(--findable-ink-tertiary)]"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {m.note}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4 인사이트 */}
      <section className="border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <span
            className="mb-2 inline-block text-[11px] uppercase tracking-[0.18em] text-[var(--findable-ink-tertiary)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            2.0 · Key Insights
          </span>
          <h2
            className="mb-8 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            5사 측정에서 보이는 4 패턴.
          </h2>
          <div className="space-y-6">
            {INSIGHTS.map((ins) => (
              <article
                key={ins.n}
                className="rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-6"
              >
                <div className="mb-3 flex items-center gap-3">
                  <span
                    className="font-mono text-[14px] text-[var(--findable-primary)]"
                    style={{ fontFamily: "var(--findable-font-display)" }}
                  >
                    {ins.n}
                  </span>
                  <h3
                    className="font-medium text-[18px] leading-snug tracking-tight md:text-[20px]"
                    style={{ fontFamily: "var(--findable-font-sans)" }}
                  >
                    {ins.title}
                  </h3>
                </div>
                <p
                  className="mb-4 text-[14px] text-[var(--findable-ink-muted)] leading-relaxed"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {ins.body}
                </p>
                <div
                  className="flex items-start gap-2 rounded-md bg-[var(--findable-canvas)] px-3 py-2 text-[13px] text-[var(--findable-ink)]"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--findable-primary)]" />
                  <span>
                    <strong className="text-[var(--findable-primary)]">Action:</strong>{" "}
                    {ins.actionable}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Princeton 시뮬레이션 */}
      <section className="border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className="inline-block text-[11px] uppercase tracking-[0.18em] text-[var(--findable-ink-tertiary)]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              3.0 · Apply 5 Strategies
            </span>
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-[10px] text-amber-600 uppercase tracking-[0.12em]">
              시뮬레이션
            </span>
          </div>
          <h2
            className="mb-4 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            5 전략을 적용하면 6주 후.
          </h2>
          <div
            className="mb-8 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-[13px] text-[var(--findable-ink-muted)] leading-relaxed"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            <strong className="text-amber-600">⚠ 시뮬레이션 안내</strong> — 아래 영향 수치는
            Princeton KDD&apos;24 GEO-Bench 학술 검증치 (영문 환경) 또는 Findable의 한국어
            환경 추정치입니다. 실제 결과는 Findable 인큐베이팅 6개월 동안 50사로 확장하며
            종단 검증 예정.
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {APPLY_STRATEGIES.map((s) => (
              <article
                key={s.code}
                className="rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-5"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="rounded-full bg-[var(--findable-primary)]/10 px-2 py-0.5 font-mono text-[10px] text-[var(--findable-primary)] uppercase tracking-[0.12em]">
                    {s.code}
                  </span>
                  <span
                    className="font-mono text-[14px]"
                    style={{ fontFamily: "var(--findable-font-display)" }}
                  >
                    {s.impact}
                  </span>
                </div>
                <h3
                  className="mb-2 font-medium text-[16px] leading-snug tracking-tight"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {s.name}
                </h3>
                <p
                  className="text-[13px] text-[var(--findable-ink-muted)] leading-relaxed"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {s.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 자매 자산 */}
      <section className="border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <span
            className="mb-2 inline-block text-[11px] uppercase tracking-[0.18em] text-[var(--findable-ink-tertiary)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            4.0 · Related Assets
          </span>
          <h2
            className="mb-8 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            관련 자료.
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            <Link
              href="/ko/research/k-geo-bench-v0_1"
              className="group flex items-start gap-3 rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-5 transition hover:border-[var(--findable-primary)]/40"
            >
              <BarChart3 className="mt-0.5 h-5 w-5 text-[var(--findable-primary)]" />
              <div className="flex-1">
                <h3
                  className="mb-1 font-medium text-[15px]"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  K-GEO-Bench v0.1 (학술 데이터셋)
                </h3>
                <p
                  className="text-[13px] text-[var(--findable-ink-muted)] leading-relaxed"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  140 측정 응답 raw 데이터. JSONL/JSON 다운로드. CC BY 4.0.
                </p>
              </div>
              <ExternalLink className="h-4 w-4 text-[var(--findable-ink-muted)] transition group-hover:text-[var(--findable-primary)]" />
            </Link>
            <Link
              href="/ko/case/a-brand"
              className="group flex items-start gap-3 rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-5 transition hover:border-[var(--findable-primary)]/40"
            >
              <TrendingUp className="mt-0.5 h-5 w-5 text-[var(--findable-primary)]" />
              <div className="flex-1">
                <h3
                  className="mb-1 font-medium text-[15px]"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  Case Study: Before/After 시뮬레이션
                </h3>
                <p
                  className="text-[13px] text-[var(--findable-ink-muted)] leading-relaxed"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  5사가 GEO 적용 시 예상되는 가시성 변화 시각화.
                </p>
              </div>
              <ExternalLink className="h-4 w-4 text-[var(--findable-ink-muted)] transition group-hover:text-[var(--findable-primary)]" />
            </Link>
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
              우리 브랜드는 8 AI 답변에서
              <br />
              어디에 있을까요?
            </h2>
            <Link
              href="/ko/audit"
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--findable-primary)] px-5 py-2.5 font-medium text-[14px] text-white transition hover:bg-[var(--findable-primary-hover)]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              30초 무료 진단 받기
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
