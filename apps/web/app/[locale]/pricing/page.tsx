// /pricing — Findable 4-tier (Linear 패턴, D-040 적용)
// D-061 (2026-05-12): locale 분기 추가

import { createMetadata } from "@repo/seo/metadata";
import { ArrowRight, Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

interface PricingPageProps {
  params: Promise<{ locale: string }>;
}

export const generateMetadata = async ({
  params,
}: PricingPageProps): Promise<Metadata> => {
  const { locale } = await params;
  const isKo = locale.startsWith("ko");
  return createMetadata({
    title: isKo ? "요금제" : "Pricing",
    description: isKo
      ? "Findable 요금제. 무료 진단부터 엔터프라이즈까지, 우리 브랜드 규모에 맞는 플랜을 제공합니다."
      : "Findable pricing. From free audit to enterprise — a plan that fits your brand's scale.",
  });
};

interface Tier {
  name: string;
  price: string;
  period: string;
  desc: string;
  cta: string;
  href: string;
  featured: boolean;
  badge?: string;
  features: string[];
}

const TIERS_KO: Tier[] = [
  {
    name: "Free Audit",
    price: "₩0",
    period: "1회 무료",
    desc: "도메인 입력 한 번으로 7개 AI 진단 결과를 받아보세요.",
    cta: "무료로 진단받기",
    href: "/audit",
    featured: false,
    features: [
      "7개 AI 답변 1회 진단",
      "1페이지 PDF 리포트",
      "이메일 발송",
      "카드 등록 불필요",
    ],
  },
  {
    name: "Starter",
    price: "₩99,000",
    period: "월",
    desc: "1인 창업자·개인 브랜드를 위한 입문 플랜.",
    cta: "Starter 시작하기",
    href: "/contact",
    featured: false,
    features: [
      "월 30개 프롬프트 추적",
      "1개 브랜드 측정",
      "주간 자동 리포트",
      "이메일 알림",
      "Free Audit 모든 기능",
    ],
  },
  {
    name: "Growth",
    price: "₩390,000",
    period: "월",
    desc: "성장 중인 D2C·SMB를 위한 추천 플랜.",
    cta: "Growth 시작하기",
    href: "/contact",
    featured: true,
    badge: "추천",
    features: [
      "월 150개 프롬프트 추적",
      "5개 브랜드 측정",
      "Korean Entity Grounding",
      "Top 3 액션 추천",
      "Notion · Google Docs Export",
      "Starter 모든 기능",
    ],
  },
  {
    name: "Enterprise",
    price: "맞춤",
    period: "연 ₩30M~",
    desc: "대기업·금융·F500 한국 지사 맞춤 플랜.",
    cta: "상담 예약",
    href: "/contact",
    featured: false,
    features: [
      "무제한 프롬프트 + 브랜드",
      "전담 GEO 매니저",
      "SSO · SAML",
      "API 액세스",
      "맞춤 SLA",
      "Growth 모든 기능",
    ],
  },
];

const TIERS_EN: Tier[] = [
  {
    name: "Free Audit",
    price: "₩0",
    period: "1 free run",
    desc: "Drop in your domain once and get a diagnosis across 7 AI engines.",
    cta: "Get a free audit",
    href: "/audit",
    featured: false,
    features: [
      "1 audit across 7 AI answers",
      "1-page PDF report",
      "Emailed to you",
      "No card required",
    ],
  },
  {
    name: "Starter",
    price: "₩99,000",
    period: "mo",
    desc: "An entry plan for solo founders and personal brands.",
    cta: "Start with Starter",
    href: "/contact",
    featured: false,
    features: [
      "30 tracked prompts / month",
      "1 brand monitored",
      "Weekly automated report",
      "Email alerts",
      "Everything in Free Audit",
    ],
  },
  {
    name: "Growth",
    price: "₩390,000",
    period: "mo",
    desc: "Our recommended plan for growing D2C and SMB brands.",
    cta: "Start with Growth",
    href: "/contact",
    featured: true,
    badge: "Recommended",
    features: [
      "150 tracked prompts / month",
      "5 brands monitored",
      "Korean Entity Grounding",
      "Top 3 recommended actions",
      "Notion · Google Docs export",
      "Everything in Starter",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "from ₩30M / yr",
    desc: "A tailored plan for enterprises, finance, and F500 Korea offices.",
    cta: "Book a call",
    href: "/contact",
    featured: false,
    features: [
      "Unlimited prompts + brands",
      "Dedicated GEO manager",
      "SSO · SAML",
      "API access",
      "Custom SLA",
      "Everything in Growth",
    ],
  },
];

const FAQ_KO = [
  {
    q: "무료 진단은 정말 무료인가요?",
    a: "네. 카드 등록 없이 이메일만으로 1회 진단받을 수 있어요. 24시간에 1회 제한이 있습니다.",
  },
  {
    q: "한국어와 영어 답변 둘 다 측정되나요?",
    a: "네. ChatGPT · Gemini · Claude · Perplexity는 영어와 한국어 모두 측정하고, HyperCLOVA · 네이버 · 다음은 한국어 위주로 측정합니다.",
  },
  {
    q: "v1.5 기능은 언제 나오나요?",
    a: "Cafe24·네이버 스마트스토어·WordPress 원클릭 발행, Brand Guardrails 감수, Agentic Commerce 모듈은 2026년 4분기 출시 예정입니다.",
  },
];

const FAQ_EN = [
  {
    q: "Is the free audit really free?",
    a: "Yes. You can run one audit with just an email — no card required. There's a 1-per-24-hours limit.",
  },
  {
    q: "Do you measure both Korean and English answers?",
    a: "Yes. ChatGPT · Gemini · Claude · Perplexity are measured in both English and Korean; HyperCLOVA · Naver · Daum are measured primarily in Korean.",
  },
  {
    q: "When do v1.5 features arrive?",
    a: "One-click publishing to Cafe24 · Naver SmartStore · WordPress, Brand Guardrails review, and the Agentic Commerce module are slated for Q4 2026.",
  },
];

const PricingPage = async ({ params }: PricingPageProps) => {
  const { locale } = await params;
  const isKo = locale.startsWith("ko");
  const lp = isKo ? "/ko" : "";
  const tiers = isKo ? TIERS_KO : TIERS_EN;
  const faq = isKo ? FAQ_KO : FAQ_EN;
  const displayFont = isKo
    ? "var(--findable-font-display-kr)"
    : "var(--findable-font-display)";
  const copy = isKo
    ? {
        eyebrow: "요금제",
        h1: "우리 브랜드 규모에 맞춰, 시작하세요.",
        sub: "무료 진단으로 시작해서, 필요할 때 업그레이드하세요. 카드 등록은 Starter 이상에서만 필요해요.",
        scaleName: "Scale (₩990,000 / 월)",
        scaleDesc: ": 중견 D2C·미드마켓을 위한 무제한 브랜드 + 500 프롬프트 플랜. ",
        scaleCta: "상담 예약하기 →",
        faqTitle: "자주 묻는 질문",
        per: "/",
      }
    : {
        eyebrow: "Pricing",
        h1: "Start at the scale your brand needs.",
        sub: "Begin with a free audit and upgrade when you need to. A card is only required from Starter and up.",
        scaleName: "Scale (₩990,000 / mo)",
        scaleDesc:
          ": unlimited brands + 500 prompts for mid-market D2C teams. ",
        scaleCta: "Book a call →",
        faqTitle: "Frequently asked questions",
        per: "/",
      };

  return (
    <div className="min-h-screen w-full bg-[var(--findable-canvas)] text-[var(--findable-ink)]">
      {/* Hero */}
      <section className="px-8 pt-24 pb-16 text-center">
        <p
          className="text-[12px] uppercase tracking-[0.18em] text-[var(--findable-primary)]"
          style={{ fontFamily: "var(--findable-font-sans)" }}
        >
          {copy.eyebrow}
        </p>
        <h1
          className="mx-auto mt-4 max-w-[800px]"
          style={{
            fontFamily: displayFont,
            fontSize: "clamp(36px, 4.5vw, 56px)",
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            fontWeight: 500,
            wordBreak: "keep-all",
          }}
        >
          {copy.h1}
        </h1>
        <p
          className="mx-auto mt-5 max-w-[560px] text-[16px] leading-[1.6] text-[var(--findable-ink-muted)]"
          style={{ fontFamily: "var(--findable-font-sans)" }}
        >
          {copy.sub}
        </p>
      </section>

      {/* 4-tier 그리드 */}
      <section className="px-8 pb-16">
        <div className="mx-auto grid max-w-[1280px] gap-6 md:grid-cols-2 lg:grid-cols-4">
          {tiers.map((tier) => (
            <article
              key={tier.name}
              className={`relative flex flex-col rounded-xl p-6 ${
                tier.featured
                  ? "bg-[var(--findable-surface-2)] ring-1 ring-[var(--findable-primary)]/40"
                  : "bg-[var(--findable-surface-1)]"
              }`}
            >
              {tier.featured && tier.badge && (
                <span
                  className="-top-3 absolute right-6 rounded-full bg-[var(--findable-primary)] px-3 py-1 text-[11px] text-white"
                  style={{
                    fontFamily: "var(--findable-font-sans)",
                    fontWeight: 500,
                  }}
                >
                  {tier.badge}
                </span>
              )}
              <h3
                className="text-[16px]"
                style={{
                  fontFamily: "var(--findable-font-sans)",
                  fontWeight: 600,
                }}
              >
                {tier.name}
              </h3>
              <p
                className="mt-2 min-h-[44px] text-[13px] leading-[1.5] text-[var(--findable-ink-muted)]"
                style={{ fontFamily: "var(--findable-font-sans)" }}
              >
                {tier.desc}
              </p>

              <div className="mt-6 flex min-h-[44px] items-baseline gap-2">
                <span
                  style={{
                    fontFamily: displayFont,
                    fontSize: "32px",
                    fontWeight: 500,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {tier.price}
                </span>
                <span
                  className="text-[13px] text-[var(--findable-ink-tertiary)]"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {copy.per} {tier.period}
                </span>
              </div>

              <Link
                href={`${lp}${tier.href}`}
                className={`mt-6 flex h-10 items-center justify-center gap-2 rounded-md text-[14px] transition ${
                  tier.featured
                    ? "findable-btn-primary bg-[var(--findable-ink)] text-[var(--findable-canvas)] hover:bg-[var(--findable-ink-muted)]"
                    : "bg-[var(--findable-surface-3)] text-[var(--findable-ink)] hover:bg-[var(--findable-surface-2)]"
                }`}
                style={{
                  fontFamily: "var(--findable-font-sans)",
                  fontWeight: 500,
                }}
              >
                {tier.cta}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>

              <ul className="mt-6 space-y-2.5">
                {tier.features.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2 text-[13px] text-[var(--findable-ink-muted)]"
                    style={{ fontFamily: "var(--findable-font-sans)" }}
                  >
                    <Check
                      className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-[var(--findable-primary)]"
                      strokeWidth={2.5}
                    />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        {/* Scale footnote */}
        <div className="mx-auto mt-10 max-w-[1280px] text-center">
          <p
            className="text-[13px] text-[var(--findable-ink-muted)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            <span className="text-[var(--findable-ink)]">{copy.scaleName}</span>
            {copy.scaleDesc}
            <Link
              href={`${lp}/contact`}
              className="text-[var(--findable-primary)] underline-offset-4 hover:underline"
            >
              {copy.scaleCta}
            </Link>
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-[var(--findable-canvas)] px-8 pb-32">
        <div className="mx-auto max-w-[800px]">
          <h2
            className="text-center"
            style={{
              fontFamily: displayFont,
              fontSize: "clamp(24px, 3vw, 32px)",
              lineHeight: 1.2,
              letterSpacing: "-0.02em",
              fontWeight: 500,
            }}
          >
            {copy.faqTitle}
          </h2>
          <dl className="mt-10 space-y-4">
            {faq.map((item) => (
              <div
                key={item.q}
                className="rounded-lg bg-[var(--findable-surface-1)] p-6"
              >
                <dt
                  className="text-[15px] text-[var(--findable-ink)]"
                  style={{
                    fontFamily: "var(--findable-font-sans)",
                    fontWeight: 600,
                  }}
                >
                  {item.q}
                </dt>
                <dd
                  className="mt-2 text-[14px] leading-[1.6] text-[var(--findable-ink-muted)]"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {item.a}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </div>
  );
};

export default PricingPage;
