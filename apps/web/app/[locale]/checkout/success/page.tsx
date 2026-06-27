/**
 * /checkout/success — 결제 성공 화면 (KAIST 데모용)
 *
 * paymentId 쿼리스트링으로 결제 정보 표시.
 * Server Component — Next.js 16 searchParams Promise 패턴.
 */
import Link from "next/link";

interface SuccessPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ paymentId?: string }>;
}

export default async function CheckoutSuccessPage({
  params,
  searchParams,
}: SuccessPageProps) {
  const { locale } = await params;
  const { paymentId } = await searchParams;
  const lp = locale.startsWith("en") ? "/en" : "/ko";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-6 py-16 flex items-center justify-center">
      <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-6 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center">
          <svg
            className="w-8 h-8 text-emerald-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <title>결제 완료</title>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>

        <h1 className="text-2xl font-semibold mb-3">결제 완료</h1>
        <p className="text-zinc-400 text-sm mb-8 leading-relaxed">
          포트원 V2 + 토스페이먼츠 테스트 결제가 성공적으로 검증되었습니다.
          <br />
          평가위원 시연용 환경입니다.
        </p>

        {paymentId && (
          <div className="bg-zinc-950/50 border border-zinc-800 rounded-lg p-4 mb-6 text-left">
            <div className="text-zinc-500 text-xs uppercase tracking-wider mb-1">
              결제 식별자
            </div>
            <div className="text-zinc-200 text-xs font-mono break-all">
              {paymentId}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <Link
            href={`${lp}/checkout`}
            className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium py-2.5 rounded-lg transition-colors text-sm"
          >
            다시 결제하기
          </Link>
          <Link
            href={lp}
            className="flex-1 bg-orange-500 hover:bg-orange-400 text-zinc-900 font-semibold py-2.5 rounded-lg transition-colors text-sm"
          >
            홈으로
          </Link>
        </div>
      </div>
    </div>
  );
}
