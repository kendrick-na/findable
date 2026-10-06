import type { Plan } from "@repo/auth/plan";
import {
  amountForPlan,
  listPriceForPlan,
  type PayablePlan,
} from "@repo/payments/catalog";
import type { AppDictionary, AppLocale } from "@/lib/i18n";

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

/**
 * 요금제 카드 — 문구는 사전(`app.pricing`), 금액은 카탈로그·고정 표기 그대로(2026-10-06).
 * 🔴 금액(₩)·플랜 이름은 번역하지 않는다 — 👤 D2: 통화·부가세 정책은 그대로, 표기만 언어를 따른다.
 * ⚠️ 웹 링크(`href`)는 로케일 접두사를 따른다(ko → `/ko/…`, en → 접두사 없음).
 */
export const pricingTiers = (
  t: AppDictionary["pricing"],
  locale: AppLocale
): PricingTier[] => {
  const lp = locale === "ko" ? "/ko" : "";
  return [
    {
      plan: "free",
      name: "Free Audit",
      price: "₩0",
      period: t.freePeriod,
      desc: t.freeDesc,
      features: [t.freeF1, t.freeF2, t.freeF3, t.freeF4],
      cta: t.freeCta,
      href: `${lp}/audit`,
    },
    {
      plan: "starter",
      name: "Starter",
      price: "₩99,000",
      period: t.monthly,
      chargedKrw: chargedFor("starter"),
      desc: t.starterDesc,
      features: [
        {
          label: t.prompts30,
          hint: t.prompts30Hint,
        },
        // 🔴 2026-08-15 — `1개` → `3개`. `planCapabilities("starter").brandLimit = 3`
        //   (`packages/auth/plan.ts:121`)인데 화면은 1개라고 고지했다.
        //   = **돈 낸 고객에게 권리를 축소 고지**한 것(반대 방향 결함보다 드물지만 같은 부정직).
        t.brands3,
        // ⭐ web pricing 과 동일 사실(2026-08-10) — 이미 작동하는데 표에 없던 기능.
        //   planCapabilities("starter").autoRefreshHours=168(주간)이 단일 진실.
        //   ⚠️ "리포트"(메일)와 다르다 — 메일은 FINDABLE_ENABLE_DIGEST_EMAIL 꺼짐.
        t.weeklyRefresh,
        { label: t.weeklyReport, ready: false },
        { label: t.emailAlerts, ready: false },
        t.allFree,
      ],
      cta: t.starterCta,
      href: `${lp}/contact`,
    },
    {
      plan: "growth",
      name: "Growth",
      price: "₩390,000",
      period: t.monthly,
      chargedKrw: chargedFor("growth"),
      desc: t.growthDesc,
      features: [
        {
          label: t.prompts150,
          hint: t.prompts150Hint,
        },
        t.brands5,
        // ⭐ Growth 도 매일(24h) 돈다 — Scale 전용처럼 숨어 있던 차별점(2026-08-10).
        t.dailyRefresh,
        {
          label: t.variants,
          // 예시는 **저장소의 실제 사용례**를 쓴다(`packages/ai/lib/engines/index.ts:88`
          // 의 `brandVariants: ["Medicube", "메디큐브"]`). 지어낸 예시를 쓰지 않는다.
          hint: t.variantsHint,
        },
        {
          label: t.top3,
          hint: t.top3Hint,
        },
        { label: t.export, ready: false },
        t.allStarter,
      ],
      cta: t.growthCta,
      href: `${lp}/contact`,
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
      period: t.monthly,
      chargedKrw: chargedFor("scale"),
      desc: t.scaleDesc,
      features: [
        {
          label: t.prompts500,
          hint: t.prompts500Hint,
        },
        t.brandsUnlimited,
        // ⚠️ "일간 자동 재측정"을 넣지 않는다 — Growth 와 주기가 **동일**(24h)해서
        //   Scale 전용처럼 적으면 오표기다(web 표와 같은 판단). "Growth 모든 기능"에 포함된다.
        {
          label: t.api,
          hint: t.apiHint,
        },
        t.allGrowth,
      ],
      cta: t.scaleCta,
      href: `${lp}/contact`,
    },
    {
      plan: "enterprise",
      name: "Enterprise",
      price: t.enterprisePrice,
      // 🔴 S7-a(2026-08-11) — 예전 표기 `연 ₩30M~`. 이 자리는 다른 카드가 전부 **"월"**
      //   을 쓰는 슬롯이라 단위가 바뀐 걸 못 보고 **월 3천만원으로 읽힐** 수 있었다.
      //   게다가 `30M` 은 영어 축약이라 한국어 화면에서 한 번 더 걸린다(NN/g 2).
      //   → 단위를 앞에 두고 숫자를 한국어로 적는다.
      period: t.enterprisePeriod,
      desc: t.enterpriseDesc,
      features: [
        {
          label: t.unlimited,
          hint: t.unlimitedHint,
        },
        t.manager,
        t.sso,
        // 🐛 라이브 스크린샷에서 잡음(2026-08-11): Scale 은 "API 연동"으로 고쳤는데
        //   Enterprise 만 `API 액세스` 로 남아 **같은 화면에서 같은 기능을 두 이름으로**
        //   부르고 있었다(NN/g 4 일관성). 문구를 Scale 과 통일한다.
        {
          label: t.api,
          hint: t.apiHint,
        },
        t.sla,
        t.allGrowth,
      ],
      cta: t.enterpriseCta,
      href: `${lp}/contact`,
    },
  ];
};
