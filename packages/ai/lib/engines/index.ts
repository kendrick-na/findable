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
import type {
  EngineAdapter,
  EngineId,
  EngineQuery,
  EngineResponse,
} from "./types";

export * from "./cost";
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
export const BETA_ENGINES: EngineId[] = [
  ...DEFAULT_ENGINES,
  "chatgpt-web",
  "naver-briefing",
];

/**
 * 단일 엔진 호출.
 *
 * ⚠️ `async` 를 떼면 안 된다 — 미지원 엔진 분기가 **평문 객체**를 반환한다.
 *   `async` 가 그걸 Promise 로 감싸주고 있어서, 떼면 tsc TS2353 로 깨진다(실측).
 *   본문에 `await` 가 없는 건 어댑터 Promise 를 그대로 넘기기 때문이라 의도된 것이다.
 */
// biome-ignore lint/suspicious/useAwait: 평문 객체 조기반환을 async 가 Promise 로 감싼다(떼면 TS2353).
export async function queryEngine(query: EngineQuery): Promise<EngineResponse> {
  const adapter = ADAPTERS[query.engineId];
  if (!adapter) {
    return {
      engineId: query.engineId,
      rawResponse: "",
      brandMentioned: false,
      mentionPosition: null,
      mentionListSize: null,
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
    if (result.status === "fulfilled") {
      return result.value;
    }
    return {
      engineId: engineIds[i],
      rawResponse: "",
      brandMentioned: false,
      mentionPosition: null,
      mentionListSize: null,
      sentiment: null,
      citedSources: [],
      shareOfVoice: null,
      errorMessage:
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
      durationMs: 0,
      isStub: false,
    };
  });
}

/**
 * 7 엔진 응답 집계 → Audit 결과 1페이지에 들어갈 메트릭 계산.
 */
export interface AuditMetrics {
  /**
   * 순위가 나온 목록들의 평균 크기(분모). "평균 N개 중 M번째" 표기용.
   * 세션N-10(2026-08-07) 신설. 도입 전 측정분은 null.
   */
  averageMentionListSize: number | null;
  averageMentionPosition: number | null;
  /**
   * **상대 위치** 0~1 (0=목록 맨 앞, 1=맨 뒤). competition 채점의 입력.
   *   `(position - 1) / (listSize - 1)`, 단 listSize가 1이면 0(1개짜리 목록은 항상 맨 앞).
   * ⚠️ "평균순위 ÷ 평균목록크기"로 계산하면 안 된다 — 응답마다 목록 크기가 다르므로
   *   응답별로 먼저 비율을 낸 뒤 평균해야 한다(심슨의 역설 회피).
   * 도입 전 측정분은 null → 채점은 `averageMentionPosition` 폴백을 쓴다.
   */
  averageRelativePosition: number | null;
  enginesCovered: EngineId[];
  enginesWithMention: EngineId[];
  errors: Array<{ engineId: EngineId; message: string }>;
  sentimentDistribution: {
    positive: number;
    neutral: number;
    negative: number;
  };
  sov: number; // 0~100, 7 엔진 평균 (mention 1개당 가중치)
  stubCount: number;
  topCitedDomains: Array<{ domain: string; count: number }>;
}

export function aggregateAudit(responses: EngineResponse[]): AuditMetrics {
  const enginesCovered = responses.map((r) => r.engineId);
  const enginesWithMention = responses
    .filter((r) => r.brandMentioned)
    .map((r) => r.engineId);
  const positions = responses
    .map((r) => r.mentionPosition)
    .filter((p): p is number => p !== null);

  // 분모(목록 크기)가 함께 있는 응답만 상대 위치를 낼 수 있다.
  //   세션N-10 이전 측정분은 mentionListSize 가 null 이라 여기서 자연히 빠진다(소급 안전).
  const ranked = responses.filter(
    (
      r
    ): r is EngineResponse & {
      mentionListSize: number;
      mentionPosition: number;
    } => r.mentionPosition !== null && r.mentionListSize !== null
  );
  const relativePositions = ranked.map((r) =>
    r.mentionListSize <= 1
      ? 0
      : (r.mentionPosition - 1) / (r.mentionListSize - 1)
  );
  const listSizes = ranked.map((r) => r.mentionListSize);

  const sentiments = { positive: 0, neutral: 0, negative: 0 };
  for (const r of responses) {
    if (r.sentiment) {
      sentiments[r.sentiment]++;
    }
  }

  // 도메인 카운트
  const domainCount = new Map<string, number>();
  for (const r of responses) {
    for (const src of r.citedSources) {
      if (!src.domain) {
        continue;
      }
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

  // SoV = 측정 성공 응답 중 우리 브랜드가 답변에 등장한 비율(= presence rate).
  // 예: 7 엔진 × 4 프롬프트 = 28 응답 중 18 응답에서 등장 → 64%
  // 한 엔진이 4 프롬프트 중 1번만 등장하면 그 엔진은 "안정적이지 않은" 것으로 정직하게 반영.
  //
  // ⚠️ 2026-07-31 세션K: 이 값은 **경쟁 점유율이 아니라 등장률**이다. 업계(Profound·Otterly)는
  //   분모를 "브랜드가 하나라도 등장한 응답"으로 잡아 경쟁 대비로 만든다. 여기서 분모를 바꾸면
  //   기존 시계열이 전부 끊기므로, 등장률은 그대로 두고 **경쟁 점유율을 별도 지표로 추가**한다
  //   (competitiveSov). 표시·채점은 두 값을 구분해 쓴다.
  const successCount = responses.length - stubCount - errors.length;
  const sov =
    successCount === 0
      ? 0
      : Math.round(
          (enginesWithMention.length / Math.max(successCount, 1)) * 100
        );

  return {
    enginesCovered,
    enginesWithMention,
    sov,
    averageMentionPosition:
      positions.length === 0
        ? null
        : Math.round(
            (positions.reduce((a, b) => a + b, 0) / positions.length) * 10
          ) / 10,
    averageMentionListSize:
      listSizes.length === 0
        ? null
        : Math.round(
            (listSizes.reduce((a, b) => a + b, 0) / listSizes.length) * 10
          ) / 10,
    averageRelativePosition:
      relativePositions.length === 0
        ? null
        : Math.round(
            (relativePositions.reduce((a, b) => a + b, 0) /
              relativePositions.length) *
              100
          ) / 100,
    sentimentDistribution: sentiments,
    topCitedDomains,
    errors,
    stubCount,
  };
}
