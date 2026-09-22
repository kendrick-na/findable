"use client";

import { requestIssueBillingKey } from "@portone/browser-sdk/v2";
import { useUser } from "@repo/auth/client";
import {
  trackCheckoutCompleted,
  trackCheckoutFailed,
  trackCheckoutStarted,
} from "@repo/analytics/funnel";
import { Button } from "@repo/design-system/components/ui/button";
import { toast } from "@repo/design-system/components/ui/sonner";
import { cn } from "@repo/design-system/lib/utils";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  confirmSubscription,
  createSubscribeIntent,
} from "@/app/actions/billing/subscription";
import { kakaoBillingKeyDisplayAmount } from "@/lib/billing/kakao-billing-key";
import { describeSubscriptionError } from "@/lib/billing/subscription-error";

/**
 * 정기결제(월 자동결제) 등록 버튼 — 2026-08-11 세션N-18.
 *
 * 단건 `UpgradeButton` 과 다른 점:
 *   - `requestPayment`(1회 결제) 가 아니라 **`requestIssueBillingKey`**(결제수단 등록).
 *   - 발급 성공 후 서버가 **첫 회를 즉시 청구**한다(발급만 하고 끝나면 미청구 구독이 된다).
 *   - ⚖️ 결제 전 **사전 고지 + 동의**를 반드시 거친다(전자상거래법).
 *
 * ⚠️ 카카오페이는 `issueName` 이 **필수**다(빌링키 발급창 제목). 공식 문서 확인.
 * ⚠️ 채널키가 단건과 **다르다**(정기결제 전용 채널). 서버 intent 가 내려준 값만 쓴다.
 */

type PayablePlan = "starter" | "growth" | "scale";

const STORE_ID = process.env.NEXT_PUBLIC_PORTONE_STORE_ID ?? "";
const BILLING_CHANNEL_KEY =
  process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_BILLING ?? "";

const won = (n: number) => `₩${n.toLocaleString("ko-KR")}`;

export const SubscribeButton = ({
  plan,
  label,
  listPrice,
  chargedPrice,
  featured,
  contactHref,
}: {
  chargedPrice: number;
  contactHref: string;
  featured?: boolean;
  label: string;
  listPrice: number;
  plan: PayablePlan;
}) => {
  const router = useRouter();
  const { user } = useUser();
  const [isPending, setIsPending] = useState(false);
  // ⚖️ 사전 고지 단계. 버튼을 누르면 곧바로 결제창을 띄우지 않고 고지부터 보여준다.
  const [isNoticeOpen, setNoticeOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const className = cn(
    "inline-flex w-full items-center justify-center rounded-md px-4 py-2 font-medium text-sm transition-colors",
    featured
      ? "findable-btn-primary"
      : "border border-[color:var(--findable-hairline-strong,#34343a)] text-[color:var(--findable-ink,#f7f8f8)] hover:bg-[color:var(--findable-surface-2,#141516)]"
  );

  // 키 미설정 배포에선 상담 동선으로 폴백(화면이 죽지 않게).
  if (!(STORE_ID && BILLING_CHANNEL_KEY)) {
    return (
      <a className={className} href={contactHref}>
        {label}
      </a>
    );
  }

  const subscribe = async () => {
    setIsPending(true);
    // 🔬 BL-Day17-04(2026-08-12) — 단건(`upgrade-button`)과 **같은 이벤트 이름**을 쓴다.
    //   정기/단건을 다른 이름으로 세면 "결제 시도 총수"를 물을 때 두 곳을 더해야 하고,
    //   그때 한쪽을 빠뜨린다. 구분은 `isSubscription` 속성으로 한다.
    trackCheckoutStarted({ plan, isSubscription: true });
    try {
      const intent = await createSubscribeIntent(plan);
      if ("error" in intent) {
        trackCheckoutFailed({ plan, stage: "intent", isSubscription: true });
        toast.error(intent.error);
        return;
      }

      const issued = await requestIssueBillingKey({
        storeId: STORE_ID,
        channelKey: intent.billingChannelKey,
        billingKeyMethod: "EASY_PAY",
        // 카카오페이는 빌링키 발급 주문에도 금액이 필요하다. PortOne V2에서
        // displayAmount는 발급 UI 표시용이므로 실제 초회 청구는 아래 서버 확인 단계가 맡는다.
        ...kakaoBillingKeyDisplayAmount(intent.amount),
        issueId: intent.issueId,
        issueName: intent.issueName,
        customer: {
          fullName: intent.customerName,
          email: intent.customerEmail,
        },
        redirectUrl: `${window.location.origin}/billing`,
      });

      if (!issued || issued.code) {
        // 사용자가 창을 닫은 경우도 여기로 온다 — 에러 토스트를 과하게 띄우지 않는다.
        // ⭐ 다만 **집계에서는 둘을 구분**한다: 창을 그냥 닫은 것(`window_closed`)과
        //   PG 가 코드를 준 실패는 지불의사 해석이 완전히 다르다.
        //   (화면은 조용히 넘어가도 숫자는 알아야 한다.)
        trackCheckoutFailed({
          plan,
          stage: "widget",
          isSubscription: true,
          reasonCode: issued?.code ?? "window_closed",
        });
        if (issued?.code) {
          toast.error(issued.message ?? "결제수단 등록이 취소되었습니다.");
        }
        return;
      }

      const result = await confirmSubscription(plan, issued.billingKey);
      if ("error" in result) {
        trackCheckoutFailed({ plan, stage: "verify", isSubscription: true });
        toast.error(result.error);
        return;
      }

      // 🔴 `granted` 가 false 면 "결제는 됐는데 권한이 안 붙은" 상태다 — 성공으로 세지 않는다.
      //   (단건 흐름의 `not_granted` 와 같은 판정. 두 흐름이 같은 규칙을 쓴다.)
      if (result.granted) {
        trackCheckoutCompleted({ plan, isSubscription: true });
      } else {
        trackCheckoutFailed({
          plan,
          stage: "verify",
          isSubscription: true,
          reasonCode: "not_granted",
        });
      }

      toast.success(
        result.granted && result.renewalScheduled
          ? "정기결제가 시작되었어요."
          : result.granted
            ? "첫 결제는 완료됐어요. 다음 결제 예약을 확인 중이니 잠시 후 다시 확인해 주세요."
            : "결제는 완료됐어요. 권한 반영이 지연되면 새로고침해 주세요."
      );
      setNoticeOpen(false);
      // 결제 서버가 갱신한 publicMetadata를 현재 세션에도 반영한 뒤 화면을 다시 그린다.
      await user?.reload();
      router.refresh();
    } catch (error) {
      trackCheckoutFailed({
        plan,
        stage: "widget",
        isSubscription: true,
        reasonCode: "exception",
      });
      // SDK/채널 설정 문제를 일반 문구로 덮으면 안전한 수정이 불가능하다.
      // 코드·메시지만 표시하고 billingKey 등 예외 객체 전체는 노출하지 않는다.
      toast.error(`정기결제 등록 실패: ${describeSubscriptionError(error)}`);
    } finally {
      setIsPending(false);
    }
  };

  if (!isNoticeOpen) {
    return (
      <button
        className={className}
        onClick={() => setNoticeOpen(true)}
        type="button"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-[color:var(--findable-hairline-strong,#34343a)] bg-[color:var(--findable-surface-1,#0f1011)] p-4">
      {/* ⚖️ 전자상거래법 — 정기결제는 결제 전에 금액·주기·차기 결제일·해지 방법을
          고지하고 동의를 받아야 한다. 화면에 실제로 보이게 둔다(약관 링크 뒤로 숨기지 않는다). */}
      <p className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
        정기결제 안내
      </p>
      <dl className="flex flex-col gap-1.5 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
            상품
          </dt>
          <dd className="text-[color:var(--findable-ink-muted,#d0d6e0)]">
            Findable {plan} 월 정기결제
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
            결제 금액
          </dt>
          <dd className="text-[color:var(--findable-ink,#f7f8f8)]">
            {won(chargedPrice)}{" "}
            <span className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
              (VAT 포함 · 표시가 {won(listPrice)})
            </span>
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
            결제 주기
          </dt>
          <dd className="text-[color:var(--findable-ink-muted,#d0d6e0)]">
            매월 1회 자동결제
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
            차기 결제일
          </dt>
          <dd className="text-[color:var(--findable-ink-muted,#d0d6e0)]">
            등록일로부터 1개월 후 같은 날
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
            해지 방법
          </dt>
          <dd className="text-[color:var(--findable-ink-muted,#d0d6e0)]">
            요금제 화면에서 언제든 직접 해지
          </dd>
        </div>
      </dl>

      <label className="flex cursor-pointer items-start gap-2 text-[color:var(--findable-ink-muted,#d0d6e0)] text-xs">
        <input
          checked={agreed}
          className="mt-0.5"
          onChange={(e) => setAgreed(e.target.checked)}
          type="checkbox"
        />
        <span>
          위 내용을 확인했으며, 매월 자동으로 결제되는 것에 동의합니다.
        </span>
      </label>

      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={!agreed || isPending}
          onClick={subscribe}
          size="sm"
        >
          {isPending ? "처리 중…" : "동의하고 정기결제 시작"}
        </Button>
        <Button
          disabled={isPending}
          onClick={() => setNoticeOpen(false)}
          size="sm"
          variant="ghost"
        >
          취소
        </Button>
      </div>
    </div>
  );
};
