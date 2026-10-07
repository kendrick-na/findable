// 브랜드 프로필 수집 — 외부 데이터(공식 사이트·네이버 키워드도구·구글 키워드 플래너·지식iN)
// (2026-10-07, 질문 체계 v2 A1). 계산은 brand-profile.ts·question-plan-v2.ts(순수)가 한다.
//
// ⛔ 실패해도 측정을 막지 않는다: 출처마다 실패 = 빈 값. 키가 없는 출처는 「꺼짐」이다.
// ⚠️ 지식iN 질문 제목 원문은 저장하지 않는다(네이버 약관) — 말투·질문 유형 개수만 센다.
// ⚠️ 네이버 쇼핑 검색 API 는 쓰지 않는다: 2026-10-07 실호출에서 `/v1/search/shop.json` 이
//   「존재하지 않는 검색 api」(SE05, 404)였다. 쇼핑 카테고리 대체 경로는 키워드도구 검색량이다.

import { type BrandCatalog, resolveBrandCatalog } from "./brand-catalog";
import {
  type BrandProfile,
  buildBrandProfile,
  type ProfileInputs,
  profileSeedKeywords,
} from "./brand-profile";
import type { DemandKeyword, DemandMarket } from "./demand-prompts";
import { liveDemandSourceDeps } from "./demand-prompts-live";
import { resolveSiteStructure, type SiteStructure } from "./site-structure";

export interface ProfileSourceDeps {
  catalog: (domain: string, signal?: AbortSignal) => Promise<BrandCatalog>;
  googleIdeas: (
    seeds: string[],
    signal?: AbortSignal
  ) => Promise<DemandKeyword[] | null>;
  kinTitles: (query: string, signal?: AbortSignal) => Promise<string[] | null>;
  naverVolumes: (
    seeds: string[],
    signal?: AbortSignal
  ) => Promise<DemandKeyword[] | null>;
  siteStructure: (
    domain: string,
    brandNames: readonly string[],
    signal?: AbortSignal
  ) => Promise<SiteStructure>;
}

export const liveProfileSourceDeps: ProfileSourceDeps = {
  catalog: resolveBrandCatalog,
  siteStructure: resolveSiteStructure,
  naverVolumes: liveDemandSourceDeps.naverVolumes,
  googleIdeas: liveDemandSourceDeps.googleIdeas,
  kinTitles: liveDemandSourceDeps.kinTitles,
};

/** 지식iN 질문 제목에서 센 질문 유형 개수(원문 미보관). */
export interface KinStyleCounts {
  cost: number;
  effect: number;
  howTo: number;
  polite: number;
  recommend: number;
  total: number;
}

const HOW_TO_RE = /어떻게|방법|순서|사용법|시작/;
const EFFECT_RE = /효과|있나요|괜찮|도움/;
const COST_RE = /비용|가격|얼마|견적/;
const RECOMMEND_RE = /추천|어디|뭐가|어떤/;
const POLITE_RE = /(요|까요|나요|세요|니다)\s*[?？!.]*$/;

export function kinStyleCounts(
  titles: readonly string[] | null
): KinStyleCounts | null {
  if (!titles) {
    return null;
  }
  const count = (re: RegExp) => titles.filter((t) => re.test(t)).length;
  return {
    total: titles.length,
    howTo: count(HOW_TO_RE),
    effect: count(EFFECT_RE),
    cost: count(COST_RE),
    recommend: count(RECOMMEND_RE),
    polite: count(POLITE_RE),
  };
}

export interface CollectProfileInput {
  brandNames: { en?: string | null; ko: string; variants?: readonly string[] };
  customerIdentity?: ProfileInputs["customerIdentity"];
  customerProducts?: readonly string[];
  domain: string;
  footerIdentity?: ProfileInputs["footerIdentity"];
  industry?: string | null;
  markets: readonly DemandMarket[];
  signal?: AbortSignal;
  /** 공식 사이트 문구 조각(`siteCategoryTerms`) — 마지막 대체 경로. */
  siteTextTerms?: readonly string[];
}

export interface CollectedProfile {
  diagnostics: {
    catalogProducts: number;
    catalogSource: BrandCatalog["source"];
    keywordRows: Partial<Record<DemandMarket, number | null>>;
    sitePagesRead: number;
  };
  keywords: Partial<Record<DemandMarket, DemandKeyword[] | null>>;
  kinStyle: KinStyleCounts | null;
  profile: BrandProfile;
  seeds: Record<DemandMarket, string[]>;
}

export async function collectBrandProfile(
  input: CollectProfileInput,
  deps: ProfileSourceDeps = liveProfileSourceDeps
): Promise<CollectedProfile> {
  const names = [
    input.brandNames.ko,
    input.brandNames.en ?? "",
    ...(input.brandNames.variants ?? []),
  ].filter((n) => n.trim().length >= 2);
  const [catalog, site] = await Promise.all([
    deps
      .catalog(input.domain, input.signal)
      .catch((): BrandCatalog => ({ source: "none", products: [] })),
    deps
      .siteStructure(input.domain, names, input.signal)
      .catch(
        (): SiteStructure => ({ source: "none", offerings: [], pagesRead: 0 })
      ),
  ]);
  const profile = buildBrandProfile({
    catalog: catalog.products,
    siteOfferings: site.offerings,
    siteTextTerms: input.siteTextTerms ?? [],
    industry: input.industry ?? null,
    customerProducts: input.customerProducts,
    customerIdentity: input.customerIdentity ?? null,
    footerIdentity: input.footerIdentity ?? null,
  });
  const seeds = profileSeedKeywords(profile, input.brandNames);
  const wants = (m: DemandMarket) =>
    profile.level !== "none" && input.markets.includes(m);
  const safe = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
  const [kr, us, kin] = await Promise.all([
    wants("KR") && seeds.KR.length > 0
      ? safe(deps.naverVolumes(seeds.KR, input.signal))
      : null,
    wants("US") && seeds.US.length > 0
      ? safe(deps.googleIdeas(seeds.US, input.signal))
      : null,
    wants("KR") && seeds.KR[0]
      ? safe(deps.kinTitles(seeds.KR[0], input.signal))
      : null,
  ]);
  return {
    profile,
    seeds,
    keywords: { KR: kr, US: us },
    kinStyle: kinStyleCounts(kin),
    diagnostics: {
      catalogSource: catalog.source,
      catalogProducts: catalog.products.length,
      sitePagesRead: site.pagesRead,
      keywordRows: { KR: kr ? kr.length : null, US: us ? us.length : null },
    },
  };
}
