import { isAdmin } from "@repo/auth/admin";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { env } from "@/env";
import { listIssuedReports, reportWebUrl } from "@/lib/client-report/admin";
import { Header } from "../../components/header";
import { IssueForm, RevokeButton, SendApproveButton } from "./issue-form";

export const metadata: Metadata = {
  title: "영업 리포트 발행",
  description:
    "측정 1회차 + 사람 승인 판별로 v12 영업 리포트 링크를 발행하는 관리자 화면",
};
export const dynamic = "force-dynamic";

const STATE_LABEL = {
  live: "공개 중",
  expired: "만료",
  revoked: "폐기",
} as const;

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

function ReportsBody({
  reports,
}: {
  reports: Awaited<ReturnType<typeof listIssuedReports>> | null;
}) {
  if (reports === null) {
    return (
      <p className="p-4 text-amber-300 text-sm">목록을 읽지 못했습니다.</p>
    );
  }
  if (reports.length === 0) {
    return (
      <p className="p-4 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
        아직 발행한 리포트가 없습니다.
      </p>
    );
  }
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
        <tr>
          <th className="px-4 py-2">브랜드 · 판</th>
          <th className="px-4 py-2">정확 / 분모</th>
          <th className="px-4 py-2">① 판별 검토 (reviewer)</th>
          <th className="px-4 py-2">② 대표 고객 발송 승인</th>
          <th className="px-4 py-2">발행 · 만료</th>
          <th className="px-4 py-2">상태</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody className="divide-y divide-[color:var(--findable-hairline,#23252a)]">
        {reports.map((r) => (
          <tr key={r.id}>
            <td className="px-4 py-2">
              {r.brand} v{r.version}
              <span className="block text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                {r.domain} · 회차 {r.auditJobId.slice(0, 8)}
              </span>
            </td>
            <td className="px-4 py-2 tabular-nums">
              {r.okN} / {r.n}
            </td>
            <td className="px-4 py-2 text-xs">
              {r.reviewer}
              <span className="block text-[color:var(--findable-ink-subtle,#8a8f98)]">
                {r.reviewedAt
                  ? dateFormatter.format(new Date(r.reviewedAt))
                  : "—"}
              </span>
            </td>
            <td className="px-4 py-2 text-xs">
              {r.sendApproval ? (
                <span className="text-emerald-300">
                  {r.sendApproval.approverName}
                  <span className="block text-[color:var(--findable-ink-subtle,#8a8f98)]">
                    {dateFormatter.format(new Date(r.sendApproval.approvedAt))}
                  </span>
                </span>
              ) : (
                <span className="text-amber-300">
                  대기 — 링크는 「내부 시안 · 외부 발송 금지」 표시
                </span>
              )}
            </td>
            <td className="px-4 py-2 text-xs">
              {dateFormatter.format(new Date(r.issuedAt))}
              <span className="block text-[color:var(--findable-ink-subtle,#8a8f98)]">
                ~{" "}
                {r.expiresAt
                  ? dateFormatter.format(new Date(r.expiresAt))
                  : "무기한"}
              </span>
            </td>
            <td className="px-4 py-2 text-xs">{STATE_LABEL[r.state]}</td>
            <td className="px-4 py-2 text-right text-xs">
              {r.url && (
                <>
                  <a
                    className="underline underline-offset-2"
                    href={r.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    열기
                  </a>{" "}
                  <a
                    className="underline underline-offset-2"
                    href={`${r.url}?print=1`}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    인쇄용
                  </a>{" "}
                  <a
                    className="underline underline-offset-2"
                    href={`${r.url}/pdf`}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    PDF
                  </a>{" "}
                  {r.sendApproval ? null : (
                    <SendApproveButton reportId={r.id} url={r.url} />
                  )}{" "}
                  <RevokeButton reportId={r.id} />
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
const AUDIT_JOB_ID_RE = /^[0-9a-f-]{36}$/i;

export default async function ClientReportsAdminPage({
  searchParams,
}: {
  // 「회사 찾기」 카드의 [리포트] 버튼이 측정 회차를 채워 보낸다(?auditJobId=).
  searchParams: Promise<{ auditJobId?: string }>;
}) {
  if (!(await isAdmin())) {
    notFound();
  }
  const { auditJobId } = await searchParams;
  const webUrl = reportWebUrl(env.NEXT_PUBLIC_WEB_URL);
  const reports = await listIssuedReports(webUrl).catch(() => null);

  return (
    <>
      <Header page="영업 리포트 발행" pages={["관리자"]} />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
        <div className="space-y-2">
          <h1 className="font-semibold text-2xl tracking-tight">
            영업 리포트 발행
          </h1>
          <p className="max-w-3xl text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-6">
            측정 1회차(AuditJob)의 원본을 고정하고, 사람이 판별·승인한 파일로만
            링크를 만듭니다. 초안·오래된 측정·원문 없는 측정은 발행되지
            않습니다. PDF 는 발행된 링크를 그대로 인쇄한 같은 판입니다. 무료
            진단 화면(/ko/audit)은 원문 전체가 공개되므로 영업 링크로 쓰지
            않습니다.
          </p>
          <p className="max-w-3xl rounded-md border border-amber-800/60 bg-amber-950/30 p-3 text-amber-100 text-sm leading-6">
            🔴 승인은 두 단계입니다. <b>① 판별 검토</b>(판별 파일의 reviewer —
            답변 판별이 맞는지)와 <b>② 대표 고객 발송 최종 승인</b>(발행된
            링크·PDF 를 대표가 직접 열어 보고 고객에게 보내도 된다고 승인)은
            다른 단계입니다. ②가 끝나기 전 링크는 모든 쪽에 「내부 시안 · 외부
            발송 금지」가 찍히고, 영업 메일에 들어가지 않습니다.
          </p>
        </div>

        <IssueForm
          initialAuditJobId={
            auditJobId && AUDIT_JOB_ID_RE.test(auditJobId) ? auditJobId : ""
          }
        />

        <section className="overflow-hidden rounded-xl border border-[color:var(--findable-hairline,#23252a)]">
          <h2 className="border-[color:var(--findable-hairline,#23252a)] border-b px-4 py-3 font-semibold text-sm">
            발행 목록 (v2 승인본)
          </h2>
          <ReportsBody reports={reports} />
        </section>
      </main>
    </>
  );
}
