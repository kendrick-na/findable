// 백로그 3·4 (2026-07-31): org 측정 1회분 → 경쟁사 지형 + 인용 출처 집계.
//
// 설계 원칙 — **추가 AI 호출 0**. 두 화면 모두 이미 저장된 Tracking 행만 재해석한다.
//   · 경쟁사 = rawResponse(답변 원문)의 번호목록 파싱 → @repo/audit 의 extractCompetitorLandscape
//     재사용(www 무료 진단이 쓰던 검증된 로직 그대로. 원문이 excerpt 1500자가 아니라 전문이라
//     org 쪽 표본이 오히려 더 크다).
//   · 인용 = citedSources(Json) 집계.
//
// ⚠️ Mention ≠ Citation (백로그 3의 핵심):
//   Mention = 답변 본문에 브랜드가 "언급"됨(brandMentioned).
//   Citation = 답변이 출처로 "링크"를 건 것(citedSources). 내 도메인이 인용되지 않아도 언급될
//   수 있고, 그 반대도 가능하다. 두 값을 한 지표로 뭉치면 "왜 언급되는데 트래픽이 없나"를
//   설명할 수 없어 분리 집계한다.

import {
  type CompetitorLandscape,
  extractCompetitorLandscape,
  parseKnownCompetitors,
} from "@repo/audit/competitor-extract";

/**
 * 🔴 브리핑은 **질의 축이 다르다**(N-45 · #4-b). 경쟁사 집계처럼 *"같은 질문"* 을
 *   전제로 하는 계산에서는 빼야 한다. 📕 `브리핑_본류편입_기획_2026-08-17.md` §2
 */
const BRIEFING_ENGINE_ID = "naver-briefing";

/** 집계 입력 — scopedLatestRunTracking 행의 구조적 최소형(app lib 역의존 회피). */
export interface AnalysisRowInput {
  brand: {
    name: string;
    domain: string;
    entityVariants: unknown;
    // 👤 등록 경쟁사(N-44 승인 ⓐ). Json 이라 모양이 열려 있다 → `parseKnownCompetitors`(@repo/audit) 가 좁힌다.
    competitors?: unknown;
  };
  brandId: string;
  brandMentioned: boolean;
  citedSources: unknown;
  engineId: string;
  rawResponse: string | null;
  trackedAt: Date;
}

/** citedSources JSON 1건의 런타임 가드 통과 형태. */
interface CitedSource {
  domain: string;
  title?: string;
  url: string;
}

// 검색 API(네이버·다음)가 돌려주는 제목에는 HTML 엔티티가 그대로 들어온다
// ("Nvidia won&#39;t"). 세션G에 진실거울 카드에서 관찰된 잔존 이슈와 같은 원인 —
// 여기서 표시 직전에 정규화한다. 서버에서 도는 집계라 DOM 파서를 쓸 수 없어 수동 치환.
const HTML_ENTITY_RE =
  /&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos|nbsp));/gi;
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeHtmlEntities(text: string): string {
  return text.replace(HTML_ENTITY_RE, (match, dec, hex, named) => {
    if (dec) {
      return String.fromCodePoint(Number.parseInt(dec, 10));
    }
    if (hex) {
      return String.fromCodePoint(Number.parseInt(hex, 16));
    }
    return NAMED_ENTITIES[String(named).toLowerCase()] ?? match;
  });
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );
}

// ⚠️ 인용 관련성 (2026-07-31 세션K) — 검색 기반 엔진(naver·daum)은 질의어를 그대로
// 검색해 상위 결과를 citedSources 로 승격한다(korean-adapters.ts:252·348). 그래서 질의어
// 문구만 겹치는 무관한 글이 "AI가 근거로 삼은 출처"로 표시됐다.
//   실측(nvidia): "미장 배당주 추천해줘", "PDF 압축 방법", "Apple TV 살 만한가"
//   실측(nike): "치하야 아논 - 나무위키", "ChatGPT 프롬프트 기술"
// 판정 규칙(실데이터 검증: nvidia 제외율 67% · nike 45%, 정상 인용은 전부 보존):
//   · 자사 도메인이면 항상 관련
//   · 제목이 없으면(LLM 이 직접 지목한 출처) 항상 관련 — chatgpt 계열이 여기 해당
//   · 제목이 있으면 제목/URL 에 브랜드 토큰이 있어야 관련
function brandTokens(brandName: string, brandDomain: string): string[] {
  const host = normalizeDomain(brandDomain).split(".")[0] ?? "";
  return [brandName, host]
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2);
}

/** URL 디코딩 — 잘못된 퍼센트 인코딩에서 throw 하므로 반드시 감싼다(실측 크래시). */
function safeDecode(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function isRelevantCitation(
  source: CitedSource,
  brandDomain: string,
  tokens: string[]
): boolean {
  if (isOwnedDomain(source.domain, brandDomain)) {
    return true;
  }
  if (!source.title) {
    return true;
  }
  const haystack = `${source.title} ${safeDecode(source.url)}`.toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

/** Json(unknown) → CitedSource[]. 모양이 어긋난 항목은 조용히 버린다(방어적 파싱). */
function toCitedSources(value: unknown): CitedSource[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: CitedSource[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const url = record.url;
    const domain = record.domain;
    if (typeof url !== "string" || typeof domain !== "string" || !domain) {
      continue;
    }
    const title = record.title;
    out.push({
      url,
      domain,
      title:
        typeof title === "string" && title.length > 0
          ? decodeHtmlEntities(title)
          : undefined,
    });
  }
  return out;
}

// "www." 접두사만 제거해 같은 사이트를 한 줄로 묶는다. 서브도메인(investor.nvidia.com)은
// 성격이 다른 출처라 보존한다.
const WWW_PREFIX = /^www\./;

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(WWW_PREFIX, "");
}

/**
 * 인용 도메인이 내 소유인지. 정확 일치 + 서브도메인만 인정한다
 * ("nvidia.com" 소유자에게 "notnvidia.com" 이 자사로 잡히지 않도록 경계를 점으로 끊음).
 */
function isOwnedDomain(citedDomain: string, brandDomain: string): boolean {
  const cited = normalizeDomain(citedDomain);
  const owned = normalizeDomain(brandDomain);
  if (!owned) {
    return false;
  }
  return cited === owned || cited.endsWith(`.${owned}`);
}

// ──────────────────────────────────────────────────
// 경쟁사 지형 (백로그 4)
// ──────────────────────────────────────────────────

export interface CompetitorAnalysis {
  brandName: string;
  landscape: CompetitorLandscape;
  measuredAt: Date;
  /** 파싱 소스가 된 답변 수(신뢰도 표기용). */
  responsesParsed: number;
}

/**
 * 최신 run 행 → 경쟁 지형. 원문이 하나도 없으면 null(화면은 안내 문구로 폴백).
 */
export function buildCompetitorAnalysis(
  rows: AnalysisRowInput[]
): CompetitorAnalysis | null {
  const first = rows[0];
  if (!first) {
    return null;
  }

  /**
   * 🔴 **브리핑은 경쟁사 집계에서 뺀다**(N-45 · #4-b B-5).
   *
   * 경쟁사 순위는 *"같은 질문에 AI가 어떤 브랜드를 먼저 말하나"* 를 세는 것이다
   * (`/compare` 화면이 그렇게 약속한다). 그런데 브리핑은 **다른 질문**을 던진다 —
   * 「{브랜드} 효과·후기·장단점」은 **경쟁 브랜드를 나열하는 질의가 아니다**.
   *
   * 섞으면: ① 분모가 달라져 점유율이 왜곡되고 ② 후기 글에 우연히 언급된 이름이
   * 「경쟁사」로 승격된다. 📕 N-30 *"축이 다른 두 숫자를 나란히 두면 검산하려 든다"*.
   *
   * ⚠️ 브리핑을 **버리는 게 아니다** — 진실의 거울에는 자기 축으로 그대로 나온다.
   */
  const excerpts = rows
    .filter((row) => row.engineId !== BRIEFING_ENGINE_ID)
    .map((row) => row.rawResponse)
    .filter((raw): raw is string => typeof raw === "string" && raw.length > 0);

  if (excerpts.length === 0) {
    return null;
  }

  const brandName = first.brand.name || first.brand.domain;
  const landscape = extractCompetitorLandscape(
    excerpts,
    brandName,
    toStringArray(first.brand.entityVariants),
    // 👤 승인 ⓐ(N-44) — 등록 경쟁사를 **표기 병합**에만 쓴다. 거르지 않는다.
    parseKnownCompetitors(first.brand.competitors)
  );

  // 순위표가 비면 보여줄 게 없다(번호목록 없는 답변만 나온 run).
  if (landscape.ranking.length === 0) {
    return null;
  }

  return {
    brandName,
    landscape,
    measuredAt: first.trackedAt,
    responsesParsed: excerpts.length,
  };
}

export type { CompetitorRank } from "@repo/audit/competitor-extract";
/** UI 하이라이트용 재수출(컴포넌트가 @repo/audit 을 다시 import 하지 않도록). */
export { isMyBrand } from "@repo/audit/competitor-extract";

// ──────────────────────────────────────────────────
// 인용 출처 (백로그 3)
// ──────────────────────────────────────────────────

/**
 * 출처 유형 — 한국 AI 답변의 인용 구조를 드러내는 축(백로그 3 차별화 지점).
 * 실측(nvidia·nike): 인용의 과반이 blog.naver.com 이었다. "내 사이트가 아니라 남의 블로그가
 * 나를 대신 설명하고 있다"를 보여주는 게 이 분류의 목적.
 */
export type SourceKind =
  | "owned"
  | "community"
  | "reference"
  | "media"
  | "other";

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  owned: "자사",
  community: "커뮤니티·블로그",
  reference: "위키·지식",
  media: "언론·매체",
  other: "기타",
};

// 도메인 → 유형. 한국 GEO 에서 실제로 자주 등장하는 출처를 우선 담았다.
const COMMUNITY_DOMAINS = [
  "blog.naver.com",
  "cafe.naver.com",
  "tistory.com",
  "brunch.co.kr",
  "velog.io",
  "dcinside.com",
  "fmkorea.com",
  "clien.net",
  "ruliweb.com",
  "theqoo.net",
  "instiz.net",
  "etoland.co.kr",
  "ppomppu.co.kr",
  "reddit.com",
  "quora.com",
  "medium.com",
  "youtube.com",
  "post.naver.com",
];
const REFERENCE_DOMAINS = [
  "namu.wiki",
  "wikipedia.org",
  "wikidata.org",
  "terms.naver.com",
  "kin.naver.com",
  "namuwiki.com",
];
// 언론은 수가 많아 접미사 규칙으로도 잡는다(.co.kr 뉴스 도메인 다수).
const MEDIA_DOMAINS = [
  "news.naver.com",
  "v.daum.net",
  "chosun.com",
  "joongang.co.kr",
  "donga.com",
  "hani.co.kr",
  "mk.co.kr",
  "hankyung.com",
  "edaily.co.kr",
  "yna.co.kr",
  "zdnet.co.kr",
  "etnews.com",
  "bloter.net",
  "businessinsider.com",
  "reuters.com",
  "bloomberg.com",
  "cnbc.com",
  "techcrunch.com",
  "theverge.com",
  "engadget.com",
  "pcworld.com",
  "tomshardware.com",
];
const MEDIA_HINT_RE = /(^|\.)(news|press|media|times|daily|journal|post)\./;

function matchesDomain(domain: string, list: string[]): boolean {
  return list.some((entry) => domain === entry || domain.endsWith(`.${entry}`));
}

function classifySource(domain: string, owned: boolean): SourceKind {
  if (owned) {
    return "owned";
  }
  if (matchesDomain(domain, REFERENCE_DOMAINS)) {
    return "reference";
  }
  if (matchesDomain(domain, COMMUNITY_DOMAINS)) {
    return "community";
  }
  if (matchesDomain(domain, MEDIA_DOMAINS) || MEDIA_HINT_RE.test(domain)) {
    return "media";
  }
  return "other";
}

export interface CitedDomainStat {
  /** 총 인용 횟수(같은 답변 내 중복 URL 은 1회로 셈). */
  citations: number;
  domain: string;
  /** 이 도메인을 인용한 엔진 id 목록(정렬됨). */
  engines: string[];
  /** 출처 유형(자사·커뮤니티·위키·언론·기타). */
  kind: SourceKind;
  /** 내 브랜드 소유 도메인인지(자사 vs 외부 출처 구분). */
  owned: boolean;
  /** 대표 제목(있는 경우만 — 네이버·다음은 제목을 준다). */
  sampleTitle?: string;
  /** 대표 URL 1건(클릭 이동용). */
  sampleUrl: string;
}

export interface EngineMentionStat {
  /** 이 엔진이 만든 인용 수. */
  citations: number;
  engineId: string;
  /** 이 엔진 응답 중 브랜드가 언급된 수. */
  mentioned: number;
  /** 이 엔진의 총 응답 수. */
  total: number;
}

export interface SourceKindStat {
  citations: number;
  kind: SourceKind;
  /** 전체 인용 대비 비중(0~100). */
  share: number;
}

export interface SourcesAnalysis {
  brandDomain: string;
  brandName: string;
  /** 인용 도메인 집계(인용수 desc). */
  domains: CitedDomainStat[];
  /** 엔진별 Mention vs Citation 대조. */
  engines: EngineMentionStat[];
  /**
   * 브랜드와 무관해 집계에서 제외한 인용 수(검색엔진이 질의어로 물어온 결과).
   * 0 이 아니면 화면에 고지한다 — 조용한 누락은 "다 보여줬다"는 오해를 만든다.
   */
  filteredCitations: number;
  /** 출처 유형별 비중(인용수 desc) — "누가 나를 대신 설명하는가". */
  kinds: SourceKindStat[];
  measuredAt: Date;
  /** 언급된 응답 수 / 전체 응답 수 — Mention 축. */
  mentionRate: { mentioned: number; total: number };
  /** 내 도메인이 인용된 횟수 / 전체 인용 수 — Citation 축. */
  ownedCitations: { owned: number; total: number };
}

/** 도메인 누적 엔트리(집계 중간 상태). */
interface DomainAccumulator {
  citations: number;
  display: string;
  engines: Set<string>;
  sampleTitle?: string;
  sampleUrl: string;
}

/**
 * 한 행(엔진 응답 1건)의 인용을 도메인 맵에 흡수한다.
 * @returns 이 행이 기여한 { 총 인용 수, 자사 인용 수 }.
 */
function absorbRowCitations(
  row: AnalysisRowInput,
  brandDomain: string,
  tokens: string[],
  domainMap: Map<string, DomainAccumulator>
): { citations: number; filtered: number; owned: number } {
  // 같은 응답 안에서 같은 URL 이 여러 번 나와도 1회로 센다(중복 팽창 방지).
  const seenInRow = new Set<string>();
  let citations = 0;
  let owned = 0;
  let filtered = 0;

  for (const source of toCitedSources(row.citedSources)) {
    if (seenInRow.has(source.url)) {
      continue;
    }
    seenInRow.add(source.url);

    // 브랜드와 무관한 검색 결과는 인용으로 세지 않는다(위 규칙 참조).
    if (!isRelevantCitation(source, brandDomain, tokens)) {
      filtered += 1;
      continue;
    }

    citations += 1;
    if (isOwnedDomain(source.domain, brandDomain)) {
      owned += 1;
    }

    const key = normalizeDomain(source.domain);
    const entry = domainMap.get(key) ?? {
      citations: 0,
      display: key,
      engines: new Set<string>(),
      sampleUrl: source.url,
      sampleTitle: source.title,
    };
    entry.citations += 1;
    entry.engines.add(row.engineId);
    // 제목 있는 표본을 우선 보존(네이버·다음 결과가 더 읽기 좋다).
    if (!entry.sampleTitle && source.title) {
      entry.sampleTitle = source.title;
      entry.sampleUrl = source.url;
    }
    domainMap.set(key, entry);
  }

  return { citations, filtered, owned };
}

/**
 * 최신 run 행 → 인용 출처 분석. 행이 없으면 null.
 * 인용이 0건이어도 **null 이 아니다** — "언급은 되는데 인용은 0"이 그 자체로 중요한 진단이다.
 */
export function buildSourcesAnalysis(
  rows: AnalysisRowInput[]
): SourcesAnalysis | null {
  const first = rows[0];
  if (!first) {
    return null;
  }

  const brandDomain = first.brand.domain;
  const tokens = brandTokens(first.brand.name || brandDomain, brandDomain);
  const domainMap = new Map<string, DomainAccumulator>();
  const engineMap = new Map<
    string,
    { citations: number; mentioned: number; total: number }
  >();

  let totalCitations = 0;
  let ownedCitations = 0;
  let mentionedRows = 0;
  let filteredCitations = 0;

  for (const row of rows) {
    if (row.brandMentioned) {
      mentionedRows += 1;
    }

    const engineEntry = engineMap.get(row.engineId) ?? {
      citations: 0,
      mentioned: 0,
      total: 0,
    };
    engineEntry.total += 1;
    if (row.brandMentioned) {
      engineEntry.mentioned += 1;
    }

    const contributed = absorbRowCitations(row, brandDomain, tokens, domainMap);
    totalCitations += contributed.citations;
    ownedCitations += contributed.owned;
    filteredCitations += contributed.filtered;
    engineEntry.citations += contributed.citations;

    engineMap.set(row.engineId, engineEntry);
  }

  const domains: CitedDomainStat[] = [...domainMap.values()]
    .map((entry) => {
      const owned = isOwnedDomain(entry.display, brandDomain);
      return {
        domain: entry.display,
        citations: entry.citations,
        engines: [...entry.engines].sort(),
        kind: classifySource(entry.display, owned),
        owned,
        sampleUrl: entry.sampleUrl,
        sampleTitle: entry.sampleTitle,
      };
    })
    .sort(
      (a, b) => b.citations - a.citations || a.domain.localeCompare(b.domain)
    );

  // 유형별 집계 — 도메인이 아니라 인용 "횟수" 기준(한 도메인이 여러 번 인용되면 그만큼 크다).
  const kindTally = new Map<SourceKind, number>();
  for (const domain of domains) {
    kindTally.set(
      domain.kind,
      (kindTally.get(domain.kind) ?? 0) + domain.citations
    );
  }
  const kinds: SourceKindStat[] = [...kindTally.entries()]
    .map(([kind, citations]) => ({
      kind,
      citations,
      share:
        totalCitations > 0 ? Math.round((citations / totalCitations) * 100) : 0,
    }))
    .sort((a, b) => b.citations - a.citations);

  const engines: EngineMentionStat[] = [...engineMap.entries()]
    .map(([engineId, stat]) => ({ engineId, ...stat }))
    .sort(
      (a, b) =>
        b.mentioned - a.mentioned || a.engineId.localeCompare(b.engineId)
    );

  return {
    brandDomain,
    brandName: first.brand.name || brandDomain,
    domains,
    filteredCitations,
    kinds,
    engines,
    measuredAt: first.trackedAt,
    mentionRate: { mentioned: mentionedRows, total: rows.length },
    ownedCitations: { owned: ownedCitations, total: totalCitations },
  };
}
