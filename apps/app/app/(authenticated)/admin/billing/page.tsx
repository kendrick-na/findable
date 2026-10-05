import { isAdmin } from "@repo/auth/admin";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listStuckClaims } from "@/app/actions/admin/billing";
import { Header } from "../../components/header";
import { StuckClaimTable } from "./stuck-claim-table";

export const metadata: Metadata = {
  title: "결제 선점 점검",
  description: "30분 넘게 남은 정기결제 선점 확인·해제",
};

// admin 만 접근. 아니면 404(존재 노출 안 함).
const AdminBillingPage = async () => {
  if (!(await isAdmin())) {
    notFound();
  }

  const claims = await listStuckClaims();

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
      </div>
    </>
  );
};

export default AdminBillingPage;
