import { maskEmail } from "@repo/audit/mask";
import { isAdmin } from "@repo/auth/admin";
import { database } from "@repo/database";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { env } from "@/env";
import { Header } from "../../components/header";
import { adminAuditsCountLabel } from "../../lib/admin-audits-label";

export const metadata: Metadata = {
  title: "진단 목록",
  description: "생성된 진단을 최신순으로 보는 읽기전용 관리자 목록",
};

/** `/history` 와 같은 상한. 목록이 잘리면 화면이 그 사실을 반드시 말한다. */
const PAGE_SIZE = 50;

const STATUS_LABEL: Record<string, string> = {
  queued: "대기",
  processing: "진행 중",
  completed: "완료",
  failed: "실패",
};

const STATUS_TONE: Record<string, string> = {
  completed: "text-[color:var(--findable-success,#27a644)]",
  failed: "text-[color:var(--findable-primary,#ff7a4d)]",
};

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "short",
  timeStyle: "short",
});

const AdminAuditsPage = async () => {
  if (!(await isAdmin())) {
    notFound();
  }

  // ⚠️ `/admin/ops` 는 집계(count·groupBy)만 본다. 개별 진단을 보는 화면이
  //    제품에 없어서 운영자가 "고객이 무엇을 측정했나"를 알 방법이 없었다.
  const [jobs, totalCount] = await Promise.all([
    database.auditJob.findMany({
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      select: {
        id: true,
        email: true,
        domain: true,
        status: true,
        language: true,
        createdAt: true,
      },
    }),
    database.auditJob.count(),
  ]);

  const webUrl = env.NEXT_PUBLIC_WEB_URL;

  return (
    <>
      <Header page="진단 목록" pages={["관리자"]} />
      <div className="flex flex-1 flex-col gap-4 p-6 pt-2">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
            진단 목록
          </h1>
          {/* 🔒 이메일은 마스킹한다 — 운영자라도 필요 최소한만 본다.
              (세션N-26 이 공유링크에서 이메일을 가린 것과 같은 원칙) */}
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            {adminAuditsCountLabel(totalCount, PAGE_SIZE)} 이메일은 일부만
            보여드려요.
          </p>
        </div>

        {jobs.length === 0 ? (
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            아직 생성된 진단이 없어요.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-[var(--findable-hairline)] border-b text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                <tr>
                  <th className="py-2 pr-4 font-normal">생성</th>
                  <th className="py-2 pr-4 font-normal">도메인</th>
                  <th className="py-2 pr-4 font-normal">이메일</th>
                  <th className="py-2 pr-4 font-normal">언어</th>
                  <th className="py-2 pr-4 font-normal">상태</th>
                  <th className="py-2 font-normal">결과</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    className="border-[var(--findable-hairline)] border-b last:border-0"
                    key={job.id}
                  >
                    <td className="whitespace-nowrap py-2 pr-4 text-[color:var(--findable-ink-subtle,#8a8f98)] tabular-nums">
                      {dateFormatter.format(job.createdAt)}
                    </td>
                    <td className="py-2 pr-4 text-[color:var(--findable-ink,#f7f8f8)] [overflow-wrap:anywhere]">
                      {job.domain}
                    </td>
                    <td className="py-2 pr-4 text-[color:var(--findable-ink-muted,#d0d6e0)] [overflow-wrap:anywhere]">
                      {/* org 트리거 측정은 email 이 `org:{orgId}` 프리픽스라 주소가 아니다.
                          그대로 마스킹하면 의미 없는 문자열이 되므로 그대로 보여준다. */}
                      {job.email.startsWith("org:")
                        ? job.email
                        : maskEmail(job.email)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-[color:var(--findable-ink-subtle,#8a8f98)]">
                      {job.language}
                    </td>
                    <td
                      className={`whitespace-nowrap py-2 pr-4 ${
                        STATUS_TONE[job.status] ??
                        "text-[color:var(--findable-ink-subtle,#8a8f98)]"
                      }`}
                    >
                      {STATUS_LABEL[job.status] ?? job.status}
                    </td>
                    <td className="whitespace-nowrap py-2">
                      {job.status === "completed" ? (
                        <a
                          className="text-[color:var(--findable-primary,#ff7a4d)] underline underline-offset-4"
                          href={`${webUrl}/ko/audit/${job.id}`}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          결과 보기
                        </a>
                      ) : (
                        <span className="text-[color:var(--findable-ink-tertiary,#7e8289)]">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};

export default AdminAuditsPage;
