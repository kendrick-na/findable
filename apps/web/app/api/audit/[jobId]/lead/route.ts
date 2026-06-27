// /api/audit/[jobId]/lead — 풀 리포트 이메일 게이트 (HubSpot 백링크 모델, research 13)
//
// 사용자가 결과 페이지 하단 "📩 풀 리포트 받기" 클릭 → 이 API 호출 → Resend로 이메일 발송

import { database } from "@repo/database";
import { resend } from "@repo/email";
import { AuditReportEmail } from "@repo/email/templates/audit-report";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface LeadBody {
  email?: string;
  source?: string;
}

interface AuditMetrics {
  enginesCovered: string[];
  enginesWithMention: string[];
  sov?: number;
  sentimentDistribution?: { positive: number; neutral: number; negative: number };
  averageMentionPosition?: number | null;
  topCitedDomains?: Array<{ domain: string; count: number }>;
}

interface AuditResult {
  brandName?: string;
  domain?: string;
  metrics?: AuditMetrics;
}

interface CrewAction {
  rank: number;
  title: string;
  expectedTimeframe?: string;
}

interface CrewStrategist {
  output?: {
    topActions?: CrewAction[];
  };
}

interface CrewResult {
  strategist?: CrewStrategist;
}

function tierLabel(score: number): string {
  if (score >= 76) return "리더";
  if (score >= 51) return "경쟁 가능";
  if (score >= 26) return "막 시작";
  return "AI에서 안 보임";
}

// metrics에서 5축 합계로 GEO 점수 계산 (audit-result.tsx와 동일 로직)
function calcGeoScore(m: AuditMetrics): number {
  const engineSet = new Set(m.enginesCovered);
  const mentionSet = new Set(m.enginesWithMention);
  const sentiment = m.sentimentDistribution ?? { positive: 0, neutral: 0, negative: 0 };
  const total = sentiment.positive + sentiment.neutral + sentiment.negative;
  const sentRatio = total === 0 ? 0 : (sentiment.positive - sentiment.negative) / total;
  const sentScore = Math.max(0, Math.min(40, Math.round((sentRatio + 1) * 20)));

  const presence = Math.min(20, Math.round((m.topCitedDomains?.length ?? 0) * 4));
  const recognition = Math.round((mentionSet.size / Math.max(engineSet.size, 1)) * 20);
  const sovAxis = Math.round((m.sov ?? 0) / 10);
  const avgPos = m.averageMentionPosition;
  const competition =
    avgPos === null || avgPos === undefined
      ? 0
      : Math.max(0, Math.min(10, Math.round(11 - avgPos * 2)));

  return sentScore + presence + recognition + sovAxis + competition;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as LeadBody;

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  log.info("lead.received", {
    jobId,
    email,
    source: body.source ?? "viral_bar",
  });

  // CRM 리드 적재 (실패해도 이메일 발송은 시도)
  // LeadSource enum: free_audit | contact_form | newsletter | referral | other
  try {
    await database.lead.create({
      data: {
        email,
        source: "free_audit",
        metadata: { jobId, viralSource: body.source ?? "viral_bar" },
      },
    });
  } catch (leadErr) {
    log.warn("lead.db_save_failed", { jobId, error: parseError(leadErr) });
  }

  // Job 데이터 조회
  const job = await database.auditJob.findUnique({
    where: { id: jobId },
    select: { result: true, pdfUrl: true, crewResult: true, status: true },
  });

  if (!job || job.status !== "completed" || !job.result) {
    log.warn("lead.job_not_ready", { jobId });
    return NextResponse.json({ ok: true, message: "lead saved (job not ready)" });
  }

  // Resend 키 미설정 시 — 등록만 하고 종료
  if (!resend) {
    log.warn("lead.resend_not_configured", { jobId });
    return NextResponse.json({ ok: true, message: "lead saved (email skipped)" });
  }

  // 이메일 발송
  try {
    const result = job.result as unknown as AuditResult;
    const metrics = result.metrics ?? { enginesCovered: [], enginesWithMention: [] };
    const geoScore = calcGeoScore(metrics);
    const enginesMentioned = new Set(metrics.enginesWithMention).size;
    const enginesTotal = new Set(metrics.enginesCovered).size;

    const crew = job.crewResult as unknown as CrewResult | null;
    const topActions = (crew?.strategist?.output?.topActions ?? []).slice(0, 3).map((a) => ({
      rank: a.rank,
      title: a.title,
      timeframe: a.expectedTimeframe ?? "이번 주",
    }));

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_WEB_URL ?? "https://findable.co.kr";

    const fromAddress = process.env.RESEND_FROM ?? "onboarding@resend.dev";
    const sendResult = await resend.emails.send({
      from: `Findable <${fromAddress}>`,
      to: email,
      subject: `[Findable] ${result.brandName ?? result.domain} GEO 점수 ${geoScore}/100 — ${tierLabel(geoScore)}`,
      react: AuditReportEmail({
        brandName: result.brandName ?? result.domain ?? "Your Brand",
        domain: result.domain ?? "",
        geoScore,
        tierLabel: tierLabel(geoScore),
        enginesMentioned,
        enginesTotal,
        resultUrl: `${baseUrl}/ko/audit/${jobId}`,
        pdfUrl: job.pdfUrl ?? undefined,
        topActions,
      }),
    });

    log.info("lead.email_sent", { jobId, email, resendId: sendResult.data?.id });
    return NextResponse.json({ ok: true, emailSent: true });
  } catch (emailErr) {
    log.error("lead.email_failed", { jobId, error: parseError(emailErr) });
    return NextResponse.json({ ok: true, emailSent: false });
  }
}
