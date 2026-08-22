import { isAdmin } from "@repo/auth/admin";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listPartnerApplications } from "@/app/actions/partner/query";
import { Header } from "../../components/header";
import { PartnerReviewTable } from "./partner-review-table";

export const metadata: Metadata = {
  title: "파트너 승인",
  description: "파트너 신청 검토·승인",
};

// admin 만 접근. 아니면 404(존재 노출 안 함).
const AdminPartnersPage = async () => {
  if (!(await isAdmin())) {
    notFound();
  }

  const applications = await listPartnerApplications();

  return (
    <>
      <Header page="파트너 승인" pages={["관리자"]} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tracking-tight">
            파트너 승인
          </h1>
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
            파트너 신청을 검토하고 파트너 접근(Growth 상당)을 부여합니다.
          </p>
        </div>

        <PartnerReviewTable applications={applications} />
      </div>
    </>
  );
};

export default AdminPartnersPage;
