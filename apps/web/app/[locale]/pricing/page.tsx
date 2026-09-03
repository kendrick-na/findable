// /pricing — Findable 4-tier (Linear 패턴, D-040 적용)
// D-061 (2026-05-12): locale 분기 추가

import { cn } from "@repo/design-system/lib/utils";
import { getDictionary } from "@repo/internationalization";
import { createMetadata } from "@repo/seo/metadata";
import { ArrowRight, Check, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { env } from "@/env";
import { FooterCTA } from "../(home)/components/footer-cta";
import { PublicLandingHeader } from "../components/public-landing-header";

// ⚡ ISR (2026-07-30 성능): dynamic API 사용 0 → 1시간 캐시(CDN). [locale] 전 페이지
//   매 요청 SSR이던 문제의 페이지 단위 해소. 카피 변경은 재배포로 반영.
export const revalidate = 3600;

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
      : "Findable pricing. From free audit to enterprise, a plan that fits your brand's scale.",
    locale,
    pathname: "/pricing",
  });
};

interface Tier {
  /**
   * 앱(로그인 영역)으로 보낼 티어 = 카드 결제로 즉시 시작하는 유료 플랜.
   * 결제는 로그인 상태에서만 가능하므로(서버가 세션 uid 로 plan 을 부여) 결제 동선은
   * 반드시 앱 `/billing` 이다. 여기서 상담(/contact)으로 보내면 결제 입구가 막힌다.
   */
  app?: boolean;
  badge?: string;
  cta: string;
  desc: string;
  featured: boolean;
  features: string[];
  /** 링크 경로. `app: true` 면 앱(app.findable.co.kr) 기준, 아니면 www 로케일 기준. */
  href: string;
  name: string;
  period: string;
  price: string;
}

/*
 * 🔴 S4(2026-08-11 세션N-19) — **내부 용어를 한국어로 바꿨다**(진단 §원인④·NN/g 2).
 *   `프롬프트 추적`→`질문 추적` · `Korean Entity Grounding`→`한국어 표기 통합 추적` ·
 *   `Top 3 액션 추천`→`먼저 할 일 3가지 추천` · `API 액세스`→`API 연동`.
 *
 * ⚠️ **app 요금제 표(`apps/app/.../lib/pricing.ts`)와 같은 말을 써야 한다.**
 *   같은 상품을 두 화면이 다른 이름으로 부르면 고객이 다른 상품으로 읽는다
 *   (그 파일 상단도 "가격·기능 변경 시 함께 갱신"을 이미 요구한다).
 *   app 쪽은 `{label, hint}` 로 부연 한 줄을 달 수 있는데 여기는 `string[]` 이라
 *   **라벨만 맞추고** 꼭 필요한 부연은 괄호로 붙였다.
 * ℹ️ `TIERS_EN` 은 영어권 대상이라 원문 용어를 유지한다(번역 대상 아님).
 */
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
    href: "/billing",
    app: true,
    featured: false,
    features: [
      "월 30개 질문 추적",
      // 🔴 2026-08-15 — `1개` → `3개`(`packages/auth/plan.ts:121` brandLimit=3 이 단일 진실).
      "3개 브랜드 측정",
      // ⭐ 2026-08-10 추가 — **이미 작동하는데 표에 없어서 못 팔던 기능**.
      //   `planCapabilities("starter").autoRefreshHours = 168`(주간)이 단일 진실이고
      //   새벽 2시 cron(`/api/cron/auto-refresh-tracking`)이 실제로 재측정한다.
      //   ⚠️ "리포트"라고 쓰지 않는다 — 메일 발송은 `FINDABLE_ENABLE_DIGEST_EMAIL` 이
      //   꺼져 있어(프로덕션 env 미설정 실측) 아직 안 간다. 재측정과 메일은 다른 기능이다.
      "주간 자동 재측정",
      "주간 자동 리포트 (준비 중)",
      "이메일 알림 (준비 중)",
      "Free Audit 모든 기능",
    ],
  },
  {
    name: "Growth",
    price: "₩390,000",
    period: "월",
    desc: "성장 중인 D2C·SMB를 위한 추천 플랜.",
    cta: "Growth 시작하기",
    href: "/billing",
    app: true,
    featured: true,
    badge: "추천",
    features: [
      "월 150개 질문 추적",
      "5개 브랜드 측정",
      // ⭐ 2026-08-10 추가 — Growth 도 실제로 **매일**(24h) 돈다.
      //   🔴 Scale 에만 "일간 자동 갱신"이 적혀 있어서 **Growth 의 차별점이 숨어 있었다**
      //   (코드 실측: growth·scale·enterprise 모두 autoRefreshHours=24 로 동일).
      //   Growth 결제자가 "매일 갱신"을 상위 플랜 전용으로 오해하던 표기 결함.
      "매일 자동 재측정",
      "한국어 표기 통합 추적 (메디큐브·Medicube 처럼 흩어진 표기를 하나로)",
      "먼저 할 일 3가지 추천",
      "Notion · Google Docs Export (준비 중)",
      "Starter 모든 기능",
    ],
  },
  {
    name: "Scale",
    price: "₩990,000",
    period: "월",
    desc: "중견 D2C·미드마켓을 위한 대규모 추적 플랜.",
    cta: "Scale 시작하기",
    href: "/billing",
    app: true,
    featured: false,
    features: [
      "월 500개 질문 추적",
      "무제한 브랜드 측정",
      // ⚠️ "일간 자동 갱신"을 여기서 뺐다(2026-08-10) — Growth 와 **주기가 동일**(24h)해서
      //   Scale 전용처럼 보이던 것이 오표기였다. Scale 의 실제 차별점은 추적 수·브랜드 수·API 다.
      //   "Growth 모든 기능"에 이미 포함되므로 정보 손실도 없다.
      "API 연동",
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
    href: "/billing",
    app: true,
    featured: false,
    features: [
      "30 tracked prompts / month",
      "1 brand monitored",
      // ⭐ 2026-08-10 — KO 표와 동일 사실. 재측정은 작동 중, 리포트 메일은 아직 꺼짐.
      "Weekly automatic re-measurement",
      "Weekly automated report (coming soon)",
      "Email alerts (coming soon)",
      "Everything in Free Audit",
    ],
  },
  {
    name: "Growth",
    price: "₩390,000",
    period: "mo",
    desc: "Our recommended plan for growing D2C and SMB brands.",
    cta: "Start with Growth",
    href: "/billing",
    app: true,
    featured: true,
    badge: "Recommended",
    features: [
      "150 tracked prompts / month",
      "5 brands monitored",
      // ⭐ Growth 도 매일 갱신된다(Scale 전용이 아니었다).
      "Daily automatic re-measurement",
      "Korean Entity Grounding",
      "Top 3 recommended actions",
      "Notion · Google Docs export (coming soon)",
      "Everything in Starter",
    ],
  },
  {
    name: "Scale",
    price: "₩990,000",
    period: "mo",
    desc: "A high-volume tracking plan for mid-market D2C teams.",
    cta: "Start with Scale",
    href: "/billing",
    app: true,
    featured: false,
    features: [
      "500 tracked prompts / month",
      "Unlimited brands monitored",
      // ⚠️ "Daily auto-refresh" 제거 — Growth 와 주기가 같아 Scale 전용 표기는 오표기였다.
      "API access",
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
    a: "Yes. You can run one audit with just an email, no card required. There's a 1-per-24-hours limit.",
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
  const dictionary = await getDictionary(locale);
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
        // 🔴 S7-a(2026-08-11) — `₩30M` 은 영어 축약이라 한국어 화면에서 걸린다(NN/g 2).
        //   app 요금제표(`apps/app/.../lib/pricing.ts`)와 **같은 말**로 맞춘다.
        scaleName: "Enterprise (연 3,000만원~)",
        scaleDesc:
          ": 대기업·금융·F500 한국 지사를 위한 맞춤 플랜. 무제한 프롬프트·브랜드, 전담 GEO 매니저, SSO·SAML, 맞춤 SLA. ",
        scaleCta: "상담 예약하기 →",
        faqTitle: "자주 묻는 질문",
        per: "/",
        // ⚖️ 2026-08-11 — 정기결제(월 자동결제)를 실제로 붙이면서 표기도 사실에 맞췄다.
        //   이전엔 "월 99,000원"만 있어 **자동갱신 여부를 알 수 없었다**(카카오페이 심사관도
        //   이걸 보고 구독 상품으로 오해했다). 자동결제·해지 가능 여부를 함께 밝힌다.
        vatNotice:
          "VAT 별도 · 결제 시 부가세 10%가 더해져요 · 월 자동결제(언제든 해지 가능) 또는 1회 결제 선택",
      }
    : {
        eyebrow: "Pricing",
        h1: "Start at the scale your brand needs.",
        sub: "Begin with a free audit and upgrade when you need to. A card is only required from Starter and up.",
        scaleName: "Enterprise (from ₩30M / yr)",
        scaleDesc:
          ": a tailored plan for enterprises, finance, and F500 Korea offices — unlimited prompts and brands, a dedicated GEO manager, SSO · SAML, and a custom SLA. ",
        scaleCta: "Book a call →",
        faqTitle: "Frequently asked questions",
        per: "/",
        // KO 와 동일 사실. 자동갱신 여부를 밝히지 않으면 표시와 실제가 어긋난다.
        vatNotice:
          "Excl. VAT — 10% is added at checkout · Monthly auto-renewal (cancel anytime) or a one-time payment",
      };

  return (
    <div className="min-h-screen w-full bg-[var(--findable-canvas)] text-[var(--findable-ink)]">
      <PublicLandingHeader locale={locale} />
      {/* Hero */}
      <section className="px-8 pt-24 pb-16 text-center">
        <p
          className="text-[12px] text-[var(--findable-primary)] uppercase tracking-[0.18em]"
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
          className="mx-auto mt-5 max-w-[560px] text-[16px] text-[var(--findable-ink-muted)] leading-[1.6]"
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
              className={`relative flex flex-col rounded-xl p-6 ${
                tier.featured
                  ? "bg-[var(--findable-surface-2)] ring-1 ring-[var(--findable-primary)]/40"
                  : "bg-[var(--findable-surface-1)]"
              }`}
              key={tier.name}
            >
              {tier.featured && tier.badge && (
                <span
                  className="absolute -top-3 right-6 rounded-full bg-[var(--findable-primary)] px-3 py-1 text-[11px] text-[var(--findable-canvas)]"
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
                className="mt-2 min-h-[44px] text-[13px] text-[var(--findable-ink-muted)] leading-[1.5]"
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
              {/* 유료 티어만 세금 안내. 무료(₩0)에 붙이면 "무료인데 세금?" 오독.
                  🔬 국내 B2B SaaS 12곳 실측(2026-08-10): 총액 병기는 0곳,
                  "VAT 별도"가 다수(8/10). 위치는 두레이 방식 = 가격 바로 밑
                  (표 하단 각주는 공정위 drip pricing 지적 소지). */}
              {tier.app && (
                <p
                  className="mt-1 text-[12px] text-[var(--findable-ink-tertiary)]"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {copy.vatNotice}
                </p>
              )}

              <Link
                className={`mt-6 flex h-10 items-center justify-center gap-2 rounded-md text-[14px] transition ${
                  tier.featured
                    ? "findable-btn-primary bg-[var(--findable-ink)] text-[var(--findable-canvas)] hover:bg-[var(--findable-ink-muted)]"
                    : "bg-[var(--findable-surface-3)] text-[var(--findable-ink)] hover:bg-[var(--findable-surface-2)]"
                }`}
                href={
                  tier.app
                    ? `${env.NEXT_PUBLIC_APP_URL}${tier.href}`
                    : `${lp}${tier.href}`
                }
                style={{
                  fontFamily: "var(--findable-font-sans)",
                  fontWeight: 500,
                }}
              >
                {tier.cta}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>

              <ul className="mt-6 space-y-2.5">
                {/* 🔴 미구현 항목은 체크표시를 주지 않는다 (2026-08-06 세션N-7)
                    사고: 요금제가 "주간 자동 리포트"·"이메일 알림"·"Notion·Google Docs Export"를
                    팔고 있었으나 **코드 실측 구현 0건**이고, 결제한 사용자가 앱에 들어가면
                    `alerts/page.tsx`가 "추적 알림을 준비하고 있어요"를 띄웠다.
                    → 결제 후에야 알게 되는 구조 = 표시광고 리스크. 파는 자리에서 먼저 밝힌다.
                    ⚠️ 구현되면 "(준비 중)" 문자열만 지우면 자동으로 체크가 돌아온다. */}
                {tier.features.map((f) => {
                  const pending =
                    f.includes("(준비 중)") || f.includes("(coming soon)");
                  return (
                    <li
                      className={cn(
                        "flex items-start gap-2 text-[13px]",
                        pending
                          ? "text-[var(--findable-ink-muted)]/55"
                          : "text-[var(--findable-ink-muted)]"
                      )}
                      key={f}
                      style={{ fontFamily: "var(--findable-font-sans)" }}
                    >
                      {pending ? (
                        <Clock
                          aria-hidden="true"
                          className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-[var(--findable-ink-muted)]/55"
                          strokeWidth={2}
                        />
                      ) : (
                        <Check
                          className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-[var(--findable-primary)]"
                          strokeWidth={2.5}
                        />
                      )}
                      <span>{f}</span>
                    </li>
                  );
                })}
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
              className="text-[var(--findable-primary)] underline underline-offset-4"
              href={`${lp}/contact`}
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
                className="rounded-lg bg-[var(--findable-surface-1)] p-6"
                key={item.q}
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
                  className="mt-2 text-[14px] text-[var(--findable-ink-muted)] leading-[1.6]"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {item.a}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
      <FooterCTA locale={locale} />
    </div>
  );
};

export default PricingPage;
