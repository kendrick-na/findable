"use client";

/**
 * /checkout — 포트원 V2 결제 위젯 데모 페이지
 *
 * 평가위원/사용자가 가격제(Starter·Growth·Scale) 선택 → 결제 버튼 → 토스페이먼츠 위젯 → 결제 완료
 *
 * 사용 키:
 *   NEXT_PUBLIC_PORTONE_STORE_ID
 *   NEXT_PUBLIC_PORTONE_CHANNEL_KEY
 */
import * as PortOne from "@portone/browser-sdk/v2";
import { useState } from "react";

const STORE_ID = process.env.NEXT_PUBLIC_PORTONE_STORE_ID ?? "";
const CHANNEL_KEY = process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY ?? "";

type Plan = {
  id: string;
  name: string;
  price: number;
  desc: string;
};

const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    price: 99_000,
    desc: "1인 창업자·개인 브랜드 · 추적 질문 30개",
  },
  {
    id: "growth",
    name: "Growth",
    price: 390_000,
    desc: "스타트업·SMB · 추적 질문 150개 · 5 브랜드",
  },
  {
    id: "scale",
    name: "Scale",
    price: 990_000,
    desc: "중견 D2C·미드마켓 · 추적 질문 500개 · 무제한",
  },
];

export default function CheckoutPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePay = async (plan: Plan) => {
    if (!STORE_ID || !CHANNEL_KEY) {
      setError(
        "PortOne 환경변수가 설정되지 않았습니다. .env.local 확인 후 dev 서버 재시작."
      );
      return;
    }

    setLoading(plan.id);
    setError(null);

    const paymentId = `findable-${plan.id}-${Date.now()}`;

    try {
      const response = await PortOne.requestPayment({
        storeId: STORE_ID,
        channelKey: CHANNEL_KEY,
        paymentId,
        orderName: `Findable ${plan.name} 월 구독`,
        totalAmount: plan.price,
        currency: "CURRENCY_KRW",
        payMethod: "CARD",
        customer: {
          fullName: "테스트 결제",
          email: "test@findable.co.kr",
        },
        redirectUrl: `${window.location.origin}/ko/checkout/success`,
      });

      if (response?.code) {
        setError(`결제 실패: ${response.message ?? response.code}`);
        setLoading(null);
        return;
      }

      // 서버 검증
      const verifyRes = await fetch("/api/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId,
          expectedAmount: plan.price,
        }),
      });

      const verifyData = await verifyRes.json();

      if (!verifyRes.ok || !verifyData.ok) {
        setError(`서버 검증 실패: ${verifyData.message ?? "unknown"}`);
        setLoading(null);
        return;
      }

      // 성공 페이지로 이동
      window.location.href = `/ko/checkout/success?paymentId=${encodeURIComponent(
        paymentId
      )}`;
    } catch (e) {
      setError(`결제 처리 중 오류: ${e instanceof Error ? e.message : String(e)}`);
      setLoading(null);
    }
  };

  const configured = Boolean(STORE_ID && CHANNEL_KEY);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-6 py-16">
      <div className="max-w-4xl mx-auto">
        <header className="mb-12 text-center">
          <h1 className="text-3xl font-semibold mb-3">Findable 구독 결제</h1>
          <p className="text-zinc-400 text-sm">
            포트원 V2 + 토스페이먼츠 테스트 채널 · 5가지 결제수단 지원
          </p>
          {!configured && (
            <p className="mt-3 text-amber-400 text-xs">
              ⚠️ 포트원 환경변수 미설정. .env.local 확인 필요.
            </p>
          )}
        </header>

        <div className="grid md:grid-cols-3 gap-4 mb-8">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-6"
            >
              <div className="text-orange-400 text-xs uppercase tracking-wider font-semibold mb-2">
                {plan.name}
              </div>
              <div className="text-2xl font-bold mb-1">
                {plan.price.toLocaleString()}원
              </div>
              <div className="text-zinc-500 text-xs mb-4">월 구독 (VAT 별도)</div>
              <p className="text-sm text-zinc-300 mb-6 leading-relaxed">
                {plan.desc}
              </p>
              <button
                onClick={() => handlePay(plan)}
                disabled={loading !== null || !configured}
                className="w-full bg-orange-500 hover:bg-orange-400 disabled:bg-zinc-700 disabled:text-zinc-400 text-zinc-900 font-semibold py-3 rounded-lg transition-colors"
              >
                {loading === plan.id ? "결제 진행 중..." : "결제하기"}
              </button>
            </div>
          ))}
        </div>

        {error && (
          <div className="bg-red-950/50 border border-red-800 rounded-lg p-4 text-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="mt-12 text-zinc-500 text-xs text-center space-y-1">
          <p>테스트 카드: 4242 4242 4242 4242 · 만료 12/30 · CVC 123</p>
          <p>
            결제 처리: 포트원 V2 (PortOne) + 토스페이먼츠 ·{" "}
            <span className="text-orange-400">테스트 환경</span>
          </p>
        </div>
      </div>
    </div>
  );
}
