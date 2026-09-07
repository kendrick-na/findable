import { isAdmin } from "@repo/auth/admin";
import { Badge } from "@repo/design-system/components/ui/badge";
import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  createConsultationNote,
  getConsultingWorkspace,
} from "@/app/actions/admin/consulting";
import { Header } from "../../../components/header";
import { ConsultationNoteForm } from "./consultation-note-form";
import { CustomerDataPanel } from "./customer-data-panel";

export const metadata: Metadata = {
  title: "고객사 컨설팅",
  description: "고객사별 측정 현황과 컨설팅 기록을 관리합니다.",
};

const fmt = (value: Date) =>
  new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const ConsultingWorkspacePage = async ({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) => {
  if (!(await isAdmin())) {
    notFound();
  }
  const { orgId } = await params;
  const workspace = await getConsultingWorkspace(orgId);
  if (!workspace) {
    notFound();
  }

  return (
    <>
      <Header page="고객사 컨설팅" pages={["관리자", "가입 조직"]} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              className="inline-flex items-center gap-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm hover:text-[color:var(--findable-primary,#ff7a4d)]"
              href="/admin/orgs"
            >
              <ArrowLeftIcon className="size-3.5" /> 가입 조직으로
            </Link>
            <h1 className="mt-3 font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tracking-tight">
              {workspace.organization.name}
            </h1>
            <p className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)]">
              원본 측정·사이트 준비도·검색 연동 현황을 확인하고 컨설팅 이력을 남깁니다.
            </p>
          </div>
          <Badge variant="outline">{workspace.organization.plan}</Badge>
        </div>

        {workspace.brands.length === 0 ? (
          <div className="findable-card p-5 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            아직 등록한 브랜드가 없어 컨설팅을 시작할 측정 데이터가 없어요.
          </div>
        ) : (
          <CustomerDataPanel brands={workspace.brands} />
        )}

        <ConsultationNoteForm
          onCreate={createConsultationNote}
          organizationId={workspace.organization.id}
        />

        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg">
            컨설팅 기록
          </h2>
          {workspace.notes.length === 0 ? (
            <p className="findable-card p-5 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              아직 남긴 컨설팅 기록이 없어요.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {workspace.notes.map((note) => (
                <li className="findable-card p-5" key={note.id}>
                  <p className="whitespace-pre-wrap text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm leading-6">
                    {note.body}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                    <span>{fmt(note.createdAt)} 기록</span>
                    {note.nextCheckAt ? (
                      <span>다음 점검 {fmt(note.nextCheckAt)}</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
};

export default ConsultingWorkspacePage;
