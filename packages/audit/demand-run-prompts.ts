// 러너의 「이름 없는 질문」 자리를 실제 수요 기반 질문으로 채운다 (MEASUREMENT_DEMAND_PROMPTS).
//
// 계약
//   · 플래그 꺼짐·스텁 실행·예산 부족·외부 데이터 실패·질문 0개 → null = 러너는 기존 경로 그대로.
//   · 자리 수는 기존 상한(MAX_DISCOVERY_PROMPTS)을 그대로 쓴다 → 브랜드 이름 질문 수·점수 무변경.
//   · 남는 자리는 기존 사이트 기반 질문으로 채운다(중복 문장 제외).
//   · 수집 시간에 상한을 둔다(DEMAND_PROMPTS_TIMEOUT_MS). 질문 시작 마감(run-budget)을 먹지 않도록
//     러너는 남은 예산이 충분할 때만 이 단계를 시작한다.

import { log } from "@repo/observability/log";
import type { RunPrompt } from "./audit-prompts";
import {
  type DemandQuestionSet,
  demandMarketsFor,
  selectDemandRunQuestions,
} from "./demand-prompts";
import {
  type DemandResolution,
  type ResolveDemandInput,
  resolveDemandQuestionSet,
} from "./demand-prompts-live";
import type { MarketScope } from "./market-scope";

export const DEMAND_PROMPTS_TIMEOUT_MS = 15_000;

export interface DemandDiscoveryArgs {
  brandNames: ResolveDemandInput["brandNames"];
  domain: string;
  /** 같은 회차의 기존 사이트 기반 이름 없는 질문 — 남는 자리를 채운다. */
  fallback: readonly RunPrompt[];
  language: "ko" | "en" | "both";
  limit: number;
  otherBrandNames?: readonly string[];
  resolve?: (input: ResolveDemandInput) => Promise<DemandResolution>;
  scope: MarketScope;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface DemandDiscovery {
  prompts: RunPrompt[];
  set: DemandQuestionSet;
}

export async function resolveDemandDiscovery(
  args: DemandDiscoveryArgs
): Promise<DemandDiscovery | null> {
  const markets = demandMarketsFor(args.language, args.scope);
  if (markets.length === 0 || args.limit <= 0) {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    args.timeoutMs ?? DEMAND_PROMPTS_TIMEOUT_MS
  );
  timer.unref?.();
  const onAbort = () => controller.abort();
  args.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const { set } = await (args.resolve ?? resolveDemandQuestionSet)({
      domain: args.domain,
      brandNames: args.brandNames,
      markets,
      otherBrandNames: args.otherBrandNames,
      signal: controller.signal,
    });
    const picked = selectDemandRunQuestions(set, markets, args.limit);
    if (picked.length === 0) {
      return null;
    }
    const prompts: RunPrompt[] = picked.map((q) => ({
      kind: "discovery",
      lang: q.lang,
      text: q.text,
      demand: {
        market: q.market,
        topic: q.topic,
        keyword: q.keyword,
        volume: q.volume,
        source: q.source,
        expanded: q.expanded,
      },
    }));
    const texts = new Set(prompts.map((p) => p.text));
    for (const p of args.fallback) {
      if (prompts.length >= args.limit) {
        break;
      }
      if (!texts.has(p.text)) {
        texts.add(p.text);
        prompts.push(p);
      }
    }
    return { prompts, set };
  } catch (error) {
    log.warn("audit.demand_prompts.failed", {
      domain: args.domain,
      error: error instanceof Error ? error.name : "unknown",
    });
    return null;
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", onAbort);
  }
}
