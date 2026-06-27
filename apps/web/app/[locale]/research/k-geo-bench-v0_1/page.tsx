// K-GEO-Bench v0.1 — 한국어 GEO 측정 첫 공개 데이터셋 (D-056, 2026-05-08)
//
// 본질:
//   Princeton GEO-Bench (KDD'24, 영문 10K 데이터)의 한국어 첫 공개 버전.
//   K-뷰티 5사 × 7+1 AI 엔진 × 4 프롬프트 = 140 측정 응답.
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

import { ArrowRight, Database, Download, ExternalLink, FileJson, GraduationCap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "K-GEO-Bench v0.1 — Findable Open Dataset for Korean GEO Research",
  description:
    "한국어 GEO 측정 첫 공개 데이터셋. K-뷰티 5사 × 8 AI 엔진 × 4 프롬프트 = 140 측정 응답. CC BY 4.0.",
};

export const revalidate = 3600;

const DATASET_INFO = {
  version: "v0.1",
  releasedAt: "2026-05-08",
  records: 5,
  totalResponses: 140,
  engines: 8,
  prompts: 4,
  license: "CC BY 4.0",
  jsonlSize: "17 KB",
  jsonSize: "31 KB",
};

const BRAND_SUMMARY = [
  { name: "메디큐브", slug: "medicube", category: "더마 코스메틱", sov: 93, jobId: "57fbfad0-2ba1-47b8-b2d9-fa6e5f4e36b7" },
  { name: "라운드랩", slug: "roundlab", category: "클린 스킨케어", sov: 93, jobId: "257c1723-5d63-46c1-977c-ff361b8e600e" },
  { name: "아누아", slug: "anua", category: "진정·민감", sov: 96, jobId: "3cad5f14-ef15-44a4-b5f6-dd55745c60db" },
  { name: "조선미녀", slug: "beautyofjoseon", category: "한방·미니멀", sov: 92, jobId: "e6d206df-7e40-4007-ab73-b249a813e603" },
  { name: "달바", slug: "dalba", category: "글로벌 D2C", sov: 92, jobId: "44b63810-3851-4047-b99f-726904dc0f38" },
];

const FINDINGS = [
  {
    title: "K-뷰티 카테고리는 한국어·영문 AI 모두에서 강세",
    detail:
      "5사 평균 SoV 93.2/100. 글로벌 4 엔진(ChatGPT·Claude·Perplexity·Gemini)과 한국 엔진(HyperCLOVA X·네이버) 모두 높은 인용률. K-뷰티 글로벌 진출이 영문 LLM 학습 데이터에 안정적으로 반영된 결과.",
  },
  {
    title: "다음(Daum)은 K-뷰티 카테고리 약세 — 카카오 검색 인덱스 갭",
    detail:
      "5사 모두 다음에서 인용률 50% 이하. 카카오 검색 API의 K-뷰티 콘텐츠 인덱스 부족으로 추정. 광고주 한국 검색 채널 다각화 시 진입장벽.",
  },
  {
    title: "아누아가 5사 중 1위 (SoV 96/100) — Amazon 토너 1위가 영문 LLM에 반영",
    detail:
      "Anua Heartleaf 77 Soothing Toner = Amazon 페이셜 토너 1위. ChatGPT 영문 답변에서 K-뷰티 추천 시 자주 등장. 글로벌 진출 K-뷰티의 LLM 가시성 영향이 측정 단계에서 검증됨.",
  },
];

export default function KGeoBenchPage() {
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
              한국어 GEO 측정 첫 공개 데이터셋
            </span>
          </h1>
          <p
            className="max-w-2xl text-[18px] text-[var(--findable-ink-muted)] leading-[1.6]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            Princeton KDD&apos;24 GEO-Bench의 한국어 환경 적용판. K-뷰티 5사 × 8 AI
            엔진 × 4 프롬프트 = 140 측정 응답. 한국어 LLM 학습 풀이 영문 대비 50배 좁은
            환경에서, 한국어 GEO 연구·개발의 출발선이 되는 공개 데이터셋입니다.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/api/data/k-geo-bench-v0_1"
              className="inline-flex items-center gap-2 rounded-md bg-[var(--findable-primary)] px-5 py-2.5 font-medium text-[14px] text-white transition hover:bg-[var(--findable-primary-hover)]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
              prefetch={false}
              download
            >
              <Download className="h-4 w-4" />
              JSONL 다운로드 (17 KB)
            </Link>
            <Link
              href="/api/data/k-geo-bench-v0_1?format=json"
              className="inline-flex items-center gap-2 rounded-md border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] px-5 py-2.5 font-medium text-[14px] text-[var(--findable-ink)] transition hover:border-[var(--findable-primary)]/40"
              style={{ fontFamily: "var(--findable-font-sans)" }}
              prefetch={false}
              download
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
            className="mb-2 inline-block text-[11px] uppercase tracking-[0.18em] text-[var(--findable-ink-tertiary)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            1.0 · Dataset Info
          </span>
          <h2
            className="mb-8 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            5 brands · 8 engines · 4 prompts = 140 responses.
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
            className="mb-2 inline-block text-[11px] uppercase tracking-[0.18em] text-[var(--findable-ink-tertiary)]"
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
                key={b.slug}
                href={`/ko/audit/${b.jobId}`}
                className="group flex items-center justify-between gap-4 rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-4 transition hover:border-[var(--findable-primary)]/40"
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
                  <span
                    className="rounded-full bg-[var(--findable-primary)]/10 px-3 py-1 font-mono text-[12px] text-[var(--findable-primary)]"
                  >
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
            className="mb-2 inline-block text-[11px] uppercase tracking-[0.18em] text-[var(--findable-ink-tertiary)]"
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
                key={f.title}
                className="rounded-lg border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-6"
              >
                <span
                  className="mb-2 inline-block font-mono text-[11px] text-[var(--findable-primary)] uppercase tracking-[0.12em]"
                >
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
            className="mb-2 inline-block text-[11px] uppercase tracking-[0.18em] text-[var(--findable-ink-tertiary)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            4.0 · Usage & License
          </span>
          <h2
            className="mb-8 font-medium text-[24px] leading-tight tracking-tight md:text-[32px]"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            CC BY 4.0 — 자유 활용·재배포 가능, 출처 표기 필수.
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
                한국어 LLM 평가, GEO 알고리즘 검증, K-뷰티 산업 분석. Princeton GEO-Bench
                포맷 호환 — 영문·한국어 비교 연구에 직접 활용 가능.
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
                K-뷰티·K-패션·K-콘텐츠 200사 → v1.0 (2026.12). 네이버 R&D 공동 발표 검토.
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
              href="/ko/audit"
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--findable-primary)] px-5 py-2.5 font-medium text-[14px] text-white transition hover:bg-[var(--findable-primary-hover)]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              우리 브랜드 측정 추가
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
