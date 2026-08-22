"use client";

import { requestPayment } from "@portone/browser-sdk/v2";
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
  createCheckoutIntent,
  verifyPaymentAndGrant,
} from "@/app/actions/billing/checkout";

/**
 * 앱 내 업그레이드 결제 버튼 (결제→plan 자동화, 2026-07-30).
 * 서버액션이 paymentId·금액을 확정 → PortOne 위젯(토스) → 서버 검증+grantPlan.
 * PortOne env 미설정이면 상담 링크로 폴백(안 죽음).
 *
 * ⚠️ @repo/payments index 는 server-only 라 여기선 타입만 로컬 정의.
 */

type PayablePlan = "starter" | "growth" | "scale";

const STORE_ID = process.env.NEXT_PUBLIC_PORTONE_STORE_ID ?? "";
const CHANNEL_KEY = process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY ?? "";

export const UpgradeButton = ({
  plan,
  label,
  featured,
  contactHref,
}: {
  plan: PayablePlan;
  label: string;
  featured?: boolean;
  contactHref: string;
}) => {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const className = cn(
    "inline-flex w-full items-center justify-center rounded-md px-4 py-2 font-medium text-sm transition-colors",
    featured
      ? "findable-btn-primary"
      : "border border-[color:var(--findable-hairline-strong,#34343a)] text-[color:var(--findable-ink,#f7f8f8)] hover:bg-[color:var(--findable-surface-2,#141516)]"
  );

  // 위젯 키 미설정 배포에선 기존 상담 동선 유지(기능 저하일 뿐 죽지 않게).
  if (!(STORE_ID && CHANNEL_KEY)) {
    return (
      <a className={className} href={contactHref}>
        {label}
      </a>
    );
  }

  const pay = async () => {
    setIsPending(true);
    // 🔬 BL-Day17-04(2026-08-12) — 결제 시도의 **결과를 단계로 구분**해 센다.
    //   예전엔 이 흐름 전체가 무계측이라 "몇 명이 눌렀고 몇 명이 성공했나"조차 몰랐다.
    //   ⭐ 특히 `stage:"widget"` (결제창까지 갔다가 닫음)이 지불의사의 강한 신호다.
    trackCheckoutStarted({ plan });
    try {
      const intent = await createCheckoutIntent(plan);
      if ("error" in intent) {
        // 우리 서버가 결제 정보를 못 만든 경우 = 우리 잘못. 고객 이탈과 섞지 않는다.
        trackCheckoutFailed({ plan, stage: "intent" });
        toast.error(intent.error);
        return;
      }

      const response = await requestPayment({
        storeId: STORE_ID,
        channelKey: CHANNEL_KEY,
        paymentId: intent.paymentId,
        orderName: intent.orderName,
        totalAmount: intent.amount,
        currency: "CURRENCY_KRW",
        payMethod: "CARD",
        customer: {
          fullName: intent.customerName,
          email: intent.customerEmail,
        },
        redirectUrl: `${window.location.origin}/billing`,
      });

      if (response?.code) {
        // 결제창이 취소·실패로 닫힘. ⚠️ 코드를 **그대로** 보낸다 — "이건 고객 취소"라는
        //   매핑을 발명하지 않는다(PortOne 타입에 코드 목록이 없음. 분포를 보고 나중에).
        trackCheckoutFailed({
          plan,
          stage: "widget",
          amountKrw: intent.amount,
          reasonCode: response.code,
        });
        toast.error(`결제 실패: ${response.message ?? response.code}`);
        return;
      }

      const verified = await verifyPaymentAndGrant(intent.paymentId);
      if ("error" in verified) {
        // 🔴 가장 위험한 경우 — 돈은 나갔는데 플랜이 안 붙었을 수 있다.
        trackCheckoutFailed({
          plan,
          stage: "verify",
          amountKrw: intent.amount,
        });
        toast.error(verified.error);
        return;
      }
      if (!verified.granted) {
        trackCheckoutFailed({
          plan,
          stage: "verify",
          amountKrw: intent.amount,
          reasonCode: "not_granted",
        });
        toast.warning(
          "결제는 완료됐지만 플랜 반영이 지연되고 있어요. 잠시 후 새로고침해 주세요."
        );
        return;
      }
      // 결제 성공 **그리고** 플랜 부여 성공 — 둘 다 된 경우만 완료로 센다.
      trackCheckoutCompleted({ plan, amountKrw: intent.amount });
      toast.success(`${verified.plan} 플랜이 활성화됐어요!`);
      router.refresh();
    } catch (error) {
      trackCheckoutFailed({ plan, stage: "widget", reasonCode: "exception" });
      toast.error(
        `결제 처리 중 오류: ${error instanceof Error ? error.message : "알 수 없음"}`
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Button
      className={className}
      disabled={isPending}
      onClick={pay}
      type="button"
      variant="ghost"
    >
      {isPending ? "결제 진행 중…" : label}
    </Button>
  );
};
