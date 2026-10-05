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

export * from "./aggregate";
export * from "./cost";
export { NAVER_SEARCH_SAMPLING_VERSION } from "./korean-adapters";
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

// 기본 엔진 (PRD §F2). chatgpt-web·naver-briefing은 옵션 (Stagehand 가능 환경에서만).
// ⛔ 2026-09-29: hyperclova 제외 — 네이버 클로바X·Cue: 서비스 종료(2026-04-09) · 👤 대표 결정.
//   어댑터·EngineId 는 과거 측정 표시 호환을 위해 남긴다(신규 측정엔 안 돈다).
export const DEFAULT_ENGINES: readonly EngineId[] = [
  "chatgpt",
  "claude",
  "perplexity",
  "gemini",
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
 * LLM 엔진 1회 호출 상한(2026-10-06). 운영 실측: Claude 한 번이 114.8초·161초 걸려
 *   측정 전체가 285초가 되거나 판정 단계에서 시간 초과로 실패했다.
 *   최근 14일 정상 응답 2,700여 건 중 60초 초과는 7건(약 0.3%)뿐이다.
 *   넘으면 그 응답만 기존 엔진 오류와 똑같이 errorMessage 로 남기고 측정은 계속한다.
 *   검색 엔진(naver·daum)·브라우저 엔진(chatgpt-web·naver-briefing)은 자체 상한을 쓴다.
 */
export const ENGINE_CALL_TIMEOUT_MS: Partial<Record<EngineId, number>> = {
  chatgpt: 60_000,
  claude: 60_000,
  gemini: 60_000,
  perplexity: 60_000,
};

export class EngineTimeoutError extends Error {
  readonly elapsedMs: number;
  constructor(engineId: EngineId, timeoutMs: number, elapsedMs: number) {
    super(`Engine ${engineId} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.elapsedMs = elapsedMs;
  }
}

/**
 * 엔진 1회 호출에 개별 상한을 건다. 상한이 되면 어댑터에 넘긴 signal 을 끊어(실제 호출 취소)
 * EngineTimeoutError 로 거절한다. 바깥 signal(측정 마감)이 끊기면 그 사유를 그대로 따른다.
 */
function queryEngineWithTimeout(
  query: EngineQuery,
  timeoutMs: number | undefined
): Promise<EngineResponse> {
  if (!timeoutMs) {
    return queryEngine(query);
  }
  const started = Date.now();
  const controller = new AbortController();
  const parent = query.signal;
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) {
    controller.abort(parent.reason);
  } else {
    parent?.addEventListener("abort", onParentAbort, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new EngineTimeoutError(
        query.engineId,
        timeoutMs,
        Date.now() - started
      );
      controller.abort(error);
      reject(error);
    }, timeoutMs);
    timer.unref?.();
  });
  return Promise.race([
    queryEngine({ ...query, signal: controller.signal }),
    timeout,
  ]).finally(() => {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
  });
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
  engineIds: readonly EngineId[] = DEFAULT_ENGINES,
  onEngineEvent?: (event: {
    engineId: EngineId;
    phase: "started" | "finished";
    status?: "fulfilled" | "rejected";
  }) => void
): Promise<EngineResponse[]> {
  const observe = (event: {
    engineId: EngineId;
    phase: "started" | "finished";
    status?: "fulfilled" | "rejected";
  }) => {
    try {
      onEngineEvent?.(event);
    } catch {
      /* logging is best-effort */
    }
  };
  const settled = await Promise.allSettled(
    engineIds.map(async (engineId) => {
      observe({ engineId, phase: "started" });
      try {
        const response = await queryEngineWithTimeout(
          { ...base, engineId },
          ENGINE_CALL_TIMEOUT_MS[engineId]
        );
        observe({ engineId, phase: "finished", status: "fulfilled" });
        return response;
      } catch (error) {
        observe({ engineId, phase: "finished", status: "rejected" });
        throw error;
      }
    })
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
      // 개별 상한으로 끊긴 호출은 실제 대기 시간을 남긴다(운영 지연 진단용).
      durationMs:
        result.reason instanceof EngineTimeoutError
          ? result.reason.elapsedMs
          : 0,
      isStub: false,
    };
  });
}
