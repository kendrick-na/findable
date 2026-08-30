// Crew 강화 모드 러너 — 4 에이전트 (민지·Alex·수진·준호) 순차 실행
//
// 트리거: 사용자가 무료 Audit 결과 페이지에서 "4 에이전트 분석 추가" 클릭
// 실행: AuditJob의 기존 engineResponses + metrics를 받아 crew 호출
// 출력: AuditJob.crewResult Json 필드에 4 에이전트 리포트 저장
//
// after()로 백그라운드 실행. 4 에이전트 호출은 2~10분 소요 가능.

import { runCrewDiagnose } from "@repo/ai/lib/crew";
import type { CitedSource, EngineResponse } from "@repo/ai/lib/engines";
import { resolveIndustryProfile } from "@repo/ai/lib/industry-profile";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";

interface CrewRunInput {
  jobId: string;
}

// crew 4 에이전트 실행 상한. 초과 시 실패 처리해 crewStatus가 processing에
// 영구 고정되지 않게 한다.
//
// ⚠️ 계층 정합(라이브 stuck 물리적 원인 수정, 2026-07-28):
//   CREW_TIMEOUT_MS(270s) < 함수 maxDuration(300s, vercel.json·route) < route STALE_AFTER_MS(900s)
//   → 함수가 Vercel에 kill 되기 전에 여기서 먼저 timeout 나서 crewStatus=failed 로 정리(30s 마진=DB update 시간).
//   과거 720s(>300s 함수상한)라 함수가 먼저 죽어 processing 영구고정됐음(가드 무용지물).
//   그래도 못 잡는 잔여(함수 급사)는 route STALE_AFTER_MS(15분) 재실행 + stuck 스윕 cron이 최종 안전망.
const CREW_TIMEOUT_MS = 270 * 1000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} 타임아웃 (${ms}ms 초과)`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
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
      // industry: 업종 편향 수정(2026-08-02). language: 구조감사 F9 —
      //   기존엔 SELECT 만 하고 crew 로 넘기지 않는 dead read 였다.
      select: {
        result: true,
        domain: true,
        language: true,
        industry: true,
      },
    });

    if (!job?.result) {
      throw new Error(
        "AuditJob.result가 비어있습니다. 빠른 모드 Audit이 먼저 완료되어야 합니다."
      );
    }

    // 빠른 모드 result에서 crew 입력 데이터 추출
    const fastResult = job.result as unknown as {
      brandName: string;
      domain: string;
      engineResponses: Array<{
        engineId: string;
        brandMentioned: boolean;
        mentionPosition: number | null;
        /** 순위의 분모(세션N-10). 도입 전 저장분은 undefined. */
        mentionListSize?: number | null;
        sentiment: "positive" | "neutral" | "negative" | null;
        sov: number | null;
        durationMs: number;
        isStub: boolean;
        errorMessage: string | null;
        excerpt: string;
        citedSources?: CitedSource[];
      }>;
      metrics: {
        enginesCovered: string[];
        enginesWithMention: string[];
        sov: number;
        averageMentionPosition: number | null;
        sentimentDistribution: {
          positive: number;
          neutral: number;
          negative: number;
        };
        topCitedDomains: Array<{ domain: string; count: number }>;
        errors: Array<{ engineId: string; message: string }>;
        stubCount: number;
      };
    };

    // EngineResponse 형식으로 복원 (excerpt → rawResponse)
    const engineResponses: EngineResponse[] = fastResult.engineResponses.map(
      (r) => ({
        engineId: r.engineId as EngineResponse["engineId"],
        rawResponse: r.excerpt,
        brandMentioned: r.brandMentioned,
        mentionPosition: r.mentionPosition,
        // 분모를 빠뜨리면 crew 재집계 때 상대위치가 사라져 점수가 조용히 내려간다.
        mentionListSize: r.mentionListSize ?? null,
        sentiment: r.sentiment,
        // 구 버전 리포트에는 이 필드가 없으므로 빈 배열로 안전하게 폴백한다.
        // 새 측정은 runner가 원본 출처를 보존해 수진 분석의 근거가 된다.
        citedSources: r.citedSources ?? [],
        shareOfVoice: r.sov,
        errorMessage: r.errorMessage,
        durationMs: r.durationMs,
        isStub: r.isStub,
      })
    );

    // 업종 판정(2026-08-02) — 반도체 회사에 화장품 채널 처방이 나가던 사고의 수정.
    //   저장된 industry 가 있으면 그것을, 없으면 도메인으로 추론한다(사전→LLM→미확인).
    //   실패해도 "업종 미확인" 프로파일로 안전하게 동작한다.
    const industryProfile = await resolveIndustryProfile(
      fastResult.domain,
      job.industry,
      fastResult.brandName
    );

    const crewReport = await withTimeout(
      runCrewDiagnose({
        brandName: fastResult.brandName,
        domain: fastResult.domain,
        // JSON deserialization loses EngineId branding — cast back. The IDs were
        // produced by our own engine adapters so they are valid by construction.
        metrics: fastResult.metrics as never,
        engineResponses,
        industryProfile,
        language: job.language,
      }),
      CREW_TIMEOUT_MS,
      "runCrewDiagnose"
    );

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
      // 특정 분석가만 비는 문제를 원문·프롬프트 없이 운영 로그에서 바로 판별한다.
      analystStates: crewReport.analysts.map((analyst) => ({
        agentId: analyst.agentId,
        hasOutput: Boolean(analyst.output),
        hasRawText: Boolean(analyst.rawText),
        hasError: Boolean(analyst.errorMessage),
      })),
      strategistOk: Boolean(crewReport.strategist.output),
      // 자기평가 1패스 관측(2026-08-09). 이게 없으면 재작성이 실제로 도는지·채택되는지
      // 알 수 없다 — 같은 저장소가 `mentionQuality`·`promptStats` 를 계산만 하고 버려
      // 품질을 아무도 몰랐던 전례가 있다.
      refineAttempted: crewReport.refinement?.attempted ?? false,
      refineApplied: crewReport.refinement?.applied ?? false,
      refineViolations: crewReport.refinement?.violationCount ?? 0,
      refineDurationMs: crewReport.refinement?.durationMs ?? 0,
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
