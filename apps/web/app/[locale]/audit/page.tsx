// /audit — 무료 Audit 입력 페이지 (PRD §13.1, §14.1 PLG 진입)

import { getDictionary } from "@repo/internationalization";
import { createMetadata } from "@repo/seo/metadata";
import type { Metadata } from "next";
import { AuditForm } from "./components/audit-form";

interface AuditPageProps {
  params: Promise<{ locale: string }>;
}

export const generateMetadata = async ({
  params,
}: AuditPageProps): Promise<Metadata> => {
  const { locale } = await params;
  const isKo = locale.startsWith("ko");
  return createMetadata({
    title: isKo ? "무료 AI 가시성 진단 — Findable" : "Free AI Visibility Audit — Findable",
    description: isKo
      ? "도메인을 입력하면 3분 안에 7개 AI 엔진(ChatGPT·Claude·Perplexity·Gemini·HyperCLOVA·Naver·Daum)에서 우리 브랜드의 위치를 PDF로 받아보세요."
      : "Drop in your domain. In 3 minutes, get a 1-page PDF showing where your brand stands across 7 AI engines.",
  });
};

const AuditPage = async ({ params }: AuditPageProps) => {
  const { locale } = await params;
  const dictionary = await getDictionary(locale);
  const isKo = locale.startsWith("ko");

  return (
    <div className="min-h-screen w-full bg-[var(--findable-canvas)] text-[var(--findable-ink)]">
      <div className="container mx-auto max-w-3xl px-4 py-24">
        <p
          className="text-[12px] uppercase tracking-[0.18em] text-[var(--findable-primary)]"
          style={{ fontFamily: "var(--findable-font-sans)" }}
        >
          {isKo ? "무료 진단 · 1회 무료" : "Free Audit · 1 free run"}
        </p>
        <h1
          className="mt-4"
          style={{
            fontFamily: "var(--findable-font-display-kr)",
            fontSize: "clamp(36px, 4.5vw, 56px)",
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            fontWeight: 500,
            wordBreak: "keep-all",
          }}
        >
          {isKo
            ? "AI가 우리 브랜드를 먼저 답하게."
            : "Make AI answer with your brand first."}
        </h1>
        <p
          className="mt-5 max-w-2xl text-[16px] leading-[1.6] text-[var(--findable-ink-muted)]"
          style={{ fontFamily: "var(--findable-font-sans)" }}
        >
          {isKo
            ? "도메인만 입력하면 7개 AI 답변 점유율을 30초에 진단해드려요. 한국어와 영어, 둘 다 측정합니다."
            : "Drop in your domain. Get a 30-second diagnosis of your brand's Share of Voice across 7 AIs — in both Korean and English."}
        </p>

        <div className="mt-10 rounded-xl bg-[var(--findable-surface-1)] p-6 md:p-8">
          <AuditForm dictionary={dictionary} locale={locale} />
        </div>

        <div className="mt-10 grid gap-4 text-[14px] md:grid-cols-3">
          {[
            {
              n: "1",
              label: isKo ? "입력" : "Submit",
              body: isKo
                ? "이메일과 도메인 입력 (30초)"
                : "Enter your email and domain (30s)",
            },
            {
              n: "2",
              label: isKo ? "분석" : "Analyze",
              body: isKo
                ? "7개 AI 동시 호출 (2~3분)"
                : "7 engines run in parallel (2-3 min)",
            },
            {
              n: "3",
              label: isKo ? "받기" : "Receive",
              body: isKo
                ? "PDF 다운로드 + 이메일 발송"
                : "PDF download + email delivery",
            },
          ].map((step) => (
            <div
              key={step.n}
              className="rounded-lg bg-[var(--findable-surface-1)] p-5"
            >
              <div className="flex items-baseline gap-2">
                <span
                  className="text-[12px] text-[var(--findable-primary)]"
                  style={{ fontFamily: "var(--findable-font-mono)" }}
                >
                  {step.n}
                </span>
                <span
                  className="text-[14px] text-[var(--findable-ink)]"
                  style={{
                    fontFamily: "var(--findable-font-sans)",
                    fontWeight: 600,
                  }}
                >
                  {step.label}
                </span>
              </div>
              <p
                className="mt-2 text-[13px] text-[var(--findable-ink-muted)]"
                style={{ fontFamily: "var(--findable-font-sans)" }}
              >
                {step.body}
              </p>
            </div>
          ))}
        </div>

        <p
          className="mt-8 text-[12px] text-[var(--findable-ink-tertiary)]"
          style={{ fontFamily: "var(--findable-font-sans)" }}
        >
          {isKo
            ? "Findable v1.0 베타 · 같은 이메일 24시간 내 1회 제한 · 결과 데이터는 GEO 모델 학습에 활용될 수 있어요 (개인정보 제외)."
            : "Findable v1.0 beta · 1 audit per email per 24h · Anonymized results may be used for GEO model training."}
        </p>
      </div>
    </div>
  );
};

export default AuditPage;
