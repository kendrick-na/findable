// /api/audit/[jobId]/lead — 풀 리포트 이메일 게이트 (HubSpot 백링크 모델, research 13)
//
// 사용자가 결과 페이지 하단 "📩 풀 리포트 받기" 클릭 → 이 API 호출 → Resend로 이메일 발송

import { geoAxisScores, scoreTier, TIER_LABEL_KO } from "@repo/audit/geo-score";
import { maskEmail } from "@repo/audit/mask";
import { database } from "@repo/database";
import { resend } from "@repo/email";
import { AuditReportEmail } from "@repo/email/templates/audit-report";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * 이메일 형식 검사 — 모듈 최상위 상수(요청마다 정규식을 다시 만들지 않게).
 * ⚠️ 패턴은 **원본 그대로** 옮긴 것이다. 리드 수집(전환 지점)이라 조건이 조금만
 *   달라져도 멀쩡한 이메일이 400 으로 막히거나 그 반대가 된다 — 위치만 바꾼다.
 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface LeadBody {
  email?: string;
  source?: string;
}

interface AuditMetrics {
  averageMentionPosition?: number | null;
  enginesCovered: string[];
  enginesWithMention: string[];
  sentimentDistribution?: {
    positive: number;
    neutral: number;
    negative: number;
  };
  sov?: number;
  topCitedDomains?: Array<{ domain: string; count: number }>;
}

interface AuditResult {
  brandName?: string;
  domain?: string;
  metrics?: AuditMetrics;
}

interface CrewAction {
  expectedTimeframe?: string;
  rank: number;
  title: string;
}

interface CrewStrategist {
  output?: {
    topActions?: CrewAction[];
  };
}

interface CrewResult {
  strategist?: CrewStrategist;
}

// 감사 10번(2026-08-07 세션N-8): 임계값 76/51/26을 여기서 복제하지 않는다.
//   `@repo/audit/geo-score`가 점수와 등급을 함께 정한다 — 화면·메일·OG 단일 진실.
function tierLabel(score: number): string {
  return TIER_LABEL_KO[scoreTier(score)];
}

// GEO 점수 = @repo/audit/geo-score 단일 진실(결과 페이지 UI와 동일 숫자).
// 이전에는 여기 별도 구현이 있어 UI(recognition 분모)와 다른 점수가 나갈 수 있었다.
function calcGeoScore(m: AuditMetrics): number {
  return geoAxisScores({
    ...m,
    averageMentionPosition: m.averageMentionPosition ?? null,
    sov: m.sov ?? 0,
  }).total;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as LeadBody;

  const email = body.email?.trim().toLowerCase();
  if (!(email && EMAIL_RE.test(email))) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  // ⚠️ 로그엔 **마스킹된** 주소만 남긴다(2026-08-08). 로그는 장기 보관되고 외부 수집기로
  //   흘러가므로 평문 이메일이 쌓이면 회수할 수 없다. 원본은 DB·발송에만 쓴다.
  log.info("lead.received", {
    jobId,
    email: maskEmail(email),
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

  // ⚠️ 아래 두 갈래는 리드 저장만 하고 **메일을 보내지 않는다** → `emailSent:false`.
  //   🔴 세션N-26: 예전에는 이 필드를 **아예 넣지 않았다.** 클라이언트가
  //   `?? false` 로 받아 우연히 맞았을 뿐, *"안 보냈다"* 를 말한 적은 없었다.
  //   응답이 **무엇을 했는지 스스로 말하게** 한다(암묵적 기본값에 기대지 않는다).
  if (!job || job.status !== "completed" || !job.result) {
    log.warn("lead.job_not_ready", { jobId });
    return NextResponse.json({
      ok: true,
      emailSent: false,
      message: "lead saved (job not ready)",
    });
  }

  // Resend 키 미설정 시 — 등록만 하고 종료
  if (!resend) {
    log.warn("lead.resend_not_configured", { jobId });
    return NextResponse.json({
      ok: true,
      emailSent: false,
      message: "lead saved (email skipped)",
    });
  }

  // 이메일 발송
  try {
    const result = job.result as unknown as AuditResult;
    const metrics = result.metrics ?? {
      enginesCovered: [],
      enginesWithMention: [],
    };
    const geoScore = calcGeoScore(metrics);
    const enginesMentioned = new Set(metrics.enginesWithMention).size;
    const enginesTotal = new Set(metrics.enginesCovered).size;

    const crew = job.crewResult as unknown as CrewResult | null;
    const topActions = (crew?.strategist?.output?.topActions ?? [])
      .slice(0, 3)
      .map((a) => ({
        rank: a.rank,
        title: a.title,
        timeframe: a.expectedTimeframe ?? "이번 주",
      }));

    // 🔴 (2026-07-30 플로우 감사) 결과 페이지(/ko/audit/[id])는 www에만 존재.
    //    APP_URL을 먼저 쓰면 리포트 메일의 "결과 보기"가 app.findable.co.kr 404로 발송된다.
    const baseUrl = process.env.NEXT_PUBLIC_WEB_URL ?? "https://findable.co.kr";

    const fromAddress = process.env.RESEND_FROM ?? "onboarding@resend.dev";
    const sendResult = await resend.emails.send({
      from: `Findable <${fromAddress}>`,
      to: email,
      subject: `[Findable] ${result.brandName ?? result.domain} GEO 점수 ${geoScore}/100 · ${tierLabel(geoScore)}`,
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

    log.info("lead.email_sent", {
      jobId,
      email: maskEmail(email),
      resendId: sendResult.data?.id,
    });
    return NextResponse.json({ ok: true, emailSent: true });
  } catch (emailErr) {
    log.error("lead.email_failed", { jobId, error: parseError(emailErr) });
    return NextResponse.json({ ok: true, emailSent: false });
  }
}
