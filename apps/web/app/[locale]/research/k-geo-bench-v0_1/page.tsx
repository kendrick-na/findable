// K-GEO-Bench v0.1 — 한국어 GEO 측정 공개 데이터셋 (D-056, 2026-05-08)
//
// 본질:
//   K-뷰티 5사 × 7 AI 엔진 × 4 프롬프트 = 140 측정 응답.
//
// 정직성:
//   - 5사는 모두 공개 K-뷰티 D2C 브랜드 (고객 아님, 측정 대상)
//   - 측정은 2026-05-06~05-08 라이브 jobId 5개로 검증
//   - 라이선스: CC BY 4.0 (Open Dataset)
//
// 시너지 매핑:
//   - 합격팀 B 패턴 (무빈 1784 데이터셋) 정확 미러
//   - 네이버 D3 R&D 협업
//   - 양상환 B6 "기술 진입장벽"

import { JsonLd } from "@repo/seo/json-ld";
import { createMetadata } from "@repo/seo/metadata";
import {
  ArrowRight,
  Database,
  Download,
  ExternalLink,
  FileJson,
  GraduationCap,
} from "lucide-react";
import Link from "next/link";
import { FooterCTA } from "../../(home)/components/footer-cta";
import { PublicLandingHeader } from "../../components/public-landing-header";

const DESCRIPTION =
  "한국어 GEO 측정 공개 데이터셋. K-뷰티 5사 × 7 AI 엔진 × 4 프롬프트 = 140 측정 응답. CC BY 4.0.";
const PATHNAME = "/research/k-geo-bench-v0_1";
const SITE_URL = "https://www.findable.co.kr";
const canonicalFor = (locale: string) =>
  `${SITE_URL}/${locale.startsWith("ko") ? "ko" : "en"}${PATHNAME}`;

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
    title: "K-GEO-Bench v0.1 · Korean GEO Open Dataset",
    description: DESCRIPTION,
    locale: locale.startsWith("ko") ? "ko" : "en",
    pathname: PATHNAME,
  });
};

export const revalidate = 3600;

const DATASET_INFO = {
  version: "v0.1",
  releasedAt: "2026-05-08",
  records: 5,
  totalResponses: 140,
  engines: 7,
  prompts: 4,
  license: "CC BY 4.0",
  jsonlSize: "17 KB",
  jsonSize: "31 KB",
};

const BRAND_SUMMARY = [
  {
    name: "메디큐브",
    slug: "medicube",
    category: "더마 코스메틱",
    sov: 93,
    jobId: "57fbfad0-2ba1-47b8-b2d9-fa6e5f4e36b7",
  },
  {
    name: "라운드랩",
    slug: "roundlab",
    category: "클린 스킨케어",
    sov: 93,
    jobId: "257c1723-5d63-46c1-977c-ff361b8e600e",
  },
  {
    name: "아누아",
    slug: "anua",
    category: "진정·민감",
    sov: 96,
    jobId: "3cad5f14-ef15-44a4-b5f6-dd55745c60db",
  },
  {
    name: "조선미녀",
    slug: "beautyofjoseon",
    category: "한방·미니멀",
    sov: 92,
    jobId: "e6d206df-7e40-4007-ab73-b249a813e603",
  },
  {
    name: "달바",
    slug: "dalba",
    category: "글로벌 D2C",
    sov: 92,
    jobId: "44b63810-3851-4047-b99f-726904dc0f38",
  },
];

const FINDINGS = [
  {
    title: "K-뷰티 카테고리는 한국어·영문 AI 모두에서 강세",
    detail:
      "5사 평균 SoV는 93.2/100이었습니다. 글로벌 4개 엔진(ChatGPT·Claude·Perplexity·Gemini)과 한국 엔진(HyperCLOVA X·네이버) 응답에서 브랜드 언급이 관찰됐습니다. 이 표본만으로 원인을 단정하지 않습니다.",
  },
  {
    title: "다음(Daum)은 K-뷰티 카테고리 약세: 카카오 검색 인덱스 갭",
    detail:
      "다음의 5사 평균 브랜드 언급률은 55%로 다른 측정 엔진보다 낮았습니다. 아누아는 75%여서 브랜드별 차이도 확인됐습니다. 원인은 이번 데이터만으로 판단할 수 없습니다.",
  },
  {
    title: "아누아가 5사 중 가장 높은 SoV 96/100을 기록",
    detail:
      "아누아는 이 표본에서 SoV 96/100을 기록했습니다. 제품 유통·리뷰·웹 문서 중 무엇이 결과에 영향을 줬는지는 별도의 출처 분석과 반복 측정이 필요합니다.",
  },
];

export default async function KGeoBenchPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const CANONICAL = canonicalFor(locale);
  return (
    <div className="min-h-screen bg-[var(--findable-canvas)] text-[var(--findable-ink)]">
      <PublicLandingHeader locale={locale} />
      <JsonLd
        code={{
          "@context": "https://schema.org",
          "@type": "Dataset",
          name: "K-GEO-Bench v0.1",
          description: DESCRIPTION,
          url: CANONICAL,
          datePublished: "2026-05-08",
          inLanguage: "ko",
          license: "https://creativecommons.org/licenses/by/4.0/",
          creator: { "@type": "Organization", name: "Findable", url: SITE_URL },
          distribution: [
            {
              "@type": "DataDownload",
              encodingFormat: "application/x-ndjson",
              contentUrl: `${SITE_URL}/api/data/k-geo-bench-v0_1`,
            },
            {
              "@type": "DataDownload",
              encodingFormat: "application/json",
              contentUrl: `${SITE_URL}/api/data/k-geo-bench-v0_1?format=json`,
            },
          ],
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
              <GraduationCap className="h-3 w-3" />
              Findable Research · v0.1
            </span>
            <span
              className="text-[12px] text-[var(--findable-ink-muted)]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              Open Dataset · CC BY 4.0
            </span>
          </div>
          <h1
            className="mb-6 font-medium text-[40px] leading-[1.1] tracking-tight md:text-[56px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            K-GEO-Bench v0.1
            <br />
            <span className="text-[var(--findable-primary)]">
              한국어 GEO 측정 공개 데이터셋
            </span>
          </h1>
          <p
            className="max-w-2xl text-[18px] text-[var(--findable-ink-muted)] leading-[1.6]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            K-뷰티 5사 × 7 AI 엔진 × 4 프롬프트로 수집한 140개 측정 응답입니다.
            한국어 AI 검색 가시성을 재현하고 비교할 수 있도록 측정 결과와 조건을
            공개합니다.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              className="inline-flex items-center gap-2 rounded-md bg-[var(--findable-primary)] px-5 py-2.5 font-medium text-[14px] text-[var(--findable-canvas)] transition hover:bg-[var(--findable-primary-hover)]"
              download
              href="/api/data/k-geo-bench-v0_1"
              prefetch={false}
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              <Download className="h-4 w-4" />
              JSONL 다운로드 (17 KB)
            </Link>
            <Link
              className="inline-flex items-center gap-2 rounded-md border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] px-5 py-2.5 font-medium text-[14px] text-[var(--findable-ink)] transition hover:border-[var(--findable-primary)]/40"
              download
              href="/api/data/k-geo-bench-v0_1?format=json"
              prefetch={false}
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              <FileJson className="h-4 w-4" />
              JSON 다운로드 (31 KB)
            </Link>
          </div>
        </div>
      </section>

      {/* 데이터셋 정보 */}
      <section className="border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <span
            className="mb-2 inline-block text-[11px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.18em]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            1.0 · Dataset Info
          </span>
          <h2
            className="mb-8 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            5 brands · 7 engines · 4 prompts = 140 responses.
          </h2>
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4 md:gap-8">
            <div>
              <div
                className="font-medium text-[28px] leading-none tracking-tight md:text-[36px]"
                style={{ fontFamily: "var(--findable-font-display)" }}
              >
                {DATASET_INFO.records}
              </div>
              <div
                className="mt-2 text-[12px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.12em]"
                style={{ fontFamily: "var(--findable-font-sans)" }}
              >
                Brands
              </div>
            </div>
            <div>
              <div
                className="font-medium text-[28px] leading-none tracking-tight md:text-[36px]"
                style={{ fontFamily: "var(--findable-font-display)" }}
              >
                {DATASET_INFO.engines}
              </div>
              <div
                className="mt-2 text-[12px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.12em]"
                style={{ fontFamily: "var(--findable-font-sans)" }}
              >
                AI Engines
              </div>
            </div>
            <div>
              <div
                className="font-medium text-[28px] leading-none tracking-tight md:text-[36px]"
                style={{ fontFamily: "var(--findable-font-display)" }}
              >
                {DATASET_INFO.totalResponses}
              </div>
              <div
                className="mt-2 text-[12px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.12em]"
                style={{ fontFamily: "var(--findable-font-sans)" }}
              >
                Responses
              </div>
            </div>
            <div>
              <div
                className="font-medium text-[28px] leading-none tracking-tight md:text-[36px]"
                style={{ fontFamily: "var(--findable-font-display)" }}
              >
                {DATASET_INFO.license}
              </div>
              <div
                className="mt-2 text-[12px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.12em]"
                style={{ fontFamily: "var(--findable-font-sans)" }}
              >
                License
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5사 구성 */}
      <section className="border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <span
            className="mb-2 inline-block text-[11px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.18em]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            2.0 · Measurement Targets
          </span>
          <h2
            className="mb-8 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            5 brands across K-뷰티 categories.
          </h2>
          <div className="space-y-2">
            {BRAND_SUMMARY.map((b) => (
              <Link
                className="group flex items-center justify-between gap-4 rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-4 transition hover:border-[var(--findable-primary)]/40"
                href={`/ko/audit/${b.jobId}`}
                key={b.slug}
              >
                <div className="flex items-center gap-4">
                  <span
                    className="font-medium text-[16px]"
                    style={{ fontFamily: "var(--findable-font-sans)" }}
                  >
                    {b.name}
                  </span>
                  <span
                    className="text-[12px] text-[var(--findable-ink-tertiary)]"
                    style={{ fontFamily: "var(--findable-font-mono)" }}
                  >
                    {b.category}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-[var(--findable-primary)]/10 px-3 py-1 font-mono text-[12px] text-[var(--findable-primary)]">
                    SoV {b.sov}
                  </span>
                  <ExternalLink className="h-4 w-4 text-[var(--findable-ink-muted)] transition group-hover:text-[var(--findable-primary)]" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Findings */}
      <section className="border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <span
            className="mb-2 inline-block text-[11px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.18em]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            3.0 · Key Findings
          </span>
          <h2
            className="mb-8 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            5사 측정에서 보이는 한국어 GEO 패턴.
          </h2>
          <div className="space-y-4">
            {FINDINGS.map((f, i) => (
              <article
                className="rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-6"
                key={f.title}
              >
                <span className="mb-2 inline-block font-mono text-[11px] text-[var(--findable-primary)] uppercase tracking-[0.12em]">
                  Finding {i + 1}
                </span>
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

      {/* 활용 + 라이선스 */}
      <section className="border-[var(--findable-hairline)] border-b">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <span
            className="mb-2 inline-block text-[11px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.18em]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            4.0 · Usage & License
          </span>
          <h2
            className="mb-8 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            CC BY 4.0. 자유 활용·재배포 가능, 출처 표기 필수.
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <article className="rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-6">
              <div className="mb-3 flex items-center gap-2">
                <Database className="h-4 w-4 text-[var(--findable-primary)]" />
                <h3
                  className="font-medium text-[16px]"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  연구용 활용
                </h3>
              </div>
              <p
                className="text-[14px] text-[var(--findable-ink-muted)] leading-relaxed"
                style={{ fontFamily: "var(--findable-font-sans)" }}
              >
                한국어 LLM 평가, GEO 방법 검토, K-뷰티 산업 분석에 활용할 수
                있습니다. 필드 정의와 측정 조건은 내려받은 파일에서 확인할 수
                있습니다.
              </p>
            </article>
            <article className="rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-6">
              <div className="mb-3 flex items-center gap-2">
                <FileJson className="h-4 w-4 text-[var(--findable-primary)]" />
                <h3
                  className="font-medium text-[16px]"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  로드맵 (v0.2~v1.0)
                </h3>
              </div>
              <p
                className="text-[14px] text-[var(--findable-ink-muted)] leading-relaxed"
                style={{ fontFamily: "var(--findable-font-sans)" }}
              >
                인큐베이팅 6개월 동안 K-뷰티 50사 → v0.5 (2026.09).
                K-뷰티·K-패션·K-콘텐츠 200사 → v1.0 (2026.12). 네이버 R&D 공동
                발표 검토.
              </p>
            </article>
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
              한국어 GEO의 출발선,
              <br />
              지금 같이 만듭니다.
            </h2>
            <Link
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--findable-primary)] px-5 py-2.5 font-medium text-[14px] text-[var(--findable-canvas)] transition hover:bg-[var(--findable-primary-hover)]"
              href="/ko/audit"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              우리 브랜드 측정 추가
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
      <FooterCTA locale={locale} />
    </div>
  );
}
