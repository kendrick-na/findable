// POST /api/audit — 무료 Audit 잡 생성 + 백그라운드 실행
//
// PRD §11.2 AuditRequest/AuditResponse 스키마 기준.
// 비로그인 진입 (이메일만 받음). 어뷰즈 방지는 v1.0.5에서 BotID + rate limit 강화.
//
// Runtime: Node.js (Prisma + Neon adapter는 Edge 미지원).
// maxDuration: vercel.json에서 300s (Audit 백그라운드 처리 마진).

import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { NextResponse, after } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { runAuditJob } from "@/lib/audit/runner";

export const runtime = "nodejs";
export const maxDuration = 300;

const auditRequestSchema = z.object({
  email: z.email(),
  domain: z
    .string()
    .min(3)
    .max(253)
    .transform((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "")),
  industry: z.string().optional(),
  language: z.enum(["ko", "en", "both"]).default("both"),
  brandName: z.string().max(100).optional(),
});

export async function POST(request: NextRequest) {
  let payload: z.infer<typeof auditRequestSchema>;

  try {
    const body = await request.json();
    payload = auditRequestSchema.parse(body);
  } catch (error) {
    log.warn("audit.request.invalid", { error: parseError(error) });
    return NextResponse.json(
      {
        error: "잘못된 요청입니다.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 400 }
    );
  }

  try {
    // 어뷰즈 방지: 같은 이메일 24h 내 1회 제한 (PRD §19.6)
    // 단, 5분 넘게 processing에 박힌 좀비 job은 자동 fail 처리 후 재시도 허용
    // D-052 (2026-05-07): FINDABLE_ADMIN_EMAILS 화이트리스트 우회 (관리자 시연·디버그용)
    const STALE_THRESHOLD_MS = 5 * 60 * 1000;
    const adminEmails = (process.env.FINDABLE_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const isAdmin = adminEmails.includes(payload.email.toLowerCase());
    if (isAdmin) {
      log.info("audit.request.admin_bypass", { email: payload.email });
    }
    const recent = isAdmin
      ? null
      : await database.auditJob.findFirst({
          where: {
            email: payload.email,
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
          orderBy: { createdAt: "desc" },
        });
    if (recent && recent.status !== "failed") {
      const isStaleProcessing =
        (recent.status === "processing" || recent.status === "queued") &&
        Date.now() - recent.createdAt.getTime() > STALE_THRESHOLD_MS;

      if (isStaleProcessing) {
        // 좀비 정리 — 새 audit 생성 흐름으로 통과
        await database.auditJob
          .update({
            where: { id: recent.id },
            data: {
              status: "failed",
              errorMessage: "측정이 5분 넘게 진행되어 자동 종료됨 (좀비 정리)",
              completedAt: new Date(),
            },
          })
          .catch((err) => {
            log.warn("audit.stale.fail_failed", {
              jobId: recent.id,
              error: parseError(err),
            });
          });
        log.info("audit.stale.recovered", {
          email: payload.email,
          staleJobId: recent.id,
        });
      } else {
        log.info("audit.request.rate_limited", {
          email: payload.email,
          existingJobId: recent.id,
        });
        return NextResponse.json(
          {
            error: "이미 24시간 내 무료 진단을 받으셨습니다.",
            existingJobId: recent.id,
          },
          { status: 429 }
        );
      }
    }

    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      null;

    const job = await database.auditJob.create({
      data: {
        email: payload.email,
        domain: payload.domain,
        language: payload.language,
        ipAddress,
      },
      select: { id: true, status: true, createdAt: true },
    });

    // CRM 리드 적재 — 실패해도 audit job은 유지
    try {
      await database.lead.create({
        data: {
          email: payload.email,
          domain: payload.domain,
          source: "free_audit",
          metadata: { language: payload.language, jobId: job.id },
        },
      });
    } catch (leadError) {
      log.error("audit.lead.create_failed", {
        jobId: job.id,
        error: parseError(leadError),
      });
    }

    log.info("audit.job.created", {
      jobId: job.id,
      domain: payload.domain,
      language: payload.language,
    });

    // 응답 후 백그라운드 실행 (Vercel Functions after())
    after(async () => {
      try {
        await runAuditJob({
          jobId: job.id,
          domain: payload.domain,
          language: payload.language,
          brandName: payload.brandName,
        });
      } catch (jobError) {
        // runAuditJob 내부에서 try/catch로 status='failed' 업데이트하지만,
        // 그 자체가 throw할 가능성에 대비한 last resort 핸들러.
        log.error("audit.job.uncaught", {
          jobId: job.id,
          error: parseError(jobError),
        });
      }
    });

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      pollUrl: `/api/audit/${job.id}`,
    });
  } catch (error) {
    // parseError가 Sentry.captureException 자동 호출
    const message = parseError(error);
    log.error("audit.request.unhandled", { error: message });
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 }
    );
  }
}
