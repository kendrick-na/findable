// 네이버 AI 브리핑 on-demand 러너 (D-2026-07-22)
//
// 트리거: 사용자가 무료 Audit 결과 페이지에서 "네이버 AI 브리핑 측정" 클릭
// 실행: AuditJob의 기존 result에 naver-briefing 엔진 응답 1개를 추가 측정
// 출력: AuditJob.result JSON에 engineResponse append + metrics 재계산
//       + briefingStatus="completed"
//
// after()로 백그라운드 실행. Browserbase 클라우드 크롬 사용 (느림 + 무료 티어 1동시)
// 이라 본류 7 엔진과 분리해 on-demand로만 호출한다.
//
// crew-runner.ts 구조 미러. 단, crewResult는 별도 컬럼이라 단순 write지만
// briefingStatus·engineResponses는 result JSON을 공유하므로 read-modify-write
// (최신 result 재조회 후 병합)로 다른 필드 덮어쓰기를 막는다.

import type { EngineResponse } from "@repo/ai/lib/engines";
import { aggregateAudit, queryAllEngines } from "@repo/ai/lib/engines";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";

interface BriefingRunInput {
  jobId: string;
}

// runner.ts의 result 형태 (JSON deserialize 후). EngineId 브랜딩은 소실됨.
interface StoredEngineResponse {
  brandMentioned: boolean;
  durationMs: number;
  engineId: string;
  errorMessage: string | null;
  excerpt: string;
  isStub: boolean;
  mentionPosition: number | null;
  sentiment: "positive" | "neutral" | "negative" | null;
  sov: number | null;
}

interface StoredResult {
  brandName: string;
  briefingStatus?: "not_requested" | "processing" | "completed" | "failed";
  domain: string;
  engineResponses: StoredEngineResponse[];
  metrics: ReturnType<typeof aggregateAudit>;
  promptsCount: number;
  topRecommendations: string[];
}

/**
 * StoredEngineResponse[] → EngineResponse[] 복원 (aggregateAudit 입력용).
 * 빠른 모드 result에는 도메인 카운트만 있어 citedSources detail은 손실됨.
 */
function toEngineResponses(stored: StoredEngineResponse[]): EngineResponse[] {
  return stored.map((r) => ({
    // JSON deserialization loses EngineId branding — cast back. The IDs were
    // produced by our own engine adapters so they are valid by construction.
    engineId: r.engineId as never,
    rawResponse: r.excerpt,
    brandMentioned: r.brandMentioned,
    mentionPosition: r.mentionPosition,
    sentiment: r.sentiment,
    citedSources: [],
    shareOfVoice: r.sov,
    errorMessage: r.errorMessage,
    durationMs: r.durationMs,
    isStub: r.isStub,
  }));
}

function toStoredEngineResponse(r: EngineResponse): StoredEngineResponse {
  return {
    engineId: r.engineId,
    brandMentioned: r.brandMentioned,
    mentionPosition: r.mentionPosition,
    sentiment: r.sentiment,
    sov: r.shareOfVoice,
    durationMs: r.durationMs,
    isStub: r.isStub,
    errorMessage: r.errorMessage,
    // runner.ts와 동일하게 1500자 excerpt.
    excerpt: r.rawResponse.slice(0, 1500),
  };
}

/**
 * AuditJob의 기존 result에 네이버 AI 브리핑 측정을 추가하고 metrics 재계산 → DB 업데이트.
 */
export async function runBriefingForAuditJob(
  input: BriefingRunInput
): Promise<void> {
  const { jobId } = input;

  try {
    // processing 상태로 전환 — result JSON은 공유하므로 최신 재조회 후 병합.
    const jobBefore = await database.auditJob.findUnique({
      where: { id: jobId },
      select: { result: true, domain: true, language: true },
    });
    if (!jobBefore?.result) {
      throw new Error(
        "AuditJob.result가 비어있습니다. 빠른 모드 Audit이 먼저 완료되어야 합니다."
      );
    }
    const resultProcessing = jobBefore.result as unknown as StoredResult;
    await database.auditJob.update({
      where: { id: jobId },
      data: {
        result: { ...resultProcessing, briefingStatus: "processing" } as never,
      },
    });

    // 첫 프롬프트 = 카테고리형 (경쟁사 순위 측정 가능). runner.ts generateAuditPrompts와 동일 톤.
    const language = jobBefore.language === "en" ? "en" : "ko";
    const firstPrompt =
      language === "en"
        ? `Top 5 popular brands similar to ${resultProcessing.brandName}`
        : `${resultProcessing.brandName}와 같은 카테고리의 인기 브랜드 5가지 추천해줘`;

    const briefingResponses = await queryAllEngines(
      {
        prompt: firstPrompt,
        language,
        brandName: resultProcessing.brandName,
        brandVariants: [resultProcessing.brandName],
      },
      ["naver-briefing"] as never
    );

    // read-modify-write: crew 자동 실행 등으로 result가 바뀌었을 수 있어 최신 재조회.
    const jobAfter = await database.auditJob.findUnique({
      where: { id: jobId },
      select: { result: true },
    });
    if (!jobAfter?.result) {
      throw new Error("AuditJob.result가 사라졌습니다.");
    }
    const latest = jobAfter.result as unknown as StoredResult;

    // naver-briefing 기존 응답 제거 후 새 응답 append (중복 방지 / 재측정 반영).
    const withoutBriefing = latest.engineResponses.filter(
      (r) => r.engineId !== "naver-briefing"
    );
    const newStored = briefingResponses.map(toStoredEngineResponse);
    const mergedStored = [...withoutBriefing, ...newStored];

    // metrics 재계산 — 전체 engineResponses 기준.
    const metrics = aggregateAudit(toEngineResponses(mergedStored));

    const mergedResult: StoredResult = {
      ...latest,
      briefingStatus: "completed",
      engineResponses: mergedStored,
      metrics,
    };

    await database.auditJob.update({
      where: { id: jobId },
      data: { result: mergedResult as never },
    });

    const briefing = newStored[0];
    log.info("audit.briefing.completed", {
      jobId,
      isStub: briefing?.isStub ?? true,
      brandMentioned: briefing?.brandMentioned ?? false,
      errorMessage: briefing?.errorMessage ?? null,
    });
  } catch (error) {
    log.error("audit.briefing.failed", {
      jobId,
      error: parseError(error),
    });
    // 실패 상태 병합 — 최신 result 재조회 후 briefingStatus만 갱신.
    try {
      const jobFail = await database.auditJob.findUnique({
        where: { id: jobId },
        select: { result: true },
      });
      if (jobFail?.result) {
        const latest = jobFail.result as unknown as StoredResult;
        await database.auditJob.update({
          where: { id: jobId },
          data: { result: { ...latest, briefingStatus: "failed" } as never },
        });
      }
    } catch (mergeErr) {
      log.error("audit.briefing.failed_status_merge_failed", {
        jobId,
        error: parseError(mergeErr),
      });
    }
  }
}
