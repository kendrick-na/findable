import { isAdmin } from "@repo/auth/admin";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  backfillMissingSiteReadiness,
  createInviteCode,
  getOrgDetail,
  listInviteCodes,
  listOrgs,
  setOrgPlanDays,
  updateInviteCode,
} from "@/app/actions/admin/orgs";
import { Header } from "../../components/header";
import { OrgTable } from "./org-table";

export const metadata: Metadata = {
  title: "가입 조직·초대 코드",
  description: "가입한 조직과 초대 코드를 관리합니다.",
};

/**
 * 운영 콘솔 — 가입 조직 + 초대 코드 (세션N-42).
 *
 * 🔴 이 화면이 없어서 **누가 가입했는지 앱에서 볼 방법이 0곳**이었다.
 *   오버엣지 참여 기업이 코드로 들어오는데 운영자가 SQL 을 돌려야 했다.
 *
 * ⚠️ 데이터는 전부 **우리 DB** 에 있다(Clerk 는 로그인·plan 캐시만 담당).
 */
const AdminOrgsPage = async () => {
  // admin 만 접근. 아니면 404(존재 자체를 노출하지 않는다 — 다른 admin 화면과 동일).
  if (!(await isAdmin())) {
    notFound();
  }

  const [orgs, invites] = await Promise.all([listOrgs(), listInviteCodes()]);

  return (
    <>
      <Header page="가입 조직·초대 코드" pages={["관리자"]} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tracking-tight">
            가입 조직·초대 코드
          </h1>
          <p
            className="text-[color:var(--findable-ink-subtle,#8a8f98)]"
            style={{ wordBreak: "keep-all" }}
          >
            누가 가입했고 무엇을 쓰고 있는지 봅니다. 초대 코드의 기간·한도도
            여기서 직접 정할 수 있어요.
          </p>
        </div>

        {/* 🔴 서버액션을 **주입**한다(직접 import 하면 Storybook 이 죽는다 — N-41). */}
        <OrgTable
          invites={invites}
          onBackfillReadiness={backfillMissingSiteReadiness}
          onCreateCode={createInviteCode}
          onLoadDetail={getOrgDetail}
          onSetDays={setOrgPlanDays}
          onUpdateCode={updateInviteCode}
          orgs={orgs}
        />
      </div>
    </>
  );
};

export default AdminOrgsPage;
