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

import { randomUUID } from "node:crypto";
import { resolveBrandIdentity } from "@repo/ai/lib/brand-identity";
import type { CitedSource, EngineResponse } from "@repo/ai/lib/engines";
import { type aggregateAudit, queryAllEngines } from "@repo/ai/lib/engines";
import { BRIEFING_FAIL_PREFIX } from "@repo/ai/lib/engines/naver-briefing-adapter";
import { verifyMentions } from "@repo/ai/lib/mention-verdict";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { briefingCandidatePrompts } from "./briefing-query";
import { keys } from "./keys";
import { reconcileBriefingTracking } from "./reconcile-briefing-tracking";

interface BriefingRunInput {
  attemptId?: string;
  jobId: string;
  signal?: AbortSignal;
}

/**
 * **재시도해도 안 풀리는 실패인가** — 후보 질의 루프를 즉시 끊을지 판정한다.
 *
 * 🔴 세션N-39: 전에는 「브리핑 미노출」과 「크레딧 소진」을 구분 못 해, 크레딧이
 *   마른 상태에서도 후보 질의를 끝까지 돌며 **없는 크레딧을 3번 더 긁었다.**
 *   402(크레딧)·401(키)는 **사람이 조치해야** 풀리므로 재시도가 무의미하다.
 *
 * ⚠️ 429(속도제한)·5xx 는 **여기 넣지 않는다** — 잠시 뒤 재시도하면 풀리는데
 *   치명으로 분류하면 일시 장애에 측정을 통째로 포기하게 된다.
 *   (근거: Firecrawl 공식 문서 — 재시도 가능은 408·429·5xx)
 */
function isUnrecoverableBriefingFailure(
  errorMessage: string | null | undefined
): boolean {
  if (!errorMessage) {
    return false;
  }
  return (
    errorMessage.startsWith(BRIEFING_FAIL_PREFIX.credits) ||
    errorMessage.startsWith(BRIEFING_FAIL_PREFIX.auth)
  );
}

// runner.ts의 result 형태 (JSON deserialize 후). EngineId 브랜딩은 소실됨.
interface StoredEngineResponse {
  brandMentioned: boolean;
  /** crew-runner가 심층 출처 분석에 쓰는 측정 원본. 구 리포트에는 없다. */
  citedSources?: CitedSource[];
  durationMs: number;
  engineId: string;
  errorMessage: string | null;
  excerpt: string;
  isStub: boolean;
  /** 순위의 분모(세션N-10). 도입 전 저장분은 undefined → 복원 시 null. */
  mentionListSize?: number | null;
  mentionPosition: number | null;
  /** 본류와 같은 4분류 판정. 브리핑도 "미노출"과 "다른 대상으로 앎"을 뭉개지 않는다. */
  mentionQuality?: EngineResponse["mentionQuality"];
  promptIndex?: number;
  promptLang?: "ko" | "en";
  promptText?: string;
  rawResponse?: string;
  sentiment: "positive" | "neutral" | "negative" | null;
  shareOfVoice?: number | null;
  sov: number | null;
  trackingInputCaptured?: boolean;
  usage?: EngineResponse["usage"];
  /** 판정이 제외된 이유. 공개 리포트가 "모름"이라고 단정하지 않게 보존한다. */
  verdictReason?: "official_evidence_missing" | "judge_failed";
  verdictVia?: "rule" | "llm" | "skipped";
}

interface StoredResult {
  brandName: string;
  /** 브리핑 측정에 채택된 검색 질의 — 카드가 답변의 맥락을 설명하는 데 쓴다. */
  briefingPrompt?: string;
  briefingStatus?: "not_requested" | "processing" | "completed" | "failed";
  domain: string;
  engineResponses: StoredEngineResponse[];
  measurementContext?: {
    identityGrounded: boolean;
    officialSiteIdentity: {
      description?: string | null;
      finalUrl?: string;
      h1?: string | null;
      siteName?: string | null;
      title?: string | null;
    } | null;
  };
  metrics: ReturnType<typeof aggregateAudit>;
  promptsCount: number;
  topRecommendations: string[];
}

async function markBriefingStatus(
  jobId: string,
  attemptId: string,
  status: "failed"
): Promise<void> {
  await database.$executeRawUnsafe(
    `UPDATE "AuditJob"
     SET "result" = (jsonb_set(
       COALESCE("result", '{}'::jsonb),
       '{briefingStatus}',
       to_jsonb($1::text),
       true
     ) - 'briefingStartedAt' - 'briefingAttemptId')
     WHERE "id" = $2
       AND "result"->>'briefingStatus' = 'processing'
       AND "result"->>'briefingAttemptId' = $3`,
    status,
    jobId,
    attemptId
  );
}

export async function commitBriefingResult(
  jobId: string,
  attemptId: string,
  briefingResponses: StoredEngineResponse[],
  briefingPrompt: string,
  trackingStage: "pending" | "skipped"
): Promise<void> {
  const updated = await database.$executeRawUnsafe(
    `UPDATE "AuditJob"
     SET "postprocessing" = jsonb_set(
       COALESCE("postprocessing", '{}'::jsonb),
       '{briefingTracking}', to_jsonb($5::text), true),
         "result" = jsonb_set(
       jsonb_set(
         jsonb_set(
           COALESCE("result", '{}'::jsonb),
           '{engineResponses}',
           (
             SELECT COALESCE(jsonb_agg(row ORDER BY ord), '[]'::jsonb)
             FROM jsonb_array_elements(
               COALESCE("result"->'engineResponses', '[]'::jsonb)
             ) WITH ORDINALITY AS items(row, ord)
             WHERE row->>'engineId' IS DISTINCT FROM 'naver-briefing'
           ) || $1::jsonb,
           true
         ),
         '{briefingStatus}', to_jsonb('completed'::text), true
       ),
       '{briefingPrompt}', to_jsonb($2::text), true
       ) - 'briefingStartedAt' - 'briefingAttemptId'
       WHERE "id" = $3
       AND "result"->>'briefingStatus' = 'processing'
       AND "result"->>'briefingAttemptId' = $4
       AND jsonb_typeof(COALESCE("result"->'engineResponses', '[]'::jsonb)) = 'array'`,
    JSON.stringify(briefingResponses),
    briefingPrompt,
    jobId,
    attemptId,
    trackingStage
  );
  if (updated !== 1) {
    throw new Error("브리핑 상태 claim이 사라졌습니다.");
  }
}

type VerifiedBriefingResponse = EngineResponse & {
  mentionQuality?: NonNullable<EngineResponse["mentionQuality"]>;
  verdictReason?: "official_evidence_missing" | "judge_failed";
  verdictVia?: "rule" | "llm" | "skipped";
};

function toStoredEngineResponse(
  r: VerifiedBriefingResponse,
  promptIndex: number,
  promptText: string,
  promptLang: "ko" | "en"
): StoredEngineResponse {
  return {
    engineId: r.engineId,
    brandMentioned: r.brandMentioned,
    mentionPosition: r.mentionPosition,
    mentionListSize: r.mentionListSize,
    sentiment: r.sentiment,
    sov: r.shareOfVoice,
    durationMs: r.durationMs,
    isStub: r.isStub,
    errorMessage: r.errorMessage,
    citedSources: r.citedSources,
    mentionQuality: r.mentionQuality,
    verdictReason: r.verdictReason,
    verdictVia: r.verdictVia,
    // runner.ts의 excerpt 한도(4000자)와 정합. 브리핑 텍스트는 어댑터가 이미 4000자 캡.
    excerpt: r.rawResponse.slice(0, 4000),
    rawResponse: r.rawResponse,
    shareOfVoice: r.shareOfVoice,
    usage: r.usage,
    trackingInputCaptured: true,
    promptIndex,
    promptText,
    promptLang,
  };
}

/**
 * AuditJob의 기존 result에 네이버 AI 브리핑 측정을 추가하고 metrics 재계산 → DB 업데이트.
 */
export async function runBriefingForAuditJob(
  input: BriefingRunInput
): Promise<"completed" | "failed"> {
  const { jobId, signal } = input;
  const attemptId = input.attemptId ?? randomUUID();

  try {
    // Route가 이미 조건부 claim한 경우에는 그대로 사용한다. 본류 자동 실행처럼
    // attemptId가 없던 호출은 동일한 leaf-CAS 계약으로 claim을 만든다.
    if (!input.attemptId) {
      const claimed = await database.$executeRawUnsafe(
        `UPDATE "AuditJob"
         SET "result" = jsonb_set(
           jsonb_set(
             jsonb_set(COALESCE("result", '{}'::jsonb), '{briefingStatus}', to_jsonb('processing'::text), true),
             '{briefingAttemptId}', to_jsonb($2::text), true),
           '{briefingStartedAt}', to_jsonb($3::text), true)
         WHERE "id" = $1 AND "status" = 'completed'
           AND COALESCE("result"->>'briefingStatus', 'not_requested') IN ('not_requested', 'failed')`,
        jobId,
        attemptId,
        new Date().toISOString()
      );
      if (claimed !== 1) {
        throw new Error("브리핑 상태 claim을 획득하지 못했습니다.");
      }
    }

    const jobBefore = await database.auditJob.findUnique({
      where: { id: jobId },
      // 🔴 세션N-38: `organizationId`·`brandId` 를 함께 읽는다 — Tracking 적재용(아래 §시계열).
      select: {
        result: true,
        domain: true,
        language: true,
        industry: true,
        organizationId: true,
        brandId: true,
        completedAt: true,
      },
    });
    if (!jobBefore?.result) {
      throw new Error(
        "AuditJob.result가 비어있습니다. 빠른 모드 Audit이 먼저 완료되어야 합니다."
      );
    }
    const resultProcessing = jobBefore.result as unknown as StoredResult;

    // 네이버 AI 브리핑은 "정보/정답형" 질의에서만 노출된다(2026-07-23 실측).
    //   ✅ 노출: "{브랜드} 효과" · "{브랜드} 후기" · "{브랜드} 장단점"
    //   ❌ 미노출: "{브랜드} 추천/어때" · "{카테고리} 추천" · 경쟁사 추천형
    // 단일 질의는 미노출 위험이 있어 노출률 높은 순으로 여러 유형을 순차 시도하고
    // 브리핑이 실제로 뜬(errorMessage 없고 응답 존재) 첫 결과를 채택한다.
    // (Browserbase 무료 동시성 1이라 병렬 대신 순차 — 뜨면 즉시 중단해 호출 절약.)
    const language = jobBefore.language === "en" ? "en" : "ko";
    const brand = resultProcessing.brandName;
    // 언급 판정용 브랜드 변형 복원(2026-07-30 결함감사 §20): 기존엔 [brand] 하나만
    // 넘겨 원 측정 때의 한/영 변형이 소실됐고("엔비디아"만 남고 "NVIDIA" 없음),
    // 브리핑이 영문 표기로 답하면 명백한 언급도 false로 판정됐다.
    // 본 러너(runner.ts)와 동일한 해석 체인으로 변형을 복원한다.
    const identity = await resolveBrandIdentity(
      resultProcessing.domain,
      brand,
      signal
    );
    const brandVariants = [...new Set([brand, ...identity.brandVariants])];
    // 🔴 업종별 질의(2026-09-29) — B2B·서비스 회사에 「효과」를 묻지 않는다.
    //   고정 질의는 `briefing-query.ts` 로 옮겼다(뷰티·건강·단서 없음 = 기존 그대로).
    const candidatePrompts = briefingCandidatePrompts(brand, language, {
      industry: jobBefore.industry,
      site: resultProcessing.measurementContext?.officialSiteIdentity ?? null,
    });

    // 채택된 질의를 결과에 기록한다(전수감사 2026-08-02 §A-5).
    //   "SK하이닉스 후기" 답변이 왜 나왔는지 화면이 설명 못 해 사용자가
    //   "너가 이상한 걸 물어본 건가?"라고 물었다 — 질의를 보여주면 해소된다.
    let adoptedPrompt = candidatePrompts[0] as string;
    let briefingResponses = await queryAllEngines(
      {
        prompt: candidatePrompts[0],
        language,
        brandName: brand,
        brandVariants,
        signal,
      },
      ["naver-briefing"] as never
    );
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }

    // 첫 질의가 미노출이면 다음 후보로 재시도 (하나라도 뜨면 채택).
    for (let i = 1; i < candidatePrompts.length; i++) {
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      const first = briefingResponses[0];
      const shown =
        first &&
        !first.isStub &&
        !first.errorMessage &&
        first.rawResponse.length > 0;
      if (shown) {
        break;
      }
      // 🔴 재시도해도 안 풀리는 실패면 **즉시 멈춘다**(세션N-39).
      //   전에는 「미노출」과 「크레딧 소진」을 구분 못 해, 크레딧이 마른 상태에서도
      //   후보 질의를 끝까지 돌며 **없는 크레딧을 3번 더 긁었다**.
      if (isUnrecoverableBriefingFailure(first?.errorMessage)) {
        log.error("audit.briefing.firecrawl_blocked", {
          jobId,
          reason: first.errorMessage?.slice(0, 200),
          attemptedPrompts: i,
          hint: "Firecrawl 크레딧 충전 또는 FIRECRAWL_API_KEY 재설정이 필요합니다.",
        });
        break;
      }
      adoptedPrompt = candidatePrompts[i] as string;
      briefingResponses = await queryAllEngines(
        {
          prompt: candidatePrompts[i],
          language,
          brandName: brand,
          brandVariants,
          signal,
        },
        ["naver-briefing"] as never
      );
    }

    // 브리핑도 본류 측정과 같은 언급 판정을 통과한다. 이 경로만 문자열
    // 매칭을 그대로 쓰면 동명의 노래·학원·작품이 대시보드에 다시 확정 언급으로 쌓인다.
    briefingResponses = await verifyMentions(briefingResponses, {
      brandName: brand,
      brandDomain: resultProcessing.domain,
      industry: jobBefore.industry ?? undefined,
      officialSite:
        resultProcessing.measurementContext?.officialSiteIdentity ?? null,
    });

    // read-modify-write: crew 자동 실행 등으로 result가 바뀌었을 수 있어 최신 재조회.
    const jobAfter = await database.auditJob.findUnique({
      where: { id: jobId },
      select: { result: true },
    });
    if (!jobAfter?.result) {
      throw new Error("AuditJob.result가 사라졌습니다.");
    }
    const latest = jobAfter.result as unknown as StoredResult;

    const newStored = briefingResponses.map((response, index) =>
      toStoredEngineResponse(response, index, adoptedPrompt, language)
    );
    const briefing = newStored[0];
    const trackingStage =
      keys().AUDIT_DUAL_WRITE_ENABLED &&
      jobBefore.organizationId &&
      jobBefore.brandId &&
      jobBefore.completedAt &&
      briefing &&
      !briefing.isStub &&
      !briefing.errorMessage &&
      Boolean(briefing.rawResponse)
        ? "pending"
        : "skipped";
    await commitBriefingResult(
      jobId,
      attemptId,
      newStored,
      adoptedPrompt,
      trackingStage
    );

    log.info("audit.briefing.completed", {
      jobId,
      isStub: briefing?.isStub ?? true,
      brandMentioned: briefing?.brandMentioned ?? false,
      errorMessage: briefing?.errorMessage ?? null,
    });

    if (trackingStage === "pending") {
      await reconcileBriefingTracking(jobId);
    }
    return briefing && !briefing.isStub && !briefing.errorMessage
      ? "completed"
      : "failed";
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
        await markBriefingStatus(jobId, attemptId, "failed");
      }
    } catch (mergeErr) {
      log.error("audit.briefing.failed_status_merge_failed", {
        jobId,
        error: parseError(mergeErr),
      });
    }
    return "failed";
  }
}
