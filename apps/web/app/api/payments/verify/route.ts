/**
 * POST /api/payments/verify — **폐기됨(410 Gone)**
 *
 * 🔒 왜 막았나(2026-09-01, Trust 리포트 후속): 이 라우트는 apps/web(로그인 없음)에 있어
 *   **인증 검사가 없었다**. 그래서 누구든 임의의 paymentId 로 호출하면 서버가 포트원에
 *   결제 단건 조회를 대신 해주고, 응답에 amount·paidAt·receiptUrl 이 실려 나갔다.
 *   plan 을 부여하진 않으니 권한 상승은 없었지만, **타인 결제 정보 열람**과
 *   포트원 API 호출 대리(레이트리밋·비용 소모)가 가능한 상태였다.
 *
 * ✅ 실 결제 검증은 로그인 컨텍스트의 서버액션
 *   `apps/app/app/actions/billing/checkout.ts` 의 verifyPaymentAndGrant 가 담당한다
 *   (세션 uid 대조 + grantPlan 까지 완결). 이 라우트는 그 이전 www `/[locale]/checkout`
 *   데모 페이지의 유일한 호출부였고, 그 페이지는 이미 폐기됐다 — 즉 **앱 내 호출부 0**.
 *
 * ⚠️ 과거 www 경로 결제 이력 확인은 **포트원 콘솔**에서 하는 일이라 이 라우트가 필요 없다.
 *   완전 삭제 대신 410 을 남기는 이유: 외부에서 아직 호출이 오는지 로그로 잡히고,
 *   되돌리기도 쉽다. 이전 검증 로직 전문은 git 히스토리(~b6a5404)에 있다.
 */
import { NextResponse } from "next/server";

export function POST() {
  return NextResponse.json(
    {
      ok: false,
      message:
        "Gone: this endpoint is retired. Payment verification runs in the authenticated app checkout flow.",
    },
    { status: 410 }
  );
}
