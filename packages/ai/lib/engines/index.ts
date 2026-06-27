// Findable 7 엔진 라우터 + 병렬 호출 오케스트레이터

import { chatgptWebAdapter } from "./chatgpt-web-adapter";
import {
  chatgptAdapter,
  claudeAdapter,
  geminiAdapter,
  perplexityAdapter,
} from "./global-adapters";
import {
  daumAdapter,
  hyperclovaAdapter,
  naverAdapter,
} from "./korean-adapters";
import { naverBriefingAdapter } from "./naver-briefing-adapter";
import type { EngineAdapter, EngineId, EngineQuery, EngineResponse } from "./types";

export * from "./types";

const ADAPTERS: Record<EngineId, EngineAdapter> = {
  chatgpt: chatgptAdapter,
  "chatgpt-web": chatgptWebAdapter,
  claude: claudeAdapter,
  perplexity: perplexityAdapter,
  gemini: geminiAdapter,
  hyperclova: hyperclovaAdapter,
  naver: naverAdapter,
  "naver-briefing": naverBriefingAdapter,
  daum: daumAdapter,
};

// 기본 7 엔진 (PRD §F2). chatgpt-web·naver-briefing은 옵션 (Stagehand 가능 환경에서만).
const DEFAULT_ENGINES: EngineId[] = [
  "chatgpt",
  "claude",
  "perplexity",
  "gemini",
  "hyperclova",
  "naver",
  "daum",
];

// 베타 8 엔진 (chatgpt-web 포함). UI에서 "베타" 라벨 표시.
// D-047 (2026-05-07): naver-briefing 추가 — 네이버 ① 점유율 방어 시너지.
export const BETA_ENGINES: EngineId[] = [...DEFAULT_ENGINES, "chatgpt-web", "naver-briefing"];

/**
 * 단일 엔진 호출.
 */
export async function queryEngine(query: EngineQuery): Promise<EngineResponse> {
  const adapter = ADAPTERS[query.engineId];
  if (!adapter) {
    return {
      engineId: query.engineId,
      rawResponse: "",
      brandMentioned: false,
      mentionPosition: null,
      sentiment: null,
      citedSources: [],
      shareOfVoice: null,
      errorMessage: `Unknown engine: ${query.engineId}`,
      durationMs: 0,
      isStub: false,
    };
  }
  return adapter(query);
}

/**
 * N개 엔진 병렬 호출. Promise.allSettled로 한 엔진 실패가 다른 엔진 막지 않게.
 *
 * 사용 예:
 *   await queryAllEngines({
 *     prompt: "여드름성 피부에 좋은 한국 화장품 추천",
 *     language: "ko",
 *     brandName: "메디큐브",
 *     brandVariants: ["Medicube", "메디큐브"],
 *   });
 */
export async function queryAllEngines(
  base: Omit<EngineQuery, "engineId">,
  engineIds: EngineId[] = DEFAULT_ENGINES
): Promise<EngineResponse[]> {
  const settled = await Promise.allSettled(
    engineIds.map((engineId) => queryEngine({ ...base, engineId }))
  );
  return settled.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    return {
      engineId: engineIds[i],
      rawResponse: "",
      brandMentioned: false,
      mentionPosition: null,
      sentiment: null,
      citedSources: [],
      shareOfVoice: null,
      errorMessage: result.reason instanceof Error ? result.reason.message : String(result.reason),
      durationMs: 0,
      isStub: false,
    };
  });
}

/**
 * 7 엔진 응답 집계 → Audit 결과 1페이지에 들어갈 메트릭 계산.
 */
export interface AuditMetrics {
  enginesCovered: EngineId[];
  enginesWithMention: EngineId[];
  sov: number; // 0~100, 7 엔진 평균 (mention 1개당 가중치)
  averageMentionPosition: number | null;
  sentimentDistribution: { positive: number; neutral: number; negative: number };
  topCitedDomains: Array<{ domain: string; count: number }>;
  errors: Array<{ engineId: EngineId; message: string }>;
  stubCount: number;
}

export function aggregateAudit(responses: EngineResponse[]): AuditMetrics {
  const enginesCovered = responses.map((r) => r.engineId);
  const enginesWithMention = responses.filter((r) => r.brandMentioned).map((r) => r.engineId);
  const positions = responses
    .map((r) => r.mentionPosition)
    .filter((p): p is number => p !== null);

  const sentiments = { positive: 0, neutral: 0, negative: 0 };
  for (const r of responses) {
    if (r.sentiment) sentiments[r.sentiment]++;
  }

  // 도메인 카운트
  const domainCount = new Map<string, number>();
  for (const r of responses) {
    for (const src of r.citedSources) {
      if (!src.domain) continue;
      domainCount.set(src.domain, (domainCount.get(src.domain) ?? 0) + 1);
    }
  }
  const topCitedDomains = Array.from(domainCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain, count]) => ({ domain, count }));

  const errors = responses
    .filter((r) => r.errorMessage)
    .map((r) => ({ engineId: r.engineId, message: r.errorMessage as string }));

  const stubCount = responses.filter((r) => r.isStub).length;

  // SoV = 전체 (엔진 × 프롬프트) 응답 중 우리 브랜드가 답변에 등장한 비율
  // 예: 7 엔진 × 4 프롬프트 = 28 응답 중 18 응답에서 등장 → 64%
  // 한 엔진이 4 프롬프트 중 1번만 등장하면 그 엔진은 "안정적이지 않은" 것으로 정직하게 반영.
  const successCount = responses.length - stubCount - errors.length;
  const sov =
    successCount === 0
      ? 0
      : Math.round((enginesWithMention.length / Math.max(successCount, 1)) * 100);

  return {
    enginesCovered,
    enginesWithMention,
    sov,
    averageMentionPosition:
      positions.length === 0
        ? null
        : Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10,
    sentimentDistribution: sentiments,
    topCitedDomains,
    errors,
    stubCount,
  };
}
