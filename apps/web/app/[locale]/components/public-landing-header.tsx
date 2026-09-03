import { ChevronDown } from "lucide-react";
import Link from "next/link";

interface PublicLandingHeaderProps {
  locale?: string;
}

/**
 * The public product header is deliberately shared by the home page and every
 * Findable-owned content hub. Keeping it here makes a landing-nav release a
 * single change, rather than a series of copy-and-paste edits.
 */
export const PublicLandingHeader = ({
  locale = "ko",
}: PublicLandingHeaderProps) => {
  const isKo = locale.startsWith("ko");
  const lp = isKo ? "/ko" : "/en";
  const insightMenu = isKo
    ? {
        label: "인사이트·블로그",
        href: `${lp}/insights`,
        children: [
          { label: "블로그 전체", href: `${lp}/insights` },
          { label: "GEO 리포트", href: `${lp}/report/k-beauty-geo-2026q2` },
          {
            label: "벤치마크 리서치",
            href: `${lp}/research/k-geo-bench-v0_1`,
          },
        ],
      }
    : {
        label: "Insights & blog",
        href: `${lp}/insights`,
        children: [{ label: "All insights", href: `${lp}/insights` }],
      };
  const navItems = isKo
    ? {
        home: { label: "홈", href: lp || "/" },
        knowledge: { label: "GEO·SEO 가이드", href: `${lp}/glossary` },
        faq: { label: "FAQ", href: `${lp}/#faq` },
        pricing: { label: "요금제", href: `${lp}/pricing` },
      }
    : {
        home: { label: "Home", href: lp || "/" },
        knowledge: { label: "GEO & SEO guide", href: `${lp}/glossary` },
        faq: { label: "FAQ", href: `${lp}/#faq` },
        pricing: { label: "Pricing", href: `${lp}/pricing` },
      };
  const navSignIn = isKo ? "로그인" : "Sign in";
  const navAudit = isKo ? "무료로 시작" : "Start free";
  const navLinkClass =
    "text-[14px] text-[var(--findable-ink-subtle)] transition hover:text-[var(--findable-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--findable-primary)]";

  return (
    <header className="relative z-50 flex h-14 items-center justify-between border-[var(--findable-hairline)] border-b bg-[var(--findable-canvas)] px-5 lg:px-8">
      <Link
        aria-label="파인더블 Findable"
        className="inline-flex items-baseline text-[var(--findable-ink)] transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--findable-primary)]"
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
        aria-label={isKo ? "주요 메뉴" : "Primary navigation"}
        className="hidden items-center gap-5 md:flex xl:gap-8"
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
        <div className="group relative flex w-fit items-center">
          <Link
            className={`${navLinkClass} group-focus-within:text-[var(--findable-ink)] group-hover:text-[var(--findable-ink)]`}
            href={insightMenu.href}
          >
            {insightMenu.label}
          </Link>
          <button
            aria-haspopup="menu"
            aria-label={isKo ? "인사이트 하위 메뉴 열기" : "Open insight menu"}
            className="ml-0.5 inline-flex items-center text-[var(--findable-ink-subtle)] transition hover:text-[var(--findable-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--findable-primary)]"
            type="button"
          >
            <ChevronDown
              aria-hidden="true"
              className="h-3.5 w-3.5 opacity-70 transition group-focus-within:rotate-180 group-hover:rotate-180"
            />
          </button>
          <div
            className="findable-glass !absolute invisible top-full left-1/2 z-50 mt-2 w-52 -translate-x-1/2 translate-y-1 rounded-lg p-1.5 opacity-0 transition-[opacity,transform,visibility] duration-150 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"
            role="menu"
          >
            {insightMenu.children.map((item) => (
              <Link
                className="block rounded-md px-3 py-2 text-[13px] text-[var(--findable-ink-subtle)] transition hover:bg-white/[0.06] hover:text-[var(--findable-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--findable-primary)]"
                href={item.href}
                key={item.href}
                role="menuitem"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
        <Link className={navLinkClass} href={navItems.pricing.href}>
          {navItems.pricing.label}
        </Link>
      </nav>

      <div className="flex items-center gap-2">
        <div
          className="hidden items-center gap-1 rounded-md border border-[var(--findable-hairline)] px-1.5 py-1 text-[12px] sm:flex"
          style={{ fontFamily: "var(--findable-font-mono)" }}
        >
          <a
            className={`rounded px-1.5 py-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--findable-primary)] ${isKo ? "bg-[var(--findable-surface-2)] text-[var(--findable-ink)]" : "text-[var(--findable-ink-tertiary)] hover:text-[var(--findable-ink)]"}`}
            href="/ko"
          >
            KO
          </a>
          <a
            className={`rounded px-1.5 py-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--findable-primary)] ${isKo ? "text-[var(--findable-ink-tertiary)] hover:text-[var(--findable-ink)]" : "bg-[var(--findable-surface-2)] text-[var(--findable-ink)]"}`}
            href="/en"
          >
            EN
          </a>
        </div>
        <a
          className="hidden rounded-md px-3 py-1.5 text-[14px] text-[var(--findable-ink)] transition hover:bg-[var(--findable-surface-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--findable-primary)] sm:inline-block"
          href={`${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.findable.co.kr"}/sign-in`}
          style={{ fontFamily: "var(--findable-font-sans)" }}
        >
          {navSignIn}
        </a>
        <Link
          className="findable-btn-primary flex h-9 items-center rounded-md bg-[var(--findable-ink)] px-3.5 font-medium text-[14px] text-[var(--findable-canvas)] transition hover:bg-[var(--findable-ink-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--findable-primary)]"
          href={`${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.findable.co.kr"}/sign-up`}
          style={{ fontFamily: "var(--findable-font-sans)" }}
        >
          {navAudit}
        </Link>
      </div>
    </header>
  );
};
