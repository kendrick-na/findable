// Findable Hero v3 — Linear canvas + Resend Domaine 시그니처 (D-039, 2026-05-05)
// Linear DESIGN.md + Resend DESIGN.md 기반
// D-055 (2026-05-08): 영문 베타 라이브 — locale 분기 카피 추가
// D-060 (2026-05-12): 헤더 언어 토글 추가

import type { Dictionary } from "@repo/internationalization";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

// 글로벌 인지도 순서 (검색량/MAU 기준): ChatGPT >> Gemini > Claude > Perplexity > HyperCLOVA(국내1) > 네이버 > 다음
const ENGINES_KO = [
  "ChatGPT",
  "Gemini",
  "Claude",
  "Perplexity",
  "HyperCLOVA",
  "네이버",
  "다음",
];

const ENGINES_EN = [
  "ChatGPT",
  "Gemini",
  "Claude",
  "Perplexity",
  "HyperCLOVA",
  "Naver",
  "Daum",
];

interface HeroProps {
  dictionary: Dictionary;
  locale?: string;
}

export const Hero = ({ dictionary: _, locale = "ko" }: HeroProps) => {
  const isKo = locale.startsWith("ko");
  // 영문(en)은 defaultLocale이라 URL prefix 없음 → 내부 링크에도 prefix 안 붙임.
  // 한국어(ko)는 prefix 유지 → 클릭 시 미들웨어 재판별로 튕기지 않게.
  const lp = isKo ? "/ko" : "";
  const ENGINES = isKo ? ENGINES_KO : ENGINES_EN;
  const h1 = isKo
    ? "AI가 우리 브랜드를 먼저 답하게."
    : "Make AI answer about your brand first.";
  const heroSub = isKo
    ? "AI 에이전트가 진단하는, 한국 최초 Agentic GEO 최적화 플랫폼."
    : "Korea's first Agentic GEO optimization platform — diagnosed by AI agents.";
  const heroTagline = isKo
    ? "7개 AI 답변 속 우리 브랜드 점유율, 30초면 진단 끝."
    : "Your brand's share of voice across 7 AI answers — diagnosed in 30 seconds.";
  const ctaPrimary = isKo ? "무료로 진단받기" : "Get a free audit";
  const ctaDemo = isKo ? "데모 보기" : "View demo";
  const enginesLabel = isKo ? "진단 대상 AI" : "Engines covered";
  const betaLabel = isKo ? "Findable v1.0 베타" : "Findable v1.0 beta";
  // 데모 = GEO 측정 대시보드 (app.findable.co.kr). 로그인 후 진입.
  const dashboardHref = "https://app.findable.co.kr";
  const navItems = isKo
    ? [
        { label: "제품", href: "#product" },
        { label: "데모", href: dashboardHref },
        { label: "요금제", href: `${lp}/pricing` },
        { label: "리소스", href: `${lp}/blog` },
      ]
    : [
        { label: "Product", href: "#product" },
        { label: "Demo", href: dashboardHref },
        { label: "Pricing", href: `${lp}/pricing` },
        { label: "Resources", href: `${lp}/blog` },
      ];
  const navSignIn = isKo ? "로그인" : "Sign in";
  const navDemo = isKo ? "데모 신청" : "Book a demo";
  return (
    <section className="relative w-full overflow-hidden bg-[var(--findable-canvas)] text-[var(--findable-ink)]">
      {/* 상단 atmospheric 라벤더 글로우 (Resend 패턴) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60vh]"
        style={{
          background: `radial-gradient(ellipse 80% 50% at 50% 0%, var(--findable-glow-purple), transparent 60%)`,
        }}
      />

      {/* TOP NAV — Hero 안 인라인 (sticky 제거, 디자인 안정 우선) */}
      <header className="relative z-50 flex h-14 items-center justify-between border-[var(--findable-hairline)] border-b px-8">
        <Link
          href={lp || "/"}
          className="inline-flex items-baseline text-[var(--findable-ink)] transition hover:opacity-80"
          aria-label="Findable"
        >
          <span
            className="text-[24px] leading-none"
            style={{
              fontFamily: "var(--findable-font-wordmark)",
              fontWeight: 400,
              letterSpacing: "-0.01em",
            }}
          >
            Findable
          </span>
          <span
            aria-hidden
            className="ml-[5px] inline-block h-[5px] w-[5px] bg-[var(--findable-primary)]"
          />
        </Link>

        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-7 md:flex">
          {navItems.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-[14px] text-[var(--findable-ink-subtle)] transition hover:text-[var(--findable-ink)]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {/* 언어 토글 — ko ↔ en */}
          <div
            className="hidden items-center gap-1 rounded-md border border-[var(--findable-hairline)] px-1.5 py-1 text-[12px] sm:flex"
            style={{ fontFamily: "var(--findable-font-mono)" }}
          >
            {/* 플레인 <a> 사용 — Next.js prefetch가 /ko·/en 미들웨어를 트리거해
                Next-Locale 쿠키를 덮어쓰는 문제 방지 (D-061) */}
            <a
              href="/ko"
              className={`rounded px-1.5 py-0.5 transition ${
                isKo
                  ? "bg-[var(--findable-surface-2)] text-[var(--findable-ink)]"
                  : "text-[var(--findable-ink-tertiary)] hover:text-[var(--findable-ink)]"
              }`}
            >
              KO
            </a>
            <a
              href="/en"
              className={`rounded px-1.5 py-0.5 transition ${
                !isKo
                  ? "bg-[var(--findable-surface-2)] text-[var(--findable-ink)]"
                  : "text-[var(--findable-ink-tertiary)] hover:text-[var(--findable-ink)]"
              }`}
            >
              EN
            </a>
          </div>
          <a
            href="https://app.findable.co.kr/sign-in"
            className="hidden rounded-md px-3 py-1.5 text-[14px] text-[var(--findable-ink)] transition hover:bg-[var(--findable-surface-1)] sm:inline-block"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {navSignIn}
          </a>
          <Link
            href={`${lp}/contact`}
            className="findable-btn-primary flex h-9 items-center rounded-md bg-[var(--findable-ink)] px-3.5 font-medium text-[14px] text-[var(--findable-canvas)] transition hover:bg-[var(--findable-ink-muted)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {navDemo}
          </Link>
        </div>
      </header>

      {/* HERO CONTENT */}
      <div className="relative z-10 mx-auto flex max-w-[1200px] flex-col items-center px-8 pt-12 pb-12 text-center md:pt-16 md:pb-14">
        {/* Eyebrow pill (정적 라벨, 클릭 불가) */}
        <div
          className="opacity-0"
          style={{
            animation:
              "findable-fade-up-sm 0.5s var(--findable-ease-out-soft) 0.1s forwards",
          }}
        >
          <span
            className="inline-flex items-center gap-2 rounded-full border border-[var(--findable-hairline-strong)] bg-[var(--findable-surface-2)] px-3 py-1 text-[12px] text-[var(--findable-ink-muted)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--findable-primary)]" />
            {betaLabel}
          </span>
        </div>

        {/* H1 — Toss 톤 명사구 단언 */}
        <h1
          className="mt-8 max-w-[1100px] opacity-0"
          style={{
            fontFamily: isKo
              ? "var(--findable-font-display-kr)"
              : "var(--findable-font-display)",
            fontSize: "clamp(40px, 5.5vw, 80px)",
            lineHeight: 1.08,
            letterSpacing: "-0.035em",
            fontWeight: 500,
            animation:
              "findable-fade-up 0.8s var(--findable-ease-cinema) 0.2s forwards",
          }}
        >
          {h1}
        </h1>

        {/* H1 보조라인 — 5초 룰 통과 핵심 (글로벌 + 한국 차별화) */}
        <p
          className="mt-6 max-w-[640px] text-[18px] text-[var(--findable-ink)] opacity-0 md:text-[20px]"
          style={{
            fontFamily: "var(--findable-font-sans)",
            fontWeight: 500,
            animation:
              "findable-fade-up 0.6s var(--findable-ease-cinema) 0.35s forwards",
          }}
        >
          {heroSub}
        </p>

        {/* Sub — 25초 검증 사실 + 30일 제거 */}
        <p
          className="mt-4 max-w-[680px] text-[16px] leading-[1.6] text-[var(--findable-ink-muted)] opacity-0"
          style={{
            fontFamily: "var(--findable-font-sans)",
            animation:
              "findable-fade-up 0.6s var(--findable-ease-out-soft) 0.5s forwards",
          }}
        >
          {heroTagline}
        </p>

        {/* CTAs — Primary 흰색 (Resend 패턴) + Secondary ghost */}
        <div
          className="mt-10 flex flex-col items-center gap-2.5 opacity-0 sm:flex-row"
          style={{
            animation:
              "findable-fade-up 0.5s var(--findable-ease-out-quint) 0.7s forwards",
          }}
        >
          <Link
            href={`${lp}/audit`}
            className="findable-btn-primary flex h-10 items-center gap-2 rounded-md bg-[var(--findable-ink)] px-4 font-medium text-[14px] text-[var(--findable-canvas)] transition hover:bg-[var(--findable-ink-muted)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {ctaPrimary}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            href={dashboardHref}
            className="flex h-10 items-center rounded-md px-4 font-medium text-[14px] text-[var(--findable-ink-muted)] transition hover:bg-[var(--findable-surface-1)] hover:text-[var(--findable-ink)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {ctaDemo}
          </Link>
        </div>

        {/* AI 엔진 모노 스트립 */}
        <div
          className="mt-20 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 opacity-0"
          style={{
            animation:
              "findable-fade-up-sm 0.5s var(--findable-ease-out-soft) 0.9s forwards",
          }}
        >
          <span
            className="text-[11px] uppercase tracking-[0.18em] text-[var(--findable-ink-tertiary)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {enginesLabel}
          </span>
          {ENGINES.map((engine) => (
            <span
              key={engine}
              className="text-[13px] text-[var(--findable-ink-subtle)]"
              style={{ fontFamily: "var(--findable-font-mono)" }}
            >
              {engine}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
};
