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

import { JsonLd } from "@repo/seo/json-ld";
import { createMetadata } from "@repo/seo/metadata";
import {
  ArrowRight,
  BarChart3,
  ExternalLink,
  FileText,
  Info,
  Target,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { FooterCTA } from "../../(home)/components/footer-cta";
import { Footer } from "../../components/footer";
import { PublicLandingHeader } from "../../components/public-landing-header";

const DESCRIPTION =
  "한국 K-뷰티 5사 (메디큐브·라운드랩·아누아·조선미녀·달바)의 7 AI 엔진 가시성 측정 + Princeton GEO 시뮬레이션. 광고주·마케터를 위한 산업 인사이트.";
const PATHNAME = "/report/k-beauty-geo-2026q2";
const SITE_URL = "https://www.findable.co.kr";
const canonicalFor = (locale: string) =>
  `${SITE_URL}/${locale.startsWith("ko") ? "ko" : "en"}${PATHNAME}`;

/**
 * 🔴 **2026-08-17 세션N-39 — 이 페이지엔 canonical 이 없었다.**
 *   `Metadata` 객체를 직접 쓰느라 `createMetadata`(canonical·hreflang·og:url 담당)를
 *   **우회**하고 있었다. 하필 이 페이지는 **AI 가 인용할 실측 콘텐츠**라
 *   (블로그는 비어 있고 실질 자산이 이것과 k-geo-bench 둘뿐) 정규 URL 신호가 제일 중요한 자리다.
 */
/**
 * 🔴 **2026-09-02 — 로케일이 `"ko"` 로 못박혀 있었다.**
 *   [실측] `/en/…` 페이지의 canonical 이 `/ko/…` 를 가리켰다. hreflang 은 en 자기참조라
 *   두 신호가 정면으로 어긋난다 → 구글은 이런 클러스터를 통째로 무시할 수 있다(1차 리서치 §1-7).
 *   하필 이 페이지들은 **AI 가 인용할 실측 자산**이라 EN 색인을 포기할 이유가 없다.
 */
export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>;
}) => {
  const { locale } = await params;
  return createMetadata({
    title: "K-뷰티 GEO Report 2026 Q2",
    description: DESCRIPTION,
    locale: locale.startsWith("ko") ? "ko" : "en",
    pathname: PATHNAME,
  });
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
    label: "글로벌 4 엔진 언급률",
    note: "ChatGPT·Claude·Perplexity·Gemini",
  },
  {
    metric: "55%",
    suffix: "",
    label: "다음(Daum) 평균 언급률",
    note: "5사 측정 평균",
  },
  {
    metric: "+41%",
    suffix: "",
    label: "인용문 전략 상대 향상",
    note: "KDD'24 Table 1 실험 평균",
  },
];

const INSIGHTS = [
  {
    n: "01",
    title: "K-뷰티는 ChatGPT·Claude에서 강자 카테고리",
    body: "5사 평균 SoV는 93.2/100이었고 아누아가 96/100으로 가장 높았습니다. 글로벌 4개 엔진 응답에서 5사 브랜드 언급이 관찰됐습니다. 이 측정만으로 유통 채널이나 리뷰가 원인이라고 단정할 수는 없습니다.",
    actionable:
      "영문 공식 제품 정보와 확인 가능한 제3자 출처가 서로 같은 사실을 말하는지 점검하고, 다음 측정에서 실제 인용 도메인 변화를 비교하세요.",
  },
  {
    n: "02",
    title: "HyperCLOVA X 응답에서 5사 모두 언급",
    body: "측정한 네 개 질문에서 5사 모두 HyperCLOVA X 응답에 언급됐습니다. 이 결과는 해당 날짜·질문 표본에 한정되며 네이버 검색이나 AI 브리핑의 노출을 대신하지 않습니다.",
    actionable:
      "네이버 검색과 HyperCLOVA X를 별도 채널로 측정하고, 각 응답이 실제로 참조한 출처를 기준으로 콘텐츠 우선순위를 정하세요.",
  },
  {
    n: "03",
    title: "다음(Daum)은 K-뷰티 약세: 카카오 검색 인덱스 갭",
    body: "다음의 5사 평균 브랜드 언급률은 55%였습니다. 아누아는 75%였으므로 '5사 모두 50% 이하'로 일반화할 수 없습니다. 이번 측정만으로 낮은 언급률의 원인을 특정할 수도 없습니다.",
    actionable:
      "다음에서 언급되지 않은 질문과 노출된 출처를 먼저 비교한 뒤, 공식 페이지의 답변 공백을 보완하고 같은 조건으로 다시 측정하세요.",
  },
  {
    n: "04",
    title: "AI 답변과 검색 결과는 별도 지표로 관리해야 한다",
    body: "검색 노출과 AI 답변의 브랜드 언급은 수집 방식이 다른 지표입니다. 이 데이터셋은 매출 효과를 측정하지 않았으므로 가시성 차이를 매출 차이로 해석하지 않습니다.",
    actionable:
      "동일 질문·엔진·지역 조건으로 기준선을 저장한 뒤 한 번에 한 가지 편집 변경을 적용하고 재측정해 차이를 기록하세요.",
  },
];

const APPLY_STRATEGIES = [
  {
    code: "S1",
    name: "Cite Sources",
    impact: "+27%",
    body: "원출처 연결 전략의 논문 내 상대 향상 평균.",
  },
  {
    code: "S2",
    name: "Quotation Inclusion",
    impact: "+41%",
    body: "인용문 추가 전략의 논문 내 상대 향상 평균.",
  },
  {
    code: "S3",
    name: "Statistics & Data",
    impact: "+31%",
    body: "통계 추가 전략의 논문 내 상대 향상 평균.",
  },
  {
    code: "S4",
    name: "Korean Entity Grounding",
    impact: "검증 필요",
    body: "한·영·혼용 표기를 통합하고 변경 전후를 별도 측정.",
  },
  {
    code: "S5",
    name: "AI 브리핑 최적화",
    impact: "검증 필요",
    body: "네이버 AI 브리핑 노출 여부를 별도 표본으로 측정.",
  },
];

export default async function KBeautyReportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const CANONICAL = canonicalFor(locale);
  return (
    <div className="min-h-screen bg-[var(--findable-canvas)] text-[var(--findable-ink)]">
      <PublicLandingHeader locale={locale} />
      {/* 🔴 GEO 도그푸딩 — AI 가 이 리포트를 **출처로 인용**하게 만드는 구조화 데이터.
          [실측 2026-08-17] 하위 페이지 JSON-LD 가 전부 0개였다. 블로그가 비어 있어
          실질 인용 자산은 이 리포트와 k-geo-bench 둘뿐인데, 그 둘에 스키마가 없었다.
          ⚠️ `datePublished` 는 **실제 측정일 기준**이다(5/6~5/8 라이브 jobId) —
             날짜를 지어내지 않는다. 📕 feedback_no_fabricated_facts */}
      <JsonLd
        code={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: "K-뷰티 GEO Report 2026 Q2",
          description: DESCRIPTION,
          url: CANONICAL,
          mainEntityOfPage: { "@type": "WebPage", "@id": CANONICAL },
          inLanguage: "ko",
          datePublished: "2026-05-08",
          author: { "@type": "Organization", name: "Findable", url: SITE_URL },
          publisher: {
            "@type": "Organization",
            name: "Findable",
            url: SITE_URL,
          },
          about: ["생성형엔진최적화", "GEO", "AI 검색 가시성", "K-뷰티"],
          isAccessibleForFree: true,
        }}
      />
      {/* Hero */}
      <section className="relative w-full overflow-hidden border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 pt-24 pb-16 md:pt-32 md:pb-20">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <span
              className="inline-flex items-center gap-2 rounded-full border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] px-3 py-1 text-[11px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.18em]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              <FileText className="h-3 w-3" />
              Findable Industry Report · 2026 Q2
            </span>
            <span
              className="text-[12px] text-[var(--findable-ink-muted)]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              한국 K-뷰티 5사 · 7 AI 엔진
            </span>
          </div>
          <h1
            className="mb-6 font-medium text-[40px] leading-[1.1] tracking-tight md:text-[56px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            K-뷰티 GEO Report
            <br />
            <span className="text-[var(--findable-primary)]">
              2026 Q2, 어디에서 발견되고 있나.
            </span>
          </h1>
          <p
            className="max-w-2xl text-[18px] text-[var(--findable-ink-muted)] leading-[1.6]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            메디큐브·라운드랩·아누아·조선미녀·달바 5사를
            ChatGPT·Claude·Perplexity·Gemini·HyperCLOVA X·네이버·다음 7개
            엔진에서 측정한 결과와 Princeton KDD&apos;24 GEO 실험에서 검증한
            편집 전략을 구분해 정리했습니다.
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
              측정은 공개 LLM 답변에 대한 외부 분석으로 GEO 업계 표준
              패턴(Profound·Athena·Ahrefs). 시뮬레이션 수치는 Princeton 학술
              검증치이며 실측 아님.
            </span>
          </div>
        </div>
      </section>

      {/* 헤드라인 메트릭 */}
      <section className="border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <span
            className="mb-2 inline-block text-[11px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.18em]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            1.0 · Headline Metrics
          </span>
          <h2
            className="mb-8 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            5사 측정, 한눈에.
          </h2>
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4 md:gap-8">
            {HEADLINE_INSIGHTS.map((m) => (
              <div className="flex flex-col gap-1" key={m.label}>
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
                  className="text-[11px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.12em]"
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
            className="mb-2 inline-block text-[11px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.18em]"
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
                className="rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-6"
                key={ins.n}
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
                    <strong className="text-[var(--findable-primary)]">
                      Action:
                    </strong>{" "}
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
              className="inline-block text-[11px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.18em]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              3.0 · Apply 5 Strategies
            </span>
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-[10px] text-amber-600 uppercase tracking-[0.12em]">
              논문 근거 + 검증 과제
            </span>
          </div>
          <h2
            className="mb-4 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            검증된 편집 전략과 후속 실험 항목.
          </h2>
          <div
            className="mb-8 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-[13px] text-[var(--findable-ink-muted)] leading-relaxed"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            <strong className="text-amber-600">⚠ 근거 범위.</strong> +27%·+41%·
            +31%는 Princeton KDD&apos;24 GEO-Bench의 영문 실험에서 보고된 1차
            지표 상대 향상 평균입니다. 이 리포트의 5개 브랜드에 적용한 결과가
            아니며 한국어 환경의 성과를 보장하지 않습니다. 나머지 두 항목은 수치
            예측이 아닌 후속 검증 과제입니다.
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {APPLY_STRATEGIES.map((s) => (
              <article
                className="rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-5"
                key={s.code}
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
            className="mb-2 inline-block text-[11px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.18em]"
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
              className="group flex items-start gap-3 rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-5 transition hover:border-[var(--findable-primary)]/40"
              href="/ko/research/k-geo-bench-v0_1"
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
              className="group flex items-start gap-3 rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-5 transition hover:border-[var(--findable-primary)]/40"
              href="/ko/case/a-brand"
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
              우리 브랜드는 7 AI 답변에서
              <br />
              어디에 있을까요?
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
      <FooterCTA locale={locale} />
      <Footer locale={locale} />
    </div>
  );
}
