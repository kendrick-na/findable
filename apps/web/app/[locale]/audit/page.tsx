// /audit — 무료 Audit 입력 페이지 (PRD §13.1, §14.1 PLG 진입)

import { getDictionary } from "@repo/internationalization";
import { createMetadata } from "@repo/seo/metadata";
import type { Metadata } from "next";
import { PublicLandingHeader } from "../components/public-landing-header";
import { AuditForm } from "./components/audit-form";

// ⚡ ISR (2026-07-30 성능): dynamic API 사용 0 → 1시간 캐시(CDN). [locale] 전 페이지
//   매 요청 SSR이던 문제의 페이지 단위 해소. 카피 변경은 재배포로 반영.
export const revalidate = 3600;

interface AuditPageProps {
  params: Promise<{ locale: string }>;
}

export const generateMetadata = async ({
  params,
}: AuditPageProps): Promise<Metadata> => {
  const { locale } = await params;
  const isKo = locale.startsWith("ko");
  return createMetadata({
    title: isKo
      ? "무료 AI 가시성 진단 · Findable"
      : "Free AI Visibility Audit · Findable",
    description: isKo
      ? "도메인을 입력하면 3분 안에 7개 AI 엔진(ChatGPT·Claude·Perplexity·Gemini·HyperCLOVA·Naver·Daum)에서 우리 브랜드의 위치를 PDF로 받아보세요."
      : "Drop in your domain. In 3 minutes, get a 1-page PDF showing where your brand stands across 7 AI engines.",
    locale,
    pathname: "/audit",
  });
};

const AuditPage = async ({ params }: AuditPageProps) => {
  const { locale } = await params;
  const dictionary = await getDictionary(locale);
  const isKo = locale.startsWith("ko");

  return (
    <div className="min-h-screen w-full bg-[var(--findable-canvas)] text-[var(--findable-ink)]">
      <PublicLandingHeader locale={locale} />
      <div className="container mx-auto max-w-3xl px-4 py-24">
        <p
          className="text-[12px] text-[var(--findable-primary)] uppercase tracking-[0.18em]"
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
            // 한글은 정사각 격자라 음수 자간이 가독성을 깎는다(랜딩 hero.tsx 와 같은 규율)
            letterSpacing: isKo ? "0" : "-0.03em",
            fontWeight: 500,
            wordBreak: "keep-all",
          }}
        >
          {isKo
            ? "AI가 우리 브랜드를 먼저 답하게."
            : "Make AI answer with your brand first."}
        </h1>
        <p
          className="mt-5 max-w-2xl text-[16px] text-[var(--findable-ink-muted)] leading-[1.6]"
          style={{ fontFamily: "var(--findable-font-sans)" }}
        >
          {/* 🔴 S7-a(2026-08-11) — 예전 문구는 조건 없이 "7개 AI"였다. 바로 아래 폼에서
              「영어만」을 고르면 실제로는 **글로벌 4곳**만 측정하는데(`runner.ts` GLOBAL_4),
              히어로는 계속 7을 약속해 **같은 화면에서 숫자가 서로 반박**했다.
              👁️ 코드로는 안 보였고 **모바일 스크린샷에서 잡혔다**(히어로와 폼이 다른 파일).
              → 기본값(한국어+영어=7곳)이라는 **조건을 밝힌다**. 선택별 정확한 수는
                폼의 선택지·안내문이 책임진다(서버 컴포넌트라 선택 상태를 알 수 없다). */}
          {isKo
            ? "도메인만 입력하면 AI 답변 점유율을 3분 안에 진단해드려요. 한국어와 영어를 함께 측정하면 AI 7곳에서 봅니다."
            : "Drop in your domain for a 30-second Share-of-Voice diagnosis. Measuring Korean and English together covers 7 AI engines."}
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
              // 🔴 S7-a — 「영어만」이면 4곳이다. 선택에 따라 달라지므로 수를 못 박지 않는다
              //   (정확한 수는 폼의 선택지가 말한다).
              body: isKo
                ? "고른 AI 엔진에 동시 호출 (2~3분)"
                : "Selected engines run in parallel (2-3 min)",
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
              className="rounded-lg bg-[var(--findable-surface-1)] p-5"
              key={step.n}
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
