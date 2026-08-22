import { PLAN_META } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { cn } from "@repo/design-system/lib/utils";
import { CheckIcon, ClockIcon } from "lucide-react";
import type { Metadata } from "next";
import { redeemInviteCode } from "@/app/actions/invite/redeem";
import { env } from "@/env";
import { Header } from "../components/header";
import { PlanBadge } from "../components/plan-badge";
import { CancelSubscription } from "../features/billing/cancel-subscription";
import { SubscribeButton } from "../features/billing/subscribe-button";
import { UpgradeButton } from "../features/billing/upgrade-button";
import { RedeemForm } from "../features/invite/redeem-form";
import { listFor, PRICING_TIERS, type PricingFeature } from "../lib/pricing";

// 앱 내 카드결제 가능한 plan(서버 카탈로그와 동일 어휘). enterprise 는 영업 계약.
const PAYABLE_PLANS = new Set(["starter", "growth", "scale"]);

/**
 * tier CTA — 결제 가능 플랜은 **정기결제(월 자동결제)를 기본**으로 제안하고,
 * 자동결제를 원하지 않는 고객을 위해 **1회 결제**를 함께 둔다.
 *
 * 🔴 왜 정기결제가 기본인가(2026-08-11 세션N-18):
 *   화면·결제창이 "월 구독"이라고 말하는데 실제로는 단건 1회 결제였다(표시≠실제).
 *   정기결제를 실제로 붙여 그 간극을 없앴다. 1회 결제는 선택지로 남긴다
 *   (자동결제를 꺼리는 고객이 있고, 이미 작동하던 동선을 없앨 이유가 없다).
 */
const TierCta = ({
  tier,
  webUrl,
}: {
  tier: (typeof PRICING_TIERS)[number];
  webUrl: string;
}) => {
  if (!(tier.plan && PAYABLE_PLANS.has(tier.plan))) {
    return (
      <a
        className={cn(
          "inline-flex items-center justify-center rounded-md px-4 py-2 font-medium text-sm transition-colors",
          tier.featured
            ? "findable-btn-primary"
            : "border border-[color:var(--findable-hairline-strong,#34343a)] text-[color:var(--findable-ink,#f7f8f8)] hover:bg-[color:var(--findable-surface-2,#141516)]"
        )}
        href={`${webUrl}${tier.href}`}
      >
        {tier.cta}
      </a>
    );
  }

  const plan = tier.plan as "starter" | "growth" | "scale";
  const charged = tier.chargedKrw;
  const list = listFor(plan);

  return (
    <div className="flex flex-col gap-2">
      {charged !== undefined && list !== undefined && (
        <SubscribeButton
          chargedPrice={charged}
          contactHref={`${webUrl}/ko/contact`}
          featured={tier.featured}
          label={`${tier.name} 월 자동결제 시작`}
          listPrice={list}
          plan={plan}
        />
      )}
      <UpgradeButton
        contactHref={`${webUrl}/ko/contact`}
        label="1회만 결제하기"
        plan={plan}
      />
    </div>
  );
};

/**
 * 기능 한 줄.
 *
 * S4(2026-08-11) — 기능 줄에 **부연 한 줄**을 붙일 수 있게 했다. 진단 §원인④:
 *   Growth 의 핵심 차별점이 내부 용어(`Korean Entity Grounding`·`프롬프트`)로만 적혀
 *   **무슨 이득인지 화면에 없었다**. 문자열이면 그대로, `{label, hint}` 면 아래 회색 한 줄.
 *
 * 🔴 S6-c#2(2026-08-11) — 아직 없는 기능은 **체크로 그리지 않는다**. 체크(✓)는 "제공됨"으로
 *   읽히는데 `(준비 중)` 항목까지 완성 기능과 **똑같은 주황 체크**를 달고 있었다
 *   = 돈 내는 화면에서 없는 것을 있다고 표시한 셈(설계 v3 원인②).
 *   → **아이콘·색·문구 세 가지로** 구분한다(색맹·흑백 인쇄에서도 구분되도록).
 */
const FeatureRow = ({ feature }: { feature: PricingFeature }) => {
  const isString = typeof feature === "string";
  const label = isString ? feature : feature.label;
  const hint = isString ? null : feature.hint;
  const isReady = isString ? true : feature.ready !== false;

  return (
    <li
      className={cn(
        "flex items-start gap-2 text-sm",
        isReady
          ? "text-[color:var(--findable-ink-muted,#d0d6e0)]"
          : "text-[color:var(--findable-ink-subtle,#8a8f98)]"
      )}
    >
      {isReady ? (
        <CheckIcon className="mt-0.5 size-4 shrink-0 text-[color:var(--findable-primary,#ff7a4d)]" />
      ) : (
        <ClockIcon className="mt-0.5 size-4 shrink-0 text-[color:var(--findable-ink-tertiary,#7e8289)]" />
      )}
      <span>
        {label}
        {isReady ? null : (
          <span className="ml-1 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
            (준비 중)
          </span>
        )}
        {hint ? (
          <span className="mt-0.5 block text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
            {hint}
          </span>
        ) : null}
      </span>
    </li>
  );
};

export const metadata: Metadata = {
  title: "요금제·업그레이드 · Findable",
  description: "현재 플랜과 업그레이드 옵션을 확인하세요.",
};

const BillingPage = async () => {
  const plan = await getCurrentPlan();
  const webUrl = env.NEXT_PUBLIC_WEB_URL;
  const meta = PLAN_META[plan];

  // ⚖️ 정기결제 중이면 **해지 수단을 화면에 노출**해야 한다(전자상거래법 제5조 제4항).
  //   빌링키가 저장돼 있고 provider 가 portone 일 때만 = 실제로 해지할 대상이 있을 때만 띄운다.
  const { orgId } = await auth();
  const org = orgId
    ? await database.organization.findUnique({
        where: { id: orgId },
        select: { billingCustomerId: true, billingProvider: true },
      })
    : null;
  const hasSubscription = Boolean(
    org?.billingCustomerId && org.billingProvider === "portone"
  );

  return (
    <>
      <Header page="요금제·업그레이드" pages={["Findable"]} />
      <div className="flex flex-1 flex-col gap-8 p-6 pt-2">
        {/* 🔴 초대 코드 — 결제와 **다른 축**이다(프로그램 참가 기업용).
            요금제 카드보다 **위**에 둔다: 코드를 받은 사람은 결제할 이유가 없는데
            가격표를 먼저 지나가게 하면 "돈 내야 하나"로 읽힌다. */}
        <RedeemForm onRedeem={redeemInviteCode} />

        {/* 현재 플랜 요약 */}
        <section className="findable-card flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
                현재 플랜
              </span>
              <PlanBadge plan={plan} />
            </div>
            <p className="max-w-xl text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm">
              {meta.blurb}
            </p>
            {hasSubscription && (
              <div className="mt-1 flex flex-col gap-2">
                <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                  매월 자동결제가 켜져 있어요.
                </p>
                <CancelSubscription />
              </div>
            )}
          </div>
          {plan === "free" && (
            <a
              className="findable-btn-primary inline-flex items-center rounded-md px-5 py-2.5 font-medium text-sm"
              href={`${webUrl}/ko/contact`}
            >
              업그레이드 상담
            </a>
          )}
        </section>

        {/* 요금제 비교 */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg">
              플랜 비교
            </h2>
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              브랜드 규모에 맞는 플랜을 선택하세요. 카드 결제로 즉시 시작하거나,
              상담으로 진행할 수 있어요.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {PRICING_TIERS.map((tier) => {
              const isCurrent = tier.plan === plan;
              return (
                <div
                  className={cn(
                    "flex flex-col gap-4 p-5",
                    tier.featured ? "findable-card-accent" : "findable-card"
                  )}
                  key={tier.name}
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[color:var(--findable-ink,#f7f8f8)]">
                        {tier.name}
                      </span>
                      {/* 🔴 세션N-26 — 예전엔 `isCurrent && !tier.featured` 라서
                          **추천 플랜을 쓰는 고객은 「현재」를 영영 못 봤다**(배지 슬롯을
                          「추천」이 차지). 내가 어느 플랜인지는 **나에 대한 사실**이고
                          「추천」은 누구에게나 같은 마케팅 문구다 → 사실이 슬롯을 이긴다.
                          ⚠️ 배지는 한 칸이다. 둘 다 띄우면 줄이 밀린다. */}
                      {isCurrent && (
                        <span className="rounded-full bg-[color:var(--findable-surface-3,#18191a)] px-2 py-0.5 font-medium text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                          현재
                        </span>
                      )}
                      {tier.featured && !isCurrent && (
                        <span className="rounded-full bg-[color:var(--findable-primary,#ff7a4d)]/12 px-2 py-0.5 font-medium text-[color:var(--findable-primary,#ff7a4d)] text-xs">
                          추천
                        </span>
                      )}
                    </div>
                    <div className="flex items-end gap-1">
                      <span className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
                        {tier.price}
                      </span>
                      <span className="pb-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                        {tier.period}
                      </span>
                    </div>
                    {/* 실제 결제 금액을 결제창 전에 알린다. 여기는 로그인 후 화면이라
                        www 와 달리 "얼마 빠져나가는지" 를 숫자로 못박는 게 맞다.
                        금액은 카탈로그(단일 진실)에서 온다 — 화면에서 계산하면
                        표시가와 청구가가 갈린다. */}
                    {tier.chargedKrw === undefined ? (
                      // 🔴 S7-a(2026-08-11) — **Enterprise 만 세금 안내가 없었다.**
                      //   조건이 `chargedKrw !== undefined` 라서, 카드결제가 아닌 상담 플랜
                      //   (연 3천만원~)에는 부가세 문구가 **한 줄도 안 나갔다**. 3천만원이면
                      //   VAT 가 300만원이고, 그게 계약 단계에서 처음 등장하면 그게 분쟁이다.
                      //   ⚠️ 무료(₩0)에는 붙이지 않는다 — 낼 돈이 없는데 세금 안내는 잡음이다.
                      tier.plan !== "free" && (
                        <p className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                          VAT 별도 · 금액은 상담에서 확정해요
                        </p>
                      )
                    ) : (
                      <p className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                        VAT 별도 · 결제 금액 ₩
                        {tier.chargedKrw.toLocaleString("ko-KR")}
                      </p>
                    )}
                    <p className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
                      {tier.desc}
                    </p>
                  </div>

                  {/* S4(2026-08-11) — 기능 줄에 **부연 한 줄**을 붙일 수 있게 했다.
                      진단 §원인④: Growth 의 핵심 차별점이 내부 용어(`Korean Entity
                      Grounding`·`프롬프트`)로만 적혀 **무슨 이득인지 화면에 없었다**.
                      문자열이면 그대로, `{label, hint}` 면 아래에 회색 한 줄. */}
                  <ul className="flex flex-1 flex-col gap-2">
                    {tier.features.map((feature) => (
                      <FeatureRow
                        feature={feature}
                        key={
                          typeof feature === "string" ? feature : feature.label
                        }
                      />
                    ))}
                  </ul>

                  {isCurrent ? (
                    <span className="inline-flex items-center justify-center rounded-md border border-[color:var(--findable-hairline,#23252a)] px-4 py-2 font-medium text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
                      이용 중
                    </span>
                  ) : (
                    <TierCta tier={tier} webUrl={webUrl} />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
};

export default BillingPage;
