import type { Plan } from "@repo/auth/plan";
import {
  amountForPlan,
  listPriceForPlan,
  type PayablePlan,
} from "@repo/payments/catalog";

/**
 * in-app 요금제 표(/billing). apps/web pricing/page.tsx 의 TIERS_KO 와 동일 사실을
 * app 배포에서 쓰기 위한 최소 복제(app은 web 소스를 import 못 하는 별개 Vercel 프로젝트).
 * ⚠️ 가격·기능 변경 시 web pricing 과 함께 갱신.
 *
 * 🔒 단 **결제 금액(VAT 포함)만은 복제하지 않는다** — `@repo/payments/catalog` 에서
 *    읽어온다. 화면에 적힌 금액과 실제 청구액이 갈리면 그대로 표시광고 문제가 된다.
 */
/**
 * 기능 한 줄. 문자열이면 그대로 쓰고, 부연이 필요하면 `{label, hint}` 로 쓴다.
 *
 * 🔴 S4(2026-08-11 세션N-19) — **내부 용어를 팔지 않기 위해 도입**했다.
 *   진단(§원인④): *"`Korean Entity Grounding` 은 영어 전문용어 그대로이고 `프롬프트` 도
 *   업계 밖 사람에게는 설명이 필요한 말이다. 이 두 줄이 Growth(월 39만원)의 핵심
 *   차별점인데 정작 그게 무슨 이득인지는 화면에 없다."*
 *   → 용어를 지우면 검색·상담에서 못 알아듣고, 남기면 못 이해한다.
 *     답 = **한국어를 앞에 두고 부연을 한 줄 붙인다**(카드 폭이 좁아 길어지는 문제 회피).
 *   ⚠️ 부연에 **없는 기능·지어낸 숫자를 쓰지 않는다** — 문구는 실제 동작만 말한다.
 */
/**
 * 🔴 S6-c#2(2026-08-11) — `ready: false` 를 **데이터로** 들고 있는다.
 *   결함: 아직 없는 기능(`(준비 중)`)이 **완성 기능과 똑같은 주황 체크(✓)** 로 그려졌다
 *   (`billing/page.tsx` 가 `CheckIcon` 하나로 전부 렌더). 체크는 "제공됨"으로 읽히므로
 *   돈 내는 화면에서 **없는 것을 있다고 표시**한 셈이다(원인② 계열).
 *   ⚠️ 라벨의 "(준비 중)" 문자열을 파싱하지 않는다 — 문구가 바뀌면 **조용히** 깨진다.
 *      플래그를 진실로 두고 접미사는 라벨에서 뺀다(아이콘·색이 이미 상태를 말한다).
 */
export type PricingFeature =
  | string
  | { hint?: string; label: string; ready?: boolean };

export interface PricingTier {
  /** 실제 청구액(KRW, VAT 포함). 무료·상담 티어는 undefined. 카탈로그에서 온다. */
  chargedKrw?: number;
  cta: string;
  desc: string;
  featured?: boolean;
  features: PricingFeature[];
  // web 상대 경로(/audit·/contact). billing 페이지에서 WEB_URL 붙여 사용.
  href: string;
  name: string;
  period: string;
  // 이 tier 가 대응하는 plan 코드(현재 플랜 하이라이트용). null=코드 plan 없음(무료 1회).
  plan: Plan | null;
  price: string;
}

/** 카탈로그에서 청구액을 읽어온다. 결제 대상이 아닌 plan 이면 undefined. */
function chargedFor(plan: PayablePlan): number | undefined {
  return amountForPlan(plan) ?? undefined;
}

/** 화면 표시가(세전). 정기결제 사전고지에 "표시가 / 청구액"을 함께 보여주는 데 쓴다. */
export function listFor(plan: PayablePlan): number | undefined {
  return listPriceForPlan(plan) ?? undefined;
}

export const PRICING_TIERS: PricingTier[] = [
  {
    plan: "free",
    name: "Free Audit",
    price: "₩0",
    period: "1회 무료",
    desc: "도메인 입력 한 번으로 7개 AI 진단 결과를 받아보세요.",
    features: [
      "7개 AI 답변 1회 진단",
      "1페이지 PDF 리포트",
      "이메일 발송",
      "카드 등록 불필요",
    ],
    cta: "무료로 진단받기",
    href: "/ko/audit",
  },
  {
    plan: "starter",
    name: "Starter",
    price: "₩99,000",
    period: "월",
    chargedKrw: chargedFor("starter"),
    desc: "1인 창업자·개인 브랜드를 위한 입문 플랜.",
    features: [
      {
        label: "월 30개 질문 추적",
        hint: "고객이 AI에 물어볼 질문 30개를 우리가 대신 물어보고 결과를 쌓아요",
      },
      // 🔴 2026-08-15 — `1개` → `3개`. `planCapabilities("starter").brandLimit = 3`
      //   (`packages/auth/plan.ts:121`)인데 화면은 1개라고 고지했다.
      //   = **돈 낸 고객에게 권리를 축소 고지**한 것(반대 방향 결함보다 드물지만 같은 부정직).
      "3개 브랜드 측정",
      // ⭐ web pricing 과 동일 사실(2026-08-10) — 이미 작동하는데 표에 없던 기능.
      //   planCapabilities("starter").autoRefreshHours=168(주간)이 단일 진실.
      //   ⚠️ "리포트"(메일)와 다르다 — 메일은 FINDABLE_ENABLE_DIGEST_EMAIL 꺼짐.
      "주간 자동 재측정",
      { label: "주간 자동 리포트", ready: false },
      { label: "이메일 알림", ready: false },
      "Free Audit 모든 기능",
    ],
    cta: "Starter 시작하기",
    href: "/ko/contact",
  },
  {
    plan: "growth",
    name: "Growth",
    price: "₩390,000",
    period: "월",
    chargedKrw: chargedFor("growth"),
    desc: "성장 중인 D2C·SMB를 위한 추천 플랜.",
    features: [
      {
        label: "월 150개 질문 추적",
        hint: "고객이 AI에 물어볼 질문 150개를 우리가 대신 물어보고 결과를 쌓아요",
      },
      "5개 브랜드 측정",
      // ⭐ Growth 도 매일(24h) 돈다 — Scale 전용처럼 숨어 있던 차별점(2026-08-10).
      "매일 자동 재측정",
      {
        label: "한국어 표기 통합 추적",
        // 예시는 **저장소의 실제 사용례**를 쓴다(`packages/ai/lib/engines/index.ts:88`
        // 의 `brandVariants: ["Medicube", "메디큐브"]`). 지어낸 예시를 쓰지 않는다.
        hint: "‘메디큐브·Medicube’처럼 흩어진 표기를 한 브랜드로 묶어서 세요",
      },
      {
        label: "먼저 할 일 3가지 추천",
        hint: "측정 결과를 근거로 지금 무엇부터 고치면 되는지 순서를 정해드려요",
      },
      { label: "Notion · Google Docs Export", ready: false },
      "Starter 모든 기능",
    ],
    cta: "Growth 시작하기",
    href: "/ko/contact",
    featured: true,
  },
  {
    // 🔴 2026-08-11 추가 — **표에만 없었다**(세션N-18).
    //   web 요금제(`apps/web/.../pricing/page.tsx`)의 "Scale 시작하기" CTA 가 `/billing` 로
    //   보내는데 정작 이 표에 Scale 이 없어서 **결제 화면에 도착해도 살 수가 없었다**.
    //   카탈로그·권한위계엔 처음부터 있었다(`PAYABLE_PLANS` · `PLAN_RANK.scale=3` ·
    //   `PAYMENT_CATALOG` 990,000/1,089,000) → 배열에 한 칸이 빠진 것뿐이라 로직 변경 0.
    //   ⚠️ 기능 문구는 web 표와 **같은 사실**을 쓴다(둘이 갈리면 그게 표시광고 문제가 된다).
    plan: "scale",
    name: "Scale",
    price: "₩990,000",
    period: "월",
    chargedKrw: chargedFor("scale"),
    desc: "중견 D2C·미드마켓을 위한 대규모 추적 플랜.",
    features: [
      {
        label: "월 500개 질문 추적",
        hint: "고객이 AI에 물어볼 질문 500개를 우리가 대신 물어보고 결과를 쌓아요",
      },
      "무제한 브랜드 측정",
      // ⚠️ "일간 자동 재측정"을 넣지 않는다 — Growth 와 주기가 **동일**(24h)해서
      //   Scale 전용처럼 적으면 오표기다(web 표와 같은 판단). "Growth 모든 기능"에 포함된다.
      {
        label: "API 연동",
        hint: "측정 결과를 우리 회사 시스템으로 바로 가져갈 수 있어요",
      },
      "Growth 모든 기능",
    ],
    cta: "Scale 시작하기",
    href: "/ko/contact",
  },
  {
    plan: "enterprise",
    name: "Enterprise",
    price: "맞춤",
    // 🔴 S7-a(2026-08-11) — 예전 표기 `연 ₩30M~`. 이 자리는 다른 카드가 전부 **"월"**
    //   을 쓰는 슬롯이라 단위가 바뀐 걸 못 보고 **월 3천만원으로 읽힐** 수 있었다.
    //   게다가 `30M` 은 영어 축약이라 한국어 화면에서 한 번 더 걸린다(NN/g 2).
    //   → 단위를 앞에 두고 숫자를 한국어로 적는다.
    period: "연 3,000만원~",
    desc: "대기업·금융·F500 한국 지사 맞춤 플랜.",
    features: [
      {
        label: "질문·브랜드 무제한",
        hint: "추적할 질문 수와 브랜드 수에 제한이 없어요",
      },
      "전담 GEO 매니저",
      "SSO · SAML",
      // 🐛 라이브 스크린샷에서 잡음(2026-08-11): Scale 은 "API 연동"으로 고쳤는데
      //   Enterprise 만 `API 액세스` 로 남아 **같은 화면에서 같은 기능을 두 이름으로**
      //   부르고 있었다(NN/g 4 일관성). 문구를 Scale 과 통일한다.
      {
        label: "API 연동",
        hint: "측정 결과를 우리 회사 시스템으로 바로 가져갈 수 있어요",
      },
      "맞춤 SLA",
      "Growth 모든 기능",
    ],
    cta: "상담 예약",
    href: "/ko/contact",
  },
];
