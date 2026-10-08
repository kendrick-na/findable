// 실제 수요 기반 질문 — 외부 데이터 수집(공식몰·네이버 키워드도구·구글 키워드 플래너)
// (2026-10-06, 측정 알고리즘 v3 §2-③). 계산은 `demand-prompts.ts`(순수)가 한다.
//
// ⛔ 실패해도 측정을 막지 않는다: 어느 출처든 실패하면 그 시장은 빈 목록 → 러너는 기존
//   사이트 기반 질문으로 돌아간다. 키가 없는 출처는 「꺼짐」이지 오류가 아니다.
// ⛔ 네이버 지식iN 은 **쓰지 않는다**(2026-10-07 대표 결정 · 법무 검토 대기): 네이버 Open API
//   이용약관이 검색 결과를 AI 입력·검색 결과 표시 외 용도로 쓰는 것을 금한다. 말투 기준(styleAnchors)
//   으로 쓰던 kinTitles 호출을 지웠다 — 말투는 지식iN 이 없을 때의 기본값(반말 대화체)으로 고정된다.
//   법무 검토 전에는 되살리지 않는다.

import { log } from "@repo/observability/log";
import { type BrandCatalog, resolveBrandCatalog } from "./brand-catalog";
import {
  catalogVocabulary,
  type DemandKeyword,
  type DemandMarket,
  type DemandQuestionSet,
  demandSeedKeywords,
  generateDemandQuestions,
} from "./demand-prompts";
import { fetchGoogleKeywordIdeas } from "./google-keywords";
import { fetchNaverKeywordVolumes } from "./naver-keywords";

export interface DemandSourceDeps {
  catalog: (domain: string, signal?: AbortSignal) => Promise<BrandCatalog>;
  googleIdeas: (
    seeds: string[],
    signal?: AbortSignal
  ) => Promise<DemandKeyword[] | null>;
  naverVolumes: (
    seeds: string[],
    signal?: AbortSignal
  ) => Promise<DemandKeyword[] | null>;
}

export const liveDemandSourceDeps: DemandSourceDeps = {
  catalog: resolveBrandCatalog,
  naverVolumes: async (seeds, signal) => {
    const rows = await fetchNaverKeywordVolumes(seeds, undefined, signal);
    return rows
      ? rows.map((r) => ({
          keyword: r.keyword,
          volume: r.total,
          lowVolume: r.lowVolume,
          source: "naver" as const,
        }))
      : null;
  },
  googleIdeas: async (seeds, signal) => {
    const rows = await fetchGoogleKeywordIdeas(seeds, "US", undefined, signal);
    return rows
      ? rows.map((r) => ({
          keyword: r.keyword,
          volume: r.volume,
          source: "google" as const,
        }))
      : null;
  },
};

export interface ResolveDemandInput {
  brandNames: { en?: string | null; ko: string; variants?: readonly string[] };
  domain: string;
  markets: readonly DemandMarket[];
  maxPerMarket?: number;
  otherBrandNames?: readonly string[];
  signal?: AbortSignal;
}

export interface DemandResolution {
  diagnostics: {
    catalogProducts: number;
    catalogSource: BrandCatalog["source"];
    keywords: Partial<Record<DemandMarket, number | null>>;
    seeds: Record<DemandMarket, string[]>;
  };
  set: DemandQuestionSet;
}

export async function resolveDemandQuestionSet(
  input: ResolveDemandInput,
  deps: DemandSourceDeps = liveDemandSourceDeps
): Promise<DemandResolution> {
  const allNames = [
    input.brandNames.ko,
    input.brandNames.en ?? "",
    ...(input.brandNames.variants ?? []),
  ].filter((n) => n.trim().length >= 2);
  const catalog = await deps.catalog(input.domain, input.signal);
  const vocabulary = catalogVocabulary(catalog.products, allNames);
  const seeds = demandSeedKeywords(vocabulary, {
    ko: input.brandNames.ko,
    en: input.brandNames.en ?? null,
  });
  const hasVocabulary = vocabulary.heads.size > 0;
  const wants = (m: DemandMarket) => hasVocabulary && input.markets.includes(m);

  const [kr, us] = await Promise.all([
    wants("KR") ? deps.naverVolumes(seeds.KR, input.signal) : null,
    wants("US") ? deps.googleIdeas(seeds.US, input.signal) : null,
  ]);

  const set = generateDemandQuestions({
    brandNames: allNames,
    otherBrandNames: input.otherBrandNames,
    products: catalog.products,
    keywords: { KR: kr, US: us },
    // 지식iN 말투 기준 없음(위 머리말) — 기존 「지식iN 실패」 때와 같은 기본 말투.
    styleAnchors: { KR: null },
    maxPerMarket: input.maxPerMarket,
  });
  const diagnostics = {
    catalogSource: catalog.source,
    catalogProducts: catalog.products.length,
    seeds,
    keywords: {
      KR: kr ? kr.length : null,
      US: us ? us.length : null,
    },
  };
  log.info("audit.demand_prompts.resolved", {
    catalogSource: catalog.source,
    catalogProducts: catalog.products.length,
    krKeywords: kr?.length ?? null,
    usKeywords: us?.length ?? null,
    krQuestions: set.questions.KR.length,
    usQuestions: set.questions.US.length,
  });
  return { set, diagnostics };
}
