// Findable Footer v3 — Linear footer 패턴 (canvas + ink-subtle, 64×32 padding)
// D-060 (2026-05-11): locale 분기 추가

import Link from "next/link";

// 베타 단계: 실제 활성 페이지만 노출. 빈 링크 0개 원칙 (Linear/Vercel/Resend 표준).
// 링크 href는 lp(localePrefix)와 합쳐서 사용 — 영문(en)은 prefix 없음.
const COLS_KO = (lp: string) => [
  {
    title: "제품",
    links: [
      {
        label: "무료로 시작",
        href: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.findable.co.kr"}/sign-up`,
      },
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
      {
        label: "Start free",
        href: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.findable.co.kr"}/sign-up`,
      },
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
    ? "AI 답변 속 우리 브랜드를 보이게 만드는, 네이버까지 진단하는 GEO 플랫폼."
    : "The GEO platform that diagnoses Naver too, making your brand visible inside AI answers.";
  const betaLabel = isKo ? "v1.0 베타 운영 중" : "v1.0 beta, running now";
  const closingLine = isKo
    ? "AI가 우리 브랜드를 먼저 답하게."
    : "Make AI answer about your brand first.";
  // 사업자 정보(전자상거래법 표기 + PG 심사 요건). 한/영 공통 사실이라 동일 표기.
  //
  // 표기 근거 — 전자상거래법 제10조 제1항: 상호·대표자(1호)·주소(2호)·전화·이메일(3호)
  //   ·사업자등록번호(4호)·이용약관(5호, 위 법적고지 링크로 충족)
  //   + 시행령 제11조의4(6호 위임): **호스팅서비스 제공자의 상호** → Vercel Inc.
  //     (실측 2026-08-03: www·app 응답 헤더 `server: Vercel`. 가비아는 도메인
  //      등록대행자일 뿐 호스팅사가 아니므로 표기 대상 아님.)
  //
  // ⚠️ **통신판매업 신고번호는 넣지 않는다.** 제10조 표기 목록에 없고(신고번호 의무는
  //   제13조 = 신고를 한 경우), 인디고차일드는 「통신판매업 신고 면제 기준에 대한 고시」
  //   (공정위고시 제2020-11호) 제2조 제1항 제1호(직전년도 거래횟수 50회 미만)로 신고 면제
  //   대상이다. 없는 번호를 쓰면 허위 표시가 된다.
  //   🔴 단, 면제는 **직전년도** 기준 → 연 거래 50회를 넘고 간이과세자도 아니게 되면
  //      이듬해 신고 의무 발생(미신고 3천만원 이하 벌금). 그때 이 줄에 신고번호 추가.
  const businessInfo = isKo
    ? "인디고차일드 | 대표 나현덕 | 사업자등록번호 534-15-01132 | 주소 충청북도 청주시 서원구 청남로2005번길 96, 우성아파트 105동 709호 | 전화 010-8958-2547 | 이메일 kendrick@indigochild.kr | 호스팅서비스 제공: Vercel Inc."
    : "Indigochild | CEO Hyeondeok Na | Business Reg. No. 534-15-01132 | 96, Cheongnam-ro 2005beon-gil, Seowon-gu, Cheongju-si, Chungcheongbuk-do, Korea | Tel 010-8958-2547 | Email kendrick@indigochild.kr | Hosting provider: Vercel Inc.";

  return (
    <footer
      className="border-[var(--findable-hairline)] border-t bg-[var(--findable-canvas)] text-[var(--findable-ink-subtle)]"
      id="site-footer"
    >
      <div className="mx-auto max-w-[1200px] px-8 py-16">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-[2fr_repeat(3,1fr)]">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link
              aria-label="Findable"
              className="inline-flex items-baseline text-[var(--findable-ink)] transition hover:opacity-80"
              href={lp || "/"}
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
                className="text-[12px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.14em]"
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
                      className="text-[13px] text-[var(--findable-ink-subtle)] transition hover:text-[var(--findable-primary)]"
                      href={l.href}
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* 사업자 정보 — 전자상거래법 표기 의무 + PG 심사 필수(사업자정보 유무). */}
        <div className="mt-16 border-[var(--findable-hairline)] border-t pt-8">
          <p
            className="text-[12px] text-[var(--findable-ink-tertiary)] leading-[1.7]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {businessInfo}
          </p>
        </div>

        <div className="mt-6 flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
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
