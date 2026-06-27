// Findable Footer v3 — Linear footer 패턴 (canvas + ink-subtle, 64×32 padding)
// D-060 (2026-05-11): locale 분기 추가

import Link from "next/link";

// 베타 단계: 실제 활성 페이지만 노출. 빈 링크 0개 원칙 (Linear/Vercel/Resend 표준).
// 링크 href는 lp(localePrefix)와 합쳐서 사용 — 영문(en)은 prefix 없음.
const COLS_KO = (lp: string) => [
  {
    title: "제품",
    links: [
      { label: "무료 진단", href: `${lp}/audit` },
      { label: "요금제", href: `${lp}/pricing` },
    ],
  },
  {
    title: "회사",
    links: [{ label: "데모 신청", href: `${lp}/contact` }],
  },
  {
    title: "법적고지",
    links: [
      { label: "개인정보처리방침", href: `${lp}/legal/privacy` },
      { label: "이용약관", href: `${lp}/legal/terms` },
    ],
  },
];

const COLS_EN = (lp: string) => [
  {
    title: "Product",
    links: [
      { label: "Free audit", href: `${lp}/audit` },
      { label: "Pricing", href: `${lp}/pricing` },
    ],
  },
  {
    title: "Company",
    links: [{ label: "Book a demo", href: `${lp}/contact` }],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: `${lp}/legal/privacy` },
      { label: "Terms of Service", href: `${lp}/legal/terms` },
    ],
  },
];

interface FooterProps {
  locale?: string;
}

export const Footer = ({ locale = "ko" }: FooterProps) => {
  const isKo = locale.startsWith("ko");
  const lp = isKo ? "/ko" : "";
  const COLS = isKo ? COLS_KO(lp) : COLS_EN(lp);
  const tagline = isKo
    ? "AI 답변 속 우리 브랜드를 보이게 만드는, 한국 최초 GEO 플랫폼."
    : "Korea's first GEO platform — making your brand visible inside AI answers.";
  const betaLabel = isKo ? "v1.0 베타 운영 중" : "v1.0 beta — running now";
  const closingLine = isKo
    ? "AI가 우리 브랜드를 먼저 답하게."
    : "Make AI answer about your brand first.";

  return (
    <footer className="border-[var(--findable-hairline)] border-t bg-[var(--findable-canvas)] text-[var(--findable-ink-subtle)]">
      <div className="mx-auto max-w-[1200px] px-8 py-16">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-[2fr_repeat(3,1fr)]">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link
              href={lp || "/"}
              className="inline-flex items-baseline text-[var(--findable-ink)] transition hover:opacity-80"
              aria-label="Findable"
            >
              <span
                className="text-[26px] leading-none"
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
                className="ml-[6px] inline-block h-[6px] w-[6px] bg-[var(--findable-primary)]"
              />
            </Link>
            <p
              className="mt-5 max-w-[280px] text-[13px] leading-[1.6]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              {tagline}
            </p>
            <div
              className="mt-6 flex items-center gap-2 text-[12px]"
              style={{ fontFamily: "var(--findable-font-mono)" }}
            >
              <span className="inline-block h-2 w-2 rounded-full bg-[var(--findable-primary)]" />
              <span>{betaLabel}</span>
            </div>
          </div>

          {/* 4 columns */}
          {COLS.map((col) => (
            <div key={col.title}>
              <p
                className="text-[12px] uppercase tracking-[0.14em] text-[var(--findable-ink-tertiary)]"
                style={{ fontFamily: "var(--findable-font-sans)" }}
              >
                {col.title}
              </p>
              <ul
                className="mt-4 space-y-2.5"
                style={{ fontFamily: "var(--findable-font-sans)" }}
              >
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-[13px] text-[var(--findable-ink-subtle)] transition hover:text-[var(--findable-primary)]"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col items-start justify-between gap-3 border-[var(--findable-hairline)] border-t pt-8 md:flex-row md:items-center">
          <p
            className="text-[12px] text-[var(--findable-ink-tertiary)]"
            style={{ fontFamily: "var(--findable-font-mono)" }}
          >
            © 2026 Findable
          </p>
          <p
            className="text-[12px] text-[var(--findable-ink-tertiary)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {closingLine}
          </p>
        </div>
      </div>
    </footer>
  );
};
