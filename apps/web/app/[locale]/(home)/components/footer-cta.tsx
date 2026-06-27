// Findable Footer CTA v3 — Linear cta-banner 패턴 (D-039)
// D-060 (2026-05-11): locale 분기 추가

import { ArrowRight } from "lucide-react";
import Link from "next/link";

interface FooterCTAProps {
  locale?: string;
}

export const FooterCTA = ({ locale = "ko" }: FooterCTAProps) => {
  const isKo = locale.startsWith("ko");
  const lp = isKo ? "/ko" : "";
  const eyebrow = isKo ? "3분 무료 진단" : "3-minute free audit";
  const headingLines = isKo
    ? ["AI는 지금, 우리 브랜드를", "어떻게 답할까요?"]
    : ["How does AI answer about", "your brand right now?"];
  const sub = isKo
    ? "이메일만 입력하면 30초면 끝납니다. 카드 등록도 필요 없습니다."
    : "Just your email — done in 30 seconds. No card required.";
  const ctaPrimary = isKo ? "무료로 진단받기" : "Get a free audit";
  const ctaSecondary = isKo ? "상담 예약하기" : "Book a call";
  return (
    <section className="relative bg-[var(--findable-canvas)] px-8 pt-20 pb-24 md:pt-28 md:pb-28">
      {/* atmospheric 글로우 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[80%]"
        style={{
          background: `radial-gradient(ellipse 70% 60% at 50% 100%, var(--findable-glow-purple), transparent 60%)`,
        }}
      />

      <div className="relative mx-auto max-w-[1200px]">
        {/* Pattern D: 1px gradient border frame */}
        <div
          className="relative rounded-2xl p-px"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,122,77,0.5), rgba(255,152,112,0.15) 30%, rgba(255,255,255,0.04) 60%, rgba(255,122,77,0.4))",
          }}
        >
          <div
            className="relative overflow-hidden rounded-2xl bg-[var(--findable-canvas)] px-12 pt-20 pb-16 text-center md:px-16 md:pt-28 md:pb-24"
            style={{
              boxShadow:
                "0 40px 80px -20px rgba(0,0,0,0.7), 0 1px 0 0 rgba(255,255,255,0.04) inset",
              scrollMarginTop: "80px",
            }}
          >
            {/* Pattern B: 미세한 grid + 가운데 fade mask */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.12]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
                backgroundSize: "32px 32px",
                maskImage:
                  "radial-gradient(ellipse at center, black 30%, transparent 75%)",
              }}
            />

            {/* 상단 radial glow */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-1/2"
              style={{
                background:
                  "radial-gradient(ellipse 70% 100% at 50% 0%, rgba(255,122,77,0.18), transparent 70%)",
              }}
            />

            {/* 상단 1px shine line */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-12 top-0 h-px"
              style={{
                background:
                  "linear-gradient(to right, transparent, rgba(255,255,255,0.25), transparent)",
              }}
            />

            <div className="relative z-10">
          <p
            className="text-[12px] uppercase tracking-[0.18em] text-[var(--findable-primary)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {eyebrow}
          </p>
          <h2
            className="mx-auto mt-5 max-w-[800px] text-[var(--findable-ink)]"
            style={{
              fontFamily: isKo
                ? "var(--findable-font-display-kr)"
                : "var(--findable-font-display)",
              fontSize: "clamp(36px, 4.5vw, 52px)",
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              fontWeight: 500,
            }}
          >
            {headingLines[0]}
            <br />
            {headingLines[1]}
          </h2>
          <p
            className="mx-auto mt-6 max-w-[560px] text-[15px] leading-[1.6] text-[var(--findable-ink-muted)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {sub}
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
            <Link
              href={`${lp}/audit`}
              className="findable-btn-primary flex h-11 items-center gap-2 rounded-md bg-[var(--findable-ink)] px-5 font-medium text-[15px] text-[var(--findable-canvas)] transition hover:bg-[var(--findable-ink-muted)]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              {ctaPrimary}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={`${lp}/contact`}
              className="flex h-11 items-center rounded-md px-5 font-medium text-[15px] text-[var(--findable-ink-muted)] transition hover:bg-[var(--findable-surface-3)] hover:text-[var(--findable-ink)]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              {ctaSecondary}
            </Link>
            </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
