// POST /api/admin/audit-revalidation — 저장된 측정의 브랜드 판정 재검증(backfill)
//
// 🔒 운영자(admin) 전용. 첫 줄에서 서버 세션으로 권한을 다시 확인한다.
// 🔴 기본값은 **dry-run**(쓰기 0). `apply: true` 일 때만 AuditJob.result 를
//   새 버전으로 바꾸고, 원본 결과는 `result.revalidation.original` 에 그대로 보존한다.
// ⚠️ 판정기(LLM) 호출 비용이 든다 — 한 번에 최대 MAX_JOBS 건.
// ⚠️ 원문이 잘린 행은 「판별 불가」로 두고 응답에 recommendRemeasure=true(재측정 권장).

import { isVercelPreview } from "@repo/audit/preview-guard";
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

/**
 * Writes only the verdict-derived leaves, fenced on the exact stored snapshot.
 * Returns the affected row count (1 = applied).
 */
async function applyRevalidatedResult(
  jobId: string,
  storedResult: unknown,
  next: Record<string, unknown>
): Promise<number> {
  const revalidatedCoreRows = Array.isArray(next.engineResponses)
    ? next.engineResponses.filter(
        (row) =>
          !row ||
          typeof row !== "object" ||
          (row as { engineId?: unknown }).engineId !== "naver-briefing"
      )
    : [];
  // Revalidation owns only its verdict-derived leaves. A briefing claim
  // or completion may mutate the same JSON concurrently; replacing the
  // snapshot would erase that state and can resurrect processing.
  return await database.$executeRawUnsafe(
    `UPDATE "AuditJob"
           SET "result" =
             jsonb_set(
               jsonb_set(
                 jsonb_set(
                   jsonb_set(
                     jsonb_set(
                       jsonb_set(
                         jsonb_set(
                           jsonb_set(
                             (COALESCE("result", '{}'::jsonb)
                               - 'verificationState' - 'regions'),
                             '{engineResponses}',
                             $1::jsonb || (
                               SELECT COALESCE(jsonb_agg(row ORDER BY ord), '[]'::jsonb)
                               FROM jsonb_array_elements(
                                 COALESCE("result"->'engineResponses', '[]'::jsonb)
                               ) WITH ORDINALITY AS items(row, ord)
                               WHERE row->>'engineId' = 'naver-briefing'
                             ),
                             true
                           ),
                           '{metrics}', $2::jsonb, true
                         ),
                         '{mentionVerdictVersion}', to_jsonb($3::int), true
                       ),
                       '{revalidation}', $4::jsonb, true
                     ),
                     '{geoActions}', $5::jsonb, true
                   ),
                   '{topRecommendations}', $6::jsonb, true
                 ),
                 '{regionScoresOutdated}', to_jsonb($7::boolean), true
               ),
               '{actionsOutdated}', to_jsonb($8::boolean), true
             ),
             "pdfUrl" = NULL
           WHERE "id" = $9
             AND "status" = 'completed'
             AND COALESCE("result"->>'briefingStatus', 'not_requested')
               IS DISTINCT FROM 'processing'
             AND "result" = $10::jsonb
             AND jsonb_typeof(COALESCE("result"->'engineResponses', '[]'::jsonb)) = 'array'`,
    JSON.stringify(revalidatedCoreRows),
    JSON.stringify(next.metrics ?? {}),
    next.mentionVerdictVersion,
    JSON.stringify(next.revalidation ?? null),
    JSON.stringify(next.geoActions ?? []),
    JSON.stringify(next.topRecommendations ?? []),
    next.regionScoresOutdated === true,
    next.actionsOutdated === true,
    jobId,
    JSON.stringify(storedResult)
  );
}

export function POST(request: Request) {
  // Vercel Preview: even a dry-run calls the paid mention-verdict LLM, and a
  //   stubbed verdict must never be written over a stored result. Refuse.
  if (isVercelPreview()) {
    return Promise.resolve(
      NextResponse.json({ error: "disabled_on_preview" }, { status: 403 })
    );
  }
  return revalidate(request);
}

async function revalidate(request: Request) {
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
        const next = outcome.result as Record<string, unknown>;
        const applied = await applyRevalidatedResult(jobId, job.result, next);
        if (applied !== 1) {
          outcomes.push({
            jobId,
            status: "skipped",
            reason: "briefing_in_progress",
          });
          continue;
        }
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
