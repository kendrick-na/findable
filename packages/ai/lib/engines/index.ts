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
export * from "./aggregate";
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
