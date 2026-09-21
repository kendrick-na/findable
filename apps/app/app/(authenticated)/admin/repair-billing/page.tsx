import { isAdmin } from "@repo/auth/admin";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { repairBillingScheduleSchema } from "@/app/actions/admin/repair-billing-schema";
import { Header } from "../../components/header";

export const metadata: Metadata = {
  title: "결제 스키마 보정",
  description: "운영 DB의 결제 예약 상태 컬럼 일회성 보정",
};

const RepairBillingPage = async () => {
  if (!(await isAdmin())) {
    notFound();
  }

  return (
    <>
      <Header page="결제 스키마 보정" pages={["관리자"]} />
      <div className="flex flex-1 flex-col gap-5 p-6 pt-2">
        <h1 className="font-semibold text-2xl">결제 예약 스키마 보정</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Organization에 결제 예약 컬럼 3개를 추가합니다. 기존 데이터는 수정하거나
          삭제하지 않으며, 이미 있으면 아무 변경도 하지 않습니다.
        </p>
        <form action={repairBillingScheduleSchema}>
          <button className="findable-btn-primary rounded-md px-4 py-2" type="submit">
            보정 실행
          </button>
        </form>
      </div>
    </>
  );
};

export default RepairBillingPage;
