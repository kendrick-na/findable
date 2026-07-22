// 무료 Audit 잡 러너
//
// PRD §5.1 [F1] 무료 도메인 Audit — 콜드 영업 핵심 무기.
// 이메일 + 도메인 입력 → 30초~3분 내 PDF 다운로드.
//
// v1.0 구현:
//   - Vercel Functions의 after()로 응답 후 백그라운드 처리 (Vercel Queues는 v1.5)
//   - 7 엔진 (chatgpt-web 제외, 첫 베타는 안정적인 API만) 병렬 호출
//   - 30초 빠른 모드 (1페이지 PDF). 풀 모드 (10분, CrewAI 4 에이전트) 는 v1.0.5
//   - 결과 → AuditJob.result + pdfUrl 업데이트
//
// PDF 생성은 v1.0에서 일단 JSON 결과만 보여주고 PDF는 Day 4에 @vercel/og + Puppeteer.

import { aggregateAudit, queryAllEngines } from "@repo/ai/lib/engines";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { runCrewForAuditJob } from "./crew-runner";
import { generateAuditPdf } from "./pdf-generator";
import type { AuditPdfData } from "./pdf-template";

export interface AuditRunInput {
  jobId: string;
  domain: string;
  language: "ko" | "en" | "both";
  brandName?: string;
  brandVariants?: string[];
}

/**
 * 도메인에서 브랜드명 추출 — 임시 휴리스틱.
 * v1.5에서 GPT Researcher 또는 Claude로 정밀 추출.
 */
function inferBrandName(domain: string): string {
  const cleaned = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? domain;
  const tld = cleaned.split(".")[0] ?? cleaned;
  return tld.charAt(0).toUpperCase() + tld.slice(1);
}

/**
 * 도메인 + 언어 기반 자동 프롬프트 생성 — 무료 Audit 빠른 모드용 6개.
 * v1.0.5 풀 모드는 30~50개로 확장.
 */
function generateAuditPrompts(brandName: string, language: "ko" | "en" | "both"): Array<{ text: string; lang: "ko" | "en" }> {
  // 카테고리형 프롬프트 — 경쟁사 순위 측정 가능 (estimateMentionPosition이 작동)
  // 단일 브랜드형 — 브랜드 자체 sentiment·인용 측정용
  const ko = [
    `${brandName}와 같은 카테고리의 인기 브랜드 5가지 추천해줘`,
    `${brandName} 경쟁사 대표 브랜드를 순위로 알려줘`,
    `${brandName} 추천해줘`,
    `${brandName}의 장단점은?`,
  ];
  const en = [
    `Top 5 popular brands similar to ${brandName}`,
    `List ${brandName}'s main competitors in ranked order`,
    `What is ${brandName}?`,
    `Is ${brandName} worth buying?`,
  ];

  if (language === "ko") return ko.map((text) => ({ text, lang: "ko" as const }));
  if (language === "en") return en.map((text) => ({ text, lang: "en" as const }));
  return [
    ...ko.slice(0, 2).map((text) => ({ text, lang: "ko" as const })),
    ...en.slice(0, 2).map((text) => ({ text, lang: "en" as const })),
  ];
}

/**
 * 메인 진입점. background에서 호출.
 */
export async function runAuditJob(input: AuditRunInput): Promise<void> {
  const brandName = input.brandName ?? inferBrandName(input.domain);
  const brandVariants = input.brandVariants ?? [brandName];

  try {
    await database.auditJob.update({
      where: { id: input.jobId },
      data: { status: "processing" },
    });

    const prompts = generateAuditPrompts(brandName, input.language);

    // D-058 (2026-05-09) 분리 운영 구조:
    //   - 광고주 audit: 7 엔진 × 4 프롬프트 + AI 브리핑 1 프롬프트만 (베타)
    //     이유: AI 브리핑은 Browserbase 클라우드 크롬 사용 (느림 + 무료 티어 1동시)
    //     광고주 30초~3분 진단 약속 보호.
    //   - K-GEO-Bench 데이터셋: 별도 admin 스크립트로 4 프롬프트 모두 측정.

    const DEFAULT_7 = [
      "chatgpt",
      "claude",
      "perplexity",
      "gemini",
      "hyperclova",
      "naver",
      "daum",
    ] as const;

    // 7 엔진은 4 프롬프트 모두 병렬
    const sevenEngineResponses = await Promise.all(
      prompts.map((p) =>
        queryAllEngines(
          {
            prompt: p.text,
            language: p.lang,
            brandName,
            brandVariants,
          },
          DEFAULT_7 as unknown as Parameters<typeof queryAllEngines>[1]
        )
      )
    );

    // D-060 (2026-05-10) → D-2026-07-22 AI 브리핑 완전 분리 (on-demand 버튼):
    //   본류 audit는 항상 7 엔진만 호출한다. 30초~3분 진단 약속을 코드로 보장.
    //   네이버 AI 브리핑은 결과 페이지의 별도 버튼으로 on-demand 트리거된다
    //   (POST /api/audit/[jobId]/briefing → runBriefingForAuditJob).
    //   briefingStatus 기본값 "not_requested"로 초기화 → UI가 트리거 카드 표시.
    const flat = sevenEngineResponses.flat();
    const metrics = aggregateAudit(flat);

    const result = {
      brandName,
      domain: input.domain,
      promptsCount: prompts.length,
      briefingStatus: "not_requested" as const,
      engineResponses: flat.map((r) => ({
        engineId: r.engineId,
        brandMentioned: r.brandMentioned,
        mentionPosition: r.mentionPosition,
        sentiment: r.sentiment,
        sov: r.shareOfVoice,
        durationMs: r.durationMs,
        isStub: r.isStub,
        errorMessage: r.errorMessage,
        // D-051 (2026-05-07): 300 → 1500자 확장. 인터뷰관·광고주가 답변 본문 충분히 볼 수 있게.
        // DB 비용: 28 응답 × 1500 = 42KB/audit (감내 가능). orchestrator.ts는 별도 600자 사용.
        excerpt: r.rawResponse.slice(0, 1500),
      })),
      metrics,
      // Top 3 추천: 휴리스틱 v1.0. v1.5에 Princeton 8 strategies + AutoGEO로 정밀화.
      topRecommendations: buildTopRecommendations(metrics, brandName),
    };

    // PDF 생성 — 실패해도 result/status는 유지 (PDF는 부가 산출물)
    let pdfUrl: string | null = null;
    try {
      const pdfData: AuditPdfData = {
        ...result,
        language: input.language,
        generatedAt: new Date().toISOString().replace("T", " ").slice(0, 16),
      };
      const pdf = await generateAuditPdf(input.jobId, pdfData);
      pdfUrl = pdf.pdfUrl;
      log.info("audit.pdf.generated", { jobId: input.jobId, sizeKB: Math.round(pdf.pdfSize / 1024) });
    } catch (pdfError) {
      log.error("audit.pdf.failed", {
        jobId: input.jobId,
        error: parseError(pdfError),
      });
    }

    await database.auditJob.update({
      where: { id: input.jobId },
      data: {
        status: "completed",
        result: result as never,
        pdfUrl,
        completedAt: new Date(),
      },
    });
    log.info("audit.job.completed", { jobId: input.jobId, sov: metrics.sov });

    // Audit 완료 직후 4 에이전트 자동 실행 (D-2026-05-03 결정)
    // await로 묶어서 Vercel Functions 컨테이너가 crew 완료까지 살아있도록 한다.
    // fire-and-forget(.catch만)은 audit/route.ts의 after() 콜백이 끝나는 순간
    // 컨테이너가 종료되면서 crew 작업이 잘려나감. 실측에서 crewStatus가
    // not_requested로 남는 원인이 이 패턴이었음.
    try {
      await runCrewForAuditJob({ jobId: input.jobId });
    } catch (crewErr) {
      log.error("audit.crew.auto_trigger_failed", {
        jobId: input.jobId,
        error: parseError(crewErr),
      });
    }
  } catch (error) {
    log.error("audit.job.failed", {
      jobId: input.jobId,
      error: parseError(error),
    });
    await database.auditJob.update({
      where: { id: input.jobId },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      },
    });
  }
}

function buildTopRecommendations(
  metrics: ReturnType<typeof aggregateAudit>,
  brandName: string
): string[] {
  const recs: string[] = [];

  if (metrics.enginesWithMention.length === 0) {
    recs.push(
      `${brandName}이 7개 AI 엔진 중 어디에서도 언급되지 않았습니다. Wikipedia 한국어/영어 페이지 생성과 Common Crawl 인덱싱이 1순위 액션입니다.`
    );
  } else if (metrics.enginesWithMention.length < 4) {
    const missing = metrics.enginesCovered.filter(
      (id) => !metrics.enginesWithMention.includes(id)
    );
    recs.push(
      `${brandName}이 ${missing.join(", ")}에서 누락되었습니다. 해당 엔진의 학습 풀(${guessTrainingSource(missing)})에 콘텐츠 노출이 필요합니다.`
    );
  }

  if (metrics.averageMentionPosition && metrics.averageMentionPosition > 5) {
    recs.push(
      `평균 인용 순위 ${metrics.averageMentionPosition}위. Princeton GEO 알고리즘 기준 "Cite Sources / Quotation Addition / Statistics Addition" 전략으로 +40% 가시성 향상 가능합니다.`
    );
  }

  if (metrics.sentimentDistribution.negative > 0) {
    recs.push(
      `부정 sentiment ${metrics.sentimentDistribution.negative}건 발견. 부정 인용 출처(${metrics.topCitedDomains.slice(0, 3).map((d) => d.domain).join(", ")}) 모니터링과 긍정 콘텐츠 보강 필요합니다.`
    );
  }

  // 최소 1개 보장
  if (recs.length === 0) {
    recs.push(
      `${brandName}의 7 엔진 가시성이 양호합니다. 경쟁사 벤치마크와 sentiment 모니터링을 정기화하세요.`
    );
  }

  return recs.slice(0, 3);
}

function guessTrainingSource(engineIds: string[]): string {
  const sources = new Set<string>();
  for (const id of engineIds) {
    if (id === "hyperclova" || id === "naver") sources.add("네이버 블로그·뉴스");
    else if (id === "daum") sources.add("다음·카카오 콘텐츠");
    else sources.add("Wikipedia·Reddit·Common Crawl");
  }
  return Array.from(sources).join(", ");
}
