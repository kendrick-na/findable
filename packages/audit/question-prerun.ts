import {
  extractCompetitorLandscape,
  type KnownCompetitor,
} from "./competitor-extract";
import { keys } from "./keys";
import { isVercelPreview } from "./preview-guard";

/**
 * 질문 사전 실행 검증(2026-10-14 · 대표 승인).
 *
 * 고객이 추적할 질문을 고르는 화면에서, 고른 질문을 엔진 1곳에 1번 돌려 **답변에 브랜드가 몇 개 나열되는지** 보여 준다.
 * 브랜드가 한 곳도 안 나오는 질문은 "브랜드가 안 나와요" 표시만 한다 — **자동으로 지우지 않고 저장·점수에도 반영하지 않는다.**
 * 답변은 매번 달라서 "이번 1번 기준"일 뿐이다(화면 문구도 그렇게 밝힌다).
 *
 * 기본 off(`QUESTION_PRERUN_ENABLED=true`), Vercel Preview 에서는 켜져 있어도 실행하지 않는다.
 */

export const PRERUN_ENGINE = "gemini" as const;
export const PRERUN_MAX_QUESTIONS = 20;
const CONCURRENCY = 4;
const CALL_TIMEOUT_MS = 45_000;
const HANGUL_RE = /[가-힣]/;

export interface PrerunSignal {
  /** 나열된 서로 다른 브랜드 수(번호 목록 기준). */
  brandsListed: number;
  /** 호출이 실패했거나 가짜(스텁) 응답이라 판단할 수 없다. */
  error?: boolean;
  /** 우리 브랜드가 답변에 나왔는가(참고). */
  ours: boolean;
  text: string;
}

export type PrerunRunner = (input: {
  language: "en" | "ko";
  prompt: string;
  signal: AbortSignal;
}) => Promise<{
  errorMessage: string | null;
  isStub: boolean;
  rawResponse: string;
}>;

export function isQuestionPrerunEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return keys().QUESTION_PRERUN_ENABLED === true && !isVercelPreview(env);
}

/** 답변 한 개에서 신호를 만든다(순수 함수). */
export function signalOfAnswer(
  text: string,
  rawResponse: string,
  brand: {
    competitors?: readonly (KnownCompetitor | string)[];
    name: string;
    variants?: readonly string[];
  }
): PrerunSignal {
  const landscape = extractCompetitorLandscape(
    [rawResponse],
    brand.name,
    [...(brand.variants ?? [])],
    [...(brand.competitors ?? [])]
  );
  return {
    text,
    brandsListed: landscape.ranking.length,
    ours: landscape.brandFound,
  };
}

/** 질문들을 엔진 1곳에 돌려 신호를 돌려준다. 호출 실패는 그 질문만 error 로 표시한다(던지지 않는다). */
export async function prerunQuestions(
  questions: readonly string[],
  brand: {
    competitors?: readonly (KnownCompetitor | string)[];
    name: string;
    variants?: readonly string[];
  },
  run: PrerunRunner
): Promise<PrerunSignal[]> {
  const list = questions.slice(0, PRERUN_MAX_QUESTIONS);
  const out: PrerunSignal[] = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const index = next++;
      const text = list[index] as string;
      try {
        const result = await run({
          language: HANGUL_RE.test(text) ? "ko" : "en",
          prompt: text,
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
        out[index] =
          result.errorMessage || result.isStub || !result.rawResponse
            ? { text, brandsListed: 0, ours: false, error: true }
            : signalOfAnswer(text, result.rawResponse, brand);
      } catch {
        out[index] = { text, brandsListed: 0, ours: false, error: true };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker)
  );
  return out;
}
