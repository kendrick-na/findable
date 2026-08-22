import type { AuditJob } from "@repo/database";
import { database } from "@repo/database";
import { Badge } from "@repo/design-system/components/ui/badge";
import { cn } from "@repo/design-system/lib/utils";
import { ExternalLinkIcon } from "lucide-react";
import type { Metadata } from "next";
import { env } from "@/env";
import { requireOrg, scopedBrands } from "@/lib/db/scoped";
import { Header } from "../components/header";
import { AssignBrandForm } from "../features/brand/assign-brand-form";
import { BrandProfileEditorServer } from "../features/brand/brand-profile-editor-server";
import { PromptWizard } from "../features/brand/prompt-wizard";
import { StartTrackingButton } from "../features/brand/start-tracking-button";

export const metadata: Metadata = {
  title: "브랜드·측정 · Findable",
  description: "측정할 브랜드를 등록하면, AI가 우리를 말하는지 확인해요.",
};

// audit-history-list와 동일 어휘(측정 상태 배지).
const STATUS_LABEL: Record<AuditJob["status"], string> = {
  queued: "대기 중",
  processing: "측정 중",
  completed: "완료",
  failed: "실패",
};

const STATUS_TONE: Record<AuditJob["status"], string> = {
  queued: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  processing: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-600 dark:text-red-400",
};

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

// requireOrg 만 통과하면 되는 org 멤버 self 화면(admin 게이트 아님).
// scopedBrands 는 내부에서 requireOrg 를 호출하므로 org 미선택 시 throw → 인증 레이아웃이 처리.
const BrandPage = async () => {
  const orgId = await requireOrg();
  const brands = await scopedBrands();

  // 브랜드별 마지막 측정(=이 org가 트리거한 AuditJob, email=`org:${orgId}`).
  // "측정 시작을 눌렀는데 어디서 확인하냐"는 혼란을 없애는 표면 — 행마다 상태·시각·결과 링크.
  const domains = brands.map((brand) => brand.domain);
  const recentJobs =
    domains.length > 0
      ? await database.auditJob.findMany({
          where: { email: `org:${orgId}`, domain: { in: domains } },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      : [];
  const latestByDomain = new Map<string, AuditJob>();
  for (const job of recentJobs) {
    if (!latestByDomain.has(job.domain)) {
      latestByDomain.set(job.domain, job);
    }
  }

  const webUrl = env.NEXT_PUBLIC_WEB_URL;

  return (
    <>
      {/* 🔴 S6-a(2026-08-11) — 이 화면을 부르는 이름이 3개였다(사이드바 "측정 시작" ·
          제목 "브랜드 측정" · 폼 "새 브랜드 등록"). 같은 곳을 세 이름으로 부르면
          사용자는 서로 다른 화면으로 읽는다 → 사이드바·title·h1 을 「브랜드·측정」으로 통일. */}
      <Header page="브랜드·측정" pages={["Findable"]} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
        <section className="flex flex-col gap-2">
          <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
            브랜드·측정
          </h1>
          <p className="max-w-2xl text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            측정할 브랜드를 등록하면, ChatGPT·Perplexity 등 주요 AI 엔진이 내
            브랜드를 어떻게 말하는지 조직 단위로 측정해요. 결과는 대시보드와
            측정 이력에 쌓여요.
          </p>
        </section>

        {brands.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
              내 브랜드 ({brands.length})
            </h2>
            <ul className="flex flex-col gap-2">
              {brands.map((brand) => {
                const lastJob = latestByDomain.get(brand.domain);
                return (
                  <li
                    className="flex flex-col gap-3 rounded-lg border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] px-4 py-3"
                    key={brand.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-[color:var(--findable-ink,#f7f8f8)]">
                            {brand.name}
                          </span>
                          <span className="truncate text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
                            {brand.domain}
                          </span>
                        </div>
                        {lastJob ? (
                          <div className="flex flex-wrap items-center gap-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                            <span>
                              마지막 측정{" "}
                              {dateFormatter.format(lastJob.createdAt)}
                            </span>
                            <Badge
                              className={cn(
                                "border-transparent",
                                STATUS_TONE[lastJob.status]
                              )}
                              variant="outline"
                            >
                              {STATUS_LABEL[lastJob.status]}
                            </Badge>
                            {/* 🔴 S7-2차(2026-08-11) — 이력 목록과 **같은 동작**이어야 한다.
                                결과는 www 에 있어 누르면 대시보드를 벗어나는데 돌아올 길이
                                없다 → 새 탭. 한쪽만 고치면 같은 링크가 화면마다 다르게
                                움직인다(NN/g 4 일관성). */}
                            {lastJob.status === "completed" && (
                              <a
                                className="inline-flex items-center gap-1 text-[color:var(--findable-primary,#ff7a4d)]"
                                href={`${webUrl}/ko/audit/${lastJob.id}`}
                                rel="noopener noreferrer"
                                target="_blank"
                              >
                                결과 보기
                                <ExternalLinkIcon
                                  aria-hidden="true"
                                  className="size-3"
                                />
                                <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                                  새 탭
                                </span>
                              </a>
                            )}
                          </div>
                        ) : (
                          <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                            아직 측정 전 — 측정 시작을 누르면 1~3분 뒤 결과가
                            나와요.
                          </span>
                        )}
                      </div>
                      <StartTrackingButton
                        brandName={brand.name}
                        domain={brand.domain}
                      />
                    </div>
                    <PromptWizard brandId={brand.id} />
                    {/* 🔴 N-44 남은일 1-c — 온보딩을 **건너뛴 사람의 유일한 경로**.
                        `/welcome` 2·4단계는 건너뛸 수 있고, 무료 진단 후 가입자는 온보딩
                        자체를 건너뛴다. 여기가 없으면 별칭·경쟁사를 **영영 못 넣는다**. */}
                    <BrandProfileEditorServer
                      brandId={brand.id}
                      competitors={brand.competitors}
                      entityVariants={brand.entityVariants}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
              브랜드 추가
            </h2>
            {/* 🔴 S6-a(2026-08-11) 기록: 예전 문구 「바로 측정을 시작할 수 있어요」는
                당시 **거짓**이었다 — 폼이 등록만 하고 측정은 트리거하지 않았기 때문이다.
                ✅ 2026-08-14(재설계안 v2 §3-a): 폼이 **등록에 이어 측정까지 시작**하도록
                바뀌었으므로 그 문장이 **다시 참**이 됐다. 문구를 되살리되, 여전히
                소요 시간을 함께 밝힌다(기다림의 길이를 숨기지 않는다). */}
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              {brands.length === 0
                ? "도메인만 넣으면 바로 측정을 시작해요. 1~3분 걸려요."
                : "여러 브랜드를 등록해 각각 측정할 수 있어요."}
            </p>
          </div>
          <AssignBrandForm />
        </section>
      </div>
    </>
  );
};

export default BrandPage;
