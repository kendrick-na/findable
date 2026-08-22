import { auth, currentUser } from "@repo/auth/server";
import { database } from "@repo/database";
import type { Metadata } from "next";
import { AuditHistoryList } from "../components/audit-history-list";
import { Header } from "../components/header";
import { HistoryAutoRefresh } from "../components/history-auto-refresh";
import { historyCountLabel } from "../lib/history-count-label";
import { getPrimaryEmail } from "../lib/user";

export const metadata: Metadata = {
  title: "측정 이력 — Findable",
  description: "지금까지 실행한 AI 브랜드 가시성 측정 결과 모음.",
};

const HistoryPage = async () => {
  const user = await currentUser();
  const email = user ? getPrimaryEmail(user) : null;
  const { orgId } = await auth();

  // 대시보드와 동일한 스코프: 이메일 무료진단 ∪ org 측정.
  // org 측정은 8-b FK(organizationId)가 정식 연결, email=`org:${orgId}` 프리픽스는
  // FK 이전(backfill 전) 레거시 행 커버용(page.tsx 와 동일한 OR).
  const identifiers = [
    ...(email ? [email] : []),
    ...(orgId ? [`org:${orgId}`] : []),
  ];
  // 🔴 S7-4차(2026-08-12) — 스코프를 상수로 뽑는다. 목록과 총 건수가 **같은 조건**을
  //   봐야 "50건 중 50건"이 어긋나지 않는다(조건을 두 벌 쓰면 언젠가 갈라진다).
  const scope = {
    OR: [
      { email: { in: identifiers } },
      ...(orgId ? [{ organizationId: orgId }] : []),
    ],
  };
  const PAGE_SIZE = 50;
  const [jobs, totalCount] =
    identifiers.length > 0
      ? await Promise.all([
          database.auditJob.findMany({
            where: scope,
            orderBy: { createdAt: "desc" },
            take: PAGE_SIZE,
          }),
          database.auditJob.count({ where: scope }),
        ])
      : [[], 0];

  // 🔴 S7-b(2026-08-11) — 진행 중 건수를 **서버에서** 센다. 클라이언트가 다시 조회하면
  //   스코프(이메일 ∪ org) 권한 로직이 두 벌이 된다.
  const pendingCount = jobs.filter(
    (job) => job.status === "queued" || job.status === "processing"
  ).length;

  return (
    <>
      <Header page="측정 이력" pages={["Findable"]} />
      <div className="flex flex-1 flex-col gap-4 p-6 pt-2">
        <h1 className="font-semibold text-2xl">측정 이력</h1>
        {/* 🔴 S7-4차(2026-08-12) — 예전에는 총 건수도, `take: 50` 상한도 화면에
            없었다. 51번째부터는 **오래된 기록이 말없이 잘려** 고객은 사라진 줄 안다.
            판정은 `historyCountLabel` 이 한다(서버 컴포넌트 안에 두면 테스트가 안 되고,
            QA 계정은 0건이라 잘림 경로를 눈으로도 못 본다 → 테스트로 고정). */}
        <p className="text-muted-foreground">
          {historyCountLabel(totalCount, PAGE_SIZE)}
        </p>
        <HistoryAutoRefresh
          hasPending={pendingCount > 0}
          pendingCount={pendingCount}
        />
        <AuditHistoryList jobs={jobs} />
      </div>
    </>
  );
};

export default HistoryPage;
