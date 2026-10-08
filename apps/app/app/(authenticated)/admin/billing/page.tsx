import { isAdmin } from "@repo/auth/admin";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listStuckClaims } from "@/app/actions/admin/billing";
import { listRefundRequests } from "@/app/actions/admin/refund-requests";
import { Header } from "../../components/header";
import { RefundRequestTable } from "./refund-request-table";
import { StuckClaimTable } from "./stuck-claim-table";

export const metadata: Metadata = {
  title: "결제 선점 점검",
  description: "30분 넘게 남은 정기결제 선점 확인·해제 · 환불·청약철회 요청",
};

// admin 만 접근. 아니면 404(존재 노출 안 함).
const AdminBillingPage = async () => {
  if (!(await isAdmin())) {
    notFound();
  }

  const [claims, refundRequests] = await Promise.all([
    listStuckClaims(),
    listRefundRequests(),
  ]);

  return (
    <>
      <Header page="결제 선점 점검" pages={["관리자"]} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tracking-tight">
            결제 선점 점검
          </h1>
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
            첫 정기결제 직전에 잡아 둔 선점이 30분 넘게 남은 조직입니다. 해제는
            PortOne 에서 결제 실패·취소 또는 결제 없음이 확인될 때만 됩니다.
          </p>
        </div>

        <StuckClaimTable claims={claims} />

        {/* ⚖️ 고객이 요금제 화면에서 보낸 환불·청약철회 요청. 받은 날부터 3영업일 안에 처리한다
            (약관 제4조의3 초안 제6항). 고객에게 자동 메일은 나가지 않는다. */}
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg">
              환불·청약철회 요청
            </h2>
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              요금제 화면에서 접수된 요청입니다. 받은 날부터 3영업일 이내에
              PortOne 에서 결제를 취소하고, 정기결제라면 해지도 함께 처리하세요.
            </p>
          </div>
          <RefundRequestTable requests={refundRequests} />
        </section>
      </div>
    </>
  );
};

export default AdminBillingPage;
