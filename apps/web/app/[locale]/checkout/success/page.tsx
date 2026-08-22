/**
 * /checkout/success — 결제 성공 화면 (레거시 리다이렉트 대상)
 *
 * paymentId 쿼리스트링으로 결제 정보 표시.
 * Server Component — Next.js 16 searchParams Promise 패턴.
 *
 * ⚠️ 2026-08-03: 결제 동선이 앱(app.findable.co.kr/billing)으로 완전 이관되어
 *   호출부였던 www `/[locale]/checkout` 데모 페이지를 폐기했다(로그인 밖 결제라
 *   결제자 uid 를 몰라 plan 부여가 불가 → 결제만 되고 플랜 미반영 위험).
 *   이 페이지는 과거 결제자의 redirectUrl 북마크·PG 콘솔 이력이 남아 있을 수 있어
 *   유지하되, 안내는 앱으로만 보낸다("다시 결제하기" → 폐기된 /checkout 이었음).
 *   백업 = `_백업/checkout_데모_폐기_20260803/`.
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
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-16 text-zinc-100">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
          <svg
            className="h-8 w-8 text-emerald-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <title>결제 완료</title>
            <path
              d="M5 13l4 4L19 7"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
            />
          </svg>
        </div>

        <h1 className="mb-3 font-semibold text-2xl">결제 완료</h1>
        <p className="mb-8 text-sm text-zinc-400 leading-relaxed">
          포트원 V2 + 토스페이먼츠 테스트 결제가 성공적으로 검증되었습니다.
          <br />
          평가위원 시연용 환경입니다.
        </p>

        {paymentId && (
          <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4 text-left">
            <div className="mb-1 text-xs text-zinc-400 uppercase tracking-wider">
              결제 식별자
            </div>
            <div className="break-all font-mono text-xs text-zinc-200">
              {paymentId}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {/* 막다른 길 해소(2026-07-30 플로우 감사): 결제 후 제품(앱)으로 가는 길이 없었다. */}
          <a
            className="rounded-lg bg-orange-500 py-2.5 font-semibold text-sm text-zinc-900 transition-colors hover:bg-orange-400"
            href={`${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.findable.co.kr"}/billing`}
          >
            앱에서 플랜 확인하기
          </a>
          <div className="flex gap-3">
            {/* 결제 동선 앱 이관(2026-08-03): 폐기된 www /checkout 대신 요금제로. */}
            <Link
              className="flex-1 rounded-lg bg-zinc-800 py-2.5 font-medium text-sm text-zinc-100 transition-colors hover:bg-zinc-700"
              href={`${lp}/pricing`}
            >
              요금제 보기
            </Link>
            <Link
              className="flex-1 rounded-lg bg-zinc-800 py-2.5 font-medium text-sm text-zinc-100 transition-colors hover:bg-zinc-700"
              href={lp}
            >
              홈으로
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
