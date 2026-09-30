import { isAdmin } from "@repo/auth/admin";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { env } from "@/env";
import { listIssuedReports, reportWebUrl } from "@/lib/client-report/admin";
import { Header } from "../../components/header";
import { IssueForm, RevokeButton } from "./issue-form";

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
          <th className="px-4 py-2">검토</th>
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
export default async function ClientReportsAdminPage() {
  if (!(await isAdmin())) {
    notFound();
  }
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
        </div>

        <IssueForm />

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
