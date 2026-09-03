// Findable Hero v3 — Linear canvas + Resend Domaine 시그니처 (D-039, 2026-05-05)
// Linear DESIGN.md + Resend DESIGN.md 기반
// D-055 (2026-05-08): 영문 베타 라이브 — locale 분기 카피 추가
// D-060 (2026-05-12): 헤더 언어 토글 추가

import type { Dictionary } from "@repo/internationalization";
import { ArrowRight, ChevronDown } from "lucide-react";
import Link from "next/link";

const ENGINE_MARKS = [
  {
    alt: "NAVER",
    src: "https://www.navercorp.com/img/pc/logo-type-green.png",
  },
  {
    alt: "ChatGPT",
    src: "https://commons.wikimedia.org/wiki/Special:FilePath/OpenAI_logo_2025_%28wordmark%29.svg",
  },
  {
    alt: "Gemini",
    src: "https://commons.wikimedia.org/wiki/Special:FilePath/Google_Gemini_logo_2025.svg",
  },
  {
    alt: "Claude",
    src: "https://commons.wikimedia.org/wiki/Special:FilePath/Claude_AI_logo.svg",
  },
  {
    alt: "Perplexity",
    src: "https://commons.wikimedia.org/wiki/Special:FilePath/Perplexity_AI_logo.svg",
  },
  {
    alt: "Daum",
    src: "https://commons.wikimedia.org/wiki/Special:FilePath/Daum_logo_%282013%E2%80%932025%29.svg",
  },
] as const;

interface HeroProps {
  dictionary: Dictionary;
  locale?: string;
}

export const Hero = ({ dictionary: _, locale = "ko" }: HeroProps) => {
  const isKo = locale.startsWith("ko");
  // 영문(en)은 defaultLocale이라 URL prefix 없음 → 내부 링크에도 prefix 안 붙임.
  // 한국어(ko)는 prefix 유지 → 클릭 시 미들웨어 재판별로 튕기지 않게.
  const lp = isKo ? "/ko" : "/en";
  const h1 = isKo
    ? "AI가 우리 브랜드를 먼저 답하게."
    : "Make AI answer about your brand first.";
  // D-2026-07-23 포지셔닝 전환: "측정 도구" → "네이버까지 진단 + 직접 고칠 곳" 차별점.
  // "한국 최초"(검증불가 과장) 제거 — GPTO 등 경쟁사가 동일 주장.
  const heroSub = isKo
    ? "측정만 하지 않습니다. 네이버까지 진단하고, 직접 고칠 곳까지 알려드립니다."
    : "We don't just measure. We diagnose Naver too, and show you exactly what to fix.";
  const heroTagline = isKo
    ? "7개 AI 답변 속 우리 브랜드 점유율, 3분이면 진단 끝."
    : "Your brand's share of voice across 7 AI answers, diagnosed in 3 minutes.";
  const ctaPrimary = isKo ? "무료로 시작하기" : "Start for free";
  // secondary CTA는 primary(진단)와 목적지가 겹치지 않게 요금제로 분리.
  const ctaSecondary = isKo ? "요금제 보기" : "See pricing";
  const enginesLabel = isKo ? "진단 대상 AI" : "Engines covered";
  // 인사이트 드롭다운: 공개 검색 자산의 정규 허브(`/insights`)를
  // 전면에 노출하고, 리포트·리서치도 같은 콘텐츠 축으로 묶는다.
  const insightMenu = isKo
    ? {
        label: "인사이트·블로그",
        href: `${lp}/insights`,
        children: [
          { label: "블로그 전체", href: `${lp}/insights` },
          { label: "GEO 리포트", href: `${lp}/report/k-beauty-geo-2026q2` },
          { label: "벤치마크 리서치", href: `${lp}/research/k-geo-bench-v0_1` },
        ],
      }
    : {
        label: "Insights & blog",
        href: `${lp}/insights`,
        children: [{ label: "All insights", href: `${lp}/insights` }],
      };
  // 단일 링크 nav 항목. "제품"은 현재 페이지의 앵커라 이동감이 없었으므로
  // 언제든 랜딩 첫 화면으로 돌아가는 홈 링크로 명확히 바꾼다.
  const navItems = isKo
    ? {
        home: { label: "홈", href: lp || "/" },
        knowledge: { label: "GEO·SEO 가이드", href: `${lp}/glossary` },
        faq: { label: "FAQ", href: "#faq" },
        pricing: { label: "요금제", href: `${lp}/pricing` },
      }
    : {
        home: { label: "Home", href: lp || "/" },
        knowledge: { label: "GEO & SEO guide", href: `${lp}/glossary` },
        faq: { label: "FAQ", href: "#faq" },
        pricing: { label: "Pricing", href: `${lp}/pricing` },
      };
  const navSignIn = isKo ? "로그인" : "Sign in";
  // 우상단 primary CTA는 무료 진단으로 통일 (기존 데모 신청 → 진단).
  const navAudit = isKo ? "무료로 시작" : "Start free";
  const navLinkClass =
    "text-[14px] text-[var(--findable-ink-subtle)] transition hover:text-[var(--findable-ink)]";
  return (
    <section className="relative w-full overflow-hidden bg-[var(--findable-canvas)] text-[var(--findable-ink)]">
      {/* 상단 atmospheric 라벤더 글로우 (Resend 패턴) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60vh]"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% 0%, var(--findable-glow-purple), transparent 60%)",
        }}
      />

      {/* TOP NAV — Hero 안 인라인 (sticky 제거, 디자인 안정 우선) */}
      <header className="relative z-50 flex h-14 items-center justify-between border-[var(--findable-hairline)] border-b px-5 lg:px-8">
        <Link
          aria-label="파인더블 Findable"
          className="inline-flex items-baseline text-[var(--findable-ink)] transition hover:opacity-80"
          href={lp || "/"}
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
          <span className="ml-2 text-[11px] text-[var(--findable-ink-muted)]">
            파인더블
          </span>
          <span
            aria-hidden
            className="ml-[5px] inline-block h-[5px] w-[5px] bg-[var(--findable-primary)]"
          />
        </Link>

        <nav
          className="hidden items-center gap-5 xl:gap-8 md:flex"
          style={{ fontFamily: "var(--findable-font-sans)" }}
        >
          <Link className={navLinkClass} href={navItems.home.href}>
            {navItems.home.label}
          </Link>

          <Link className={navLinkClass} href={navItems.knowledge.href}>
            {navItems.knowledge.label}
          </Link>

          <Link className={navLinkClass} href={navItems.faq.href}>
            {navItems.faq.label}
          </Link>

          {/* 라벨은 블로그 허브로 즉시 이동하고, 화살표만 세부 메뉴를 연다.
              기존에는 라벨 전체가 버튼이라 첫 클릭이 "무반응"처럼 보였다. */}
          <div className="group relative flex w-fit items-center">
            <Link
              className={`${navLinkClass} group-focus-within:text-[var(--findable-ink)] group-hover:text-[var(--findable-ink)]`}
              href={insightMenu.href}
            >
              {insightMenu.label}
            </Link>
            <button
              aria-label={
                isKo ? "인사이트 하위 메뉴 열기" : "Open insight menu"
              }
              aria-haspopup="menu"
              className="ml-0.5 inline-flex items-center text-[var(--findable-ink-subtle)] transition hover:text-[var(--findable-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--findable-primary)]"
              type="button"
            >
              <ChevronDown className="h-3.5 w-3.5 opacity-70 transition group-focus-within:rotate-180 group-hover:rotate-180" />
            </button>
            <div
              className="findable-glass !absolute invisible top-full left-1/2 z-50 mt-2 w-52 -translate-x-1/2 translate-y-1 rounded-lg p-1.5 opacity-0 transition-all duration-150 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"
              role="menu"
            >
              {insightMenu.children.map((c) => (
                <Link
                  className="block rounded-md px-3 py-2 text-[13px] text-[var(--findable-ink-subtle)] transition hover:bg-white/[0.06] hover:text-[var(--findable-ink)]"
                  href={c.href}
                  key={c.href}
                  role="menuitem"
                >
                  {c.label}
                </Link>
              ))}
            </div>
          </div>

          <Link className={navLinkClass} href={navItems.pricing.href}>
            {navItems.pricing.label}
          </Link>
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
              className={`rounded px-1.5 py-0.5 transition ${
                isKo
                  ? "bg-[var(--findable-surface-2)] text-[var(--findable-ink)]"
                  : "text-[var(--findable-ink-tertiary)] hover:text-[var(--findable-ink)]"
              }`}
              href="/ko"
            >
              KO
            </a>
            <a
              className={`rounded px-1.5 py-0.5 transition ${
                isKo
                  ? "text-[var(--findable-ink-tertiary)] hover:text-[var(--findable-ink)]"
                  : "bg-[var(--findable-surface-2)] text-[var(--findable-ink)]"
              }`}
              href="/en"
            >
              EN
            </a>
          </div>
          <a
            className="hidden rounded-md px-3 py-1.5 text-[14px] text-[var(--findable-ink)] transition hover:bg-[var(--findable-surface-1)] sm:inline-block"
            href={`${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.findable.co.kr"}/sign-in`}
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {navSignIn}
          </a>
          <Link
            className="findable-btn-primary flex h-9 items-center rounded-md bg-[var(--findable-ink)] px-3.5 font-medium text-[14px] text-[var(--findable-canvas)] transition hover:bg-[var(--findable-ink-muted)]"
            href={`${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.findable.co.kr"}/sign-up`}
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {navAudit}
          </Link>
        </div>
      </header>

      {/* HERO CONTENT */}
      <div className="relative z-10 mx-auto flex max-w-[1200px] flex-col items-center px-8 pt-16 pb-12 text-center md:pt-24 md:pb-14">
        {/* H1 — Toss 톤 명사구 단언 */}
        <h1
          className="max-w-[1100px] opacity-0"
          style={{
            fontFamily: isKo
              ? "var(--findable-font-display-kr)"
              : "var(--findable-font-display)",
            fontSize: "clamp(40px, 5.5vw, 80px)",
            lineHeight: 1.08,
            // 한글은 정사각 격자라 자간을 좁히면 글자가 붙는다 → 한국어에선 0
            letterSpacing: isKo ? "0" : "-0.035em",
            fontWeight: 500,
            // 🔴 2026-08-15 모션 실측 — 0.8s+0.2s delay = 1.0s 였다.
            //   MD3 공식 토큰(json/motion.json): extra-long(700ms~)은 일반 UI 에 쓰지 않는다.
            //   경쟁사 실측(60fps 프레임차분): Profound 헤드라인 전환 83~100ms.
            //   → long2(500ms) + delay 0.1s = 0.6s 로 압축.
            animation:
              "findable-fade-up 0.5s var(--findable-ease-out-soft) 0.1s forwards",
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
              "findable-fade-up 0.4s var(--findable-ease-out-soft) 0.2s forwards",
          }}
        >
          {heroSub}
        </p>

        {/* Sub — 25초 검증 사실 + 30일 제거 */}
        <p
          className="mt-4 max-w-[680px] text-[16px] text-[var(--findable-ink-muted)] leading-[1.6] opacity-0"
          style={{
            fontFamily: "var(--findable-font-sans)",
            animation:
              "findable-fade-up 0.4s var(--findable-ease-out-soft) 0.28s forwards",
          }}
        >
          {heroTagline}
        </p>

        {/* CTAs — Primary 흰색 (Resend 패턴) + Secondary ghost */}
        <div
          className="mt-10 flex flex-col items-center gap-2.5 opacity-0 sm:flex-row"
          style={{
            // 🔴 CTA 는 이 페이지의 주 행동이다. 이전엔 0.5s+0.7s = **1.2초 뒤에야 나타났다**
            //   → 그 전까지 방문자는 누를 것이 없다. 가장 먼저 손에 잡혀야 하므로 0.36s 로 당긴다.
            animation:
              "findable-fade-up 0.36s var(--findable-ease-out-soft) 0.36s forwards",
          }}
        >
          <Link
            className="findable-btn-primary flex h-10 items-center gap-2 rounded-md bg-[var(--findable-ink)] px-4 font-medium text-[14px] text-[var(--findable-canvas)] transition hover:bg-[var(--findable-ink-muted)]"
            href={`${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.findable.co.kr"}/sign-up`}
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {ctaPrimary}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            className="flex h-10 items-center rounded-md px-4 font-medium text-[14px] text-[var(--findable-ink-muted)] transition hover:bg-[var(--findable-surface-1)] hover:text-[var(--findable-ink)]"
            href={`${lp}/pricing`}
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {ctaSecondary}
          </Link>
        </div>

        {/* AI 엔진 마키 — 아이콘 대신 각 서비스의 워드마크를 사용한다. */}
        <div
          className="mt-12 w-full max-w-[980px] overflow-hidden opacity-0"
          style={{
            animation:
              "findable-fade-up-sm 0.35s var(--findable-ease-out-soft) 0.45s forwards",
          }}
        >
          <p
            className="mb-4 text-center text-[11px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.18em]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {enginesLabel}
          </p>
          <div aria-hidden="true" className="findable-engine-marquee">
            <div className="findable-engine-track">
              {["a", "b"].map((copy) => (
                <div className="findable-engine-set" key={copy}>
                  {ENGINE_MARKS.map((engine) => (
                    <div className="findable-engine-chip" key={engine.alt}>
                      <img
                        alt={engine.alt}
                        className="findable-engine-logo"
                        fetchPriority={copy === "a" ? "high" : "auto"}
                        height="20"
                        loading={copy === "a" ? "eager" : "lazy"}
                        src={engine.src}
                        width="88"
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <style>{`
        .findable-engine-marquee { overflow: hidden; }
        .findable-engine-track { display: flex; width: max-content; animation: findable-engine-roll 26s linear infinite; will-change: transform; }
        .findable-engine-set { display: flex; gap: 48px; padding-right: 48px; }
        .findable-engine-marquee:hover .findable-engine-track { animation-play-state: paused; }
        .findable-engine-chip { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; height: 38px; }
        .findable-engine-logo { display: block; width: auto; max-width: 88px; height: 20px; object-fit: contain; filter: grayscale(1) brightness(0) invert(1); opacity: 0.82; }
        @keyframes findable-engine-roll { to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) { .findable-engine-track { animation: none; } }
      `}</style>
    </section>
  );
};
