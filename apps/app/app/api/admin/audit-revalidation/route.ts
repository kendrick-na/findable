// POST /api/admin/audit-revalidation — 저장된 측정의 브랜드 판정 재검증(backfill)
//
// 🔒 운영자(admin) 전용. 첫 줄에서 서버 세션으로 권한을 다시 확인한다.
// 🔴 기본값은 **dry-run**(쓰기 0). `apply: true` 일 때만 AuditJob.result 를
//   새 버전으로 바꾸고, 원본 결과는 `result.revalidation.original` 에 그대로 보존한다.
// ⚠️ 판정기(LLM) 호출 비용이 든다 — 한 번에 최대 MAX_JOBS 건.
// ⚠️ 원문이 잘린 행은 「판별 불가」로 두고 응답에 recommendRemeasure=true(재측정 권장).

import { revalidateStoredAuditResult } from "@repo/audit/revalidate-stored-audit";
import { requireAdmin } from "@repo/auth/admin";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_JOBS = 10;

const BodySchema = z.object({
  jobIds: z.array(z.string().uuid()).min(1).max(MAX_JOBS),
  apply: z.boolean().default(false),
  includeCurrentVersion: z.boolean().default(false),
});

export async function POST(request: Request) {
  let adminId: string;
  try {
    adminId = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const { apply, includeCurrentVersion, jobIds } = parsed.data;
  log.warn("admin.audit_revalidation.start", {
    adminId,
    apply,
    includeCurrentVersion,
    jobCount: jobIds.length,
  });

  const outcomes: Record<string, unknown>[] = [];
  for (const jobId of jobIds) {
    try {
      const job = await database.auditJob.findUnique({
        where: { id: jobId },
        select: { id: true, result: true, status: true },
      });
      if (!job || job.status !== "completed") {
        outcomes.push({ jobId, status: "skipped", reason: "not_completed" });
        continue;
      }
      const outcome = await revalidateStoredAuditResult(job.result, {
        includeCurrentVersion,
      });
      if (outcome.status === "skipped") {
        outcomes.push({ jobId, ...outcome });
        continue;
      }
      if (apply) {
        await database.auditJob.update({
          where: { id: jobId },
          data: { result: outcome.result as never },
        });
      }
      const metrics = outcome.result.metrics as
        | Record<string, unknown>
        | undefined;
      outcomes.push({
        jobId,
        status: apply ? "applied" : "dry_run",
        summary: outcome.summary,
        sov: metrics?.sov ?? null,
        verifiedCount: metrics?.verifiedCount ?? null,
        unverifiedCount: metrics?.unverifiedCount ?? null,
      });
    } catch (error) {
      log.error("admin.audit_revalidation.failed", {
        adminId,
        jobId,
        error: parseError(error),
      });
      outcomes.push({ jobId, status: "failed" });
    }
  }
  log.warn("admin.audit_revalidation.done", {
    adminId,
    apply,
    outcomes: outcomes.map((o) => ({ jobId: o.jobId, status: o.status })),
  });
  return NextResponse.json({ apply, outcomes });
}
