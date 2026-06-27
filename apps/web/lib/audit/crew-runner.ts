// Crew 강화 모드 러너 — 4 에이전트 (민지·Alex·수진·준호) 순차 실행
//
// 트리거: 사용자가 무료 Audit 결과 페이지에서 "4 에이전트 분석 추가" 클릭
// 실행: AuditJob의 기존 engineResponses + metrics를 받아 crew 호출
// 출력: AuditJob.crewResult Json 필드에 4 에이전트 리포트 저장
//
// after()로 백그라운드 실행. 4 에이전트 호출은 2~10분 소요 가능.

import { runCrewDiagnose } from "@repo/ai/lib/crew";
import type { EngineResponse } from "@repo/ai/lib/engines";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";

interface CrewRunInput {
  jobId: string;
}

/**
 * AuditJob에서 빠른 모드 결과를 읽고 4 에이전트로 강화 분석 → DB 업데이트
 */
export async function runCrewForAuditJob(input: CrewRunInput): Promise<void> {
  const { jobId } = input;

  try {
    await database.auditJob.update({
      where: { id: jobId },
      data: { crewStatus: "processing", crewStartedAt: new Date() },
    });

    const job = await database.auditJob.findUnique({
      where: { id: jobId },
      select: { result: true, domain: true, language: true },
    });

    if (!job?.result) {
      throw new Error("AuditJob.result가 비어있습니다. 빠른 모드 Audit이 먼저 완료되어야 합니다.");
    }

    // 빠른 모드 result에서 crew 입력 데이터 추출
    const fastResult = job.result as unknown as {
      brandName: string;
      domain: string;
      engineResponses: Array<{
        engineId: string;
        brandMentioned: boolean;
        mentionPosition: number | null;
        sentiment: "positive" | "neutral" | "negative" | null;
        sov: number | null;
        durationMs: number;
        isStub: boolean;
        errorMessage: string | null;
        excerpt: string;
      }>;
      metrics: {
        enginesCovered: string[];
        enginesWithMention: string[];
        sov: number;
        averageMentionPosition: number | null;
        sentimentDistribution: { positive: number; neutral: number; negative: number };
        topCitedDomains: Array<{ domain: string; count: number }>;
        errors: Array<{ engineId: string; message: string }>;
        stubCount: number;
      };
    };

    // EngineResponse 형식으로 복원 (excerpt → rawResponse)
    const engineResponses: EngineResponse[] = fastResult.engineResponses.map((r) => ({
      engineId: r.engineId as EngineResponse["engineId"],
      rawResponse: r.excerpt,
      brandMentioned: r.brandMentioned,
      mentionPosition: r.mentionPosition,
      sentiment: r.sentiment,
      citedSources: [], // 빠른 모드 result에 도메인 카운트만 있어 출처 detail 손실 — v1.1에서 raw 보존
      shareOfVoice: r.sov,
      errorMessage: r.errorMessage,
      durationMs: r.durationMs,
      isStub: r.isStub,
    }));

    const crewReport = await runCrewDiagnose({
      brandName: fastResult.brandName,
      domain: fastResult.domain,
      // JSON deserialization loses EngineId branding — cast back. The IDs were
      // produced by our own engine adapters so they are valid by construction.
      metrics: fastResult.metrics as never,
      engineResponses,
    });

    await database.auditJob.update({
      where: { id: jobId },
      data: {
        crewStatus: "completed",
        crewResult: crewReport as never,
        crewCompletedAt: new Date(),
      },
    });

    log.info("audit.crew.completed", {
      jobId,
      isStub: crewReport.isStub,
      totalDurationMs: crewReport.totalDurationMs,
      analystCount: crewReport.analysts.length,
      strategistOk: Boolean(crewReport.strategist.output),
    });
  } catch (error) {
    log.error("audit.crew.failed", {
      jobId,
      error: parseError(error),
    });
    await database.auditJob.update({
      where: { id: jobId },
      data: {
        crewStatus: "failed",
        crewCompletedAt: new Date(),
      },
    });
  }
}
