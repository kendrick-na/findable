// 액션 레이어 (2026-07-31 세션K-2) — "그래서 뭘 하라고?"에 답하는 층.
//
// 배경: 기존 buildTopRecommendations()는 if/else 4분기뿐이라 대부분 브랜드가 폴백 1문장으로 끝났다.
//   나이키·Haegyung·5throck 전부 동일 문구("~의 7 엔진 가시성이 양호합니다")가 나갔다.
//   사용자 지적: "뭘 하라는 건지 이해도 안 되고, 맞는 액션 가이드가 맞는지 확인도 어렵다."
//
// 근거: Princeton GEO 논문(arXiv 2311.09735, KDD 2024) Table 1~5 실측.
//   상세·원문 인용 = docs/_적용/액션레이어_설계_2026-07-31.md
//   ⚠️ 이 파일의 수치를 고칠 때는 반드시 그 문서의 표와 대조할 것(임의 조정 금지).
//
// 설계 원칙:
//   1. 모든 액션은 **우리가 실제로 측정한 데이터**에 근거한다(evidence 필드 필수).
//   2. 효과 근거 없는 액션은 "기대하지 마라"고 명시한다(키워드 스터핑·llms.txt만 믿기).
//   3. 상관 근거는 인과로 단정하지 않는다.
//   4. 채널은 **타깃 시장에 맞는 것만** 제안한다(세션N-24). 한국 브랜드에 영어권
//      커뮤니티를, 해외 브랜드에 네이버를 권하면 둘 다 똑같이 엉뚱하다.

// 타입만 가져온다(런타임 의존 0) — 이 파일은 순수 함수 모듈로 유지한다.
import {
  type ActionGuide,
  applyGuideCopy,
  awarenessActions,
  crawlAccessAction,
  DONT_LIST,
  type DontItem,
  entityClarityAction,
  ownedPageAction,
  RULE_SOURCES,
  type RuleSignals,
  type VerdictEvidence,
} from "./action-rules";
import type { MarketScope } from "./market-scope";

// 한국어 조사 자동 선택 — "나이키이(가)" 같은 어색한 표기 방지.
// 받침 유무로 판정하되, 한글이 아니면(영문 브랜드) 기본형을 쓴다.
const HANGUL_START = 0xac_00;
const HANGUL_END = 0xd7_a3;
const HTTP_URL_RE = /^https?:\/\//i;

function hasFinalConsonant(word: string): boolean | null {
  const last = word.trim().at(-1);
  if (!last) {
    return null;
  }
  const code = last.charCodeAt(0);
  if (code < HANGUL_START || code > HANGUL_END) {
    return null; // 한글 아님(영문·숫자) — 조사 판정 불가
  }
  return (code - HANGUL_START) % 28 !== 0;
}

/**
 * 목적격 조사(을/를).
 * 세션L: www 진단 결과 카피(약점 앵커 CTA)도 같은 판정이 필요해 export.
 * ⚠️ 조사 판정 로직을 UI 쪽에 복제하지 말고 이걸 쓸 것(CLAUDE.md §3 중복 구현 금지).
 */
export function objectParticle(word: string): string {
  const final = hasFinalConsonant(word);
  if (final === null) {
    return "를";
  }
  return final ? "을" : "를";
}

/** 주제 조사(은/는). 영문 등 받침을 판정할 수 없으면 기존 표기 관례대로 "는". */
export function topicParticle(word: string): string {
  const final = hasFinalConsonant(word);
  return final ? "은" : "는";
}

/** 접속 조사(과/와). 영문 등 받침을 판정할 수 없으면 기존 표기 관례대로 "와". */
export function conjunctionParticle(word: string): string {
  const final = hasFinalConsonant(word);
  return final ? "과" : "와";
}

/** 논문 Table 1 — 방법별 효과(베이스라인 19.3 대비 상승률). 카피에 인용하는 유일한 출처. */
export const GEO_METHOD_LIFT = {
  quotation: { label: "인용문 추가", score: 27.2, liftPct: 41 },
  statistics: { label: "통계 추가", score: 25.2, liftPct: 31 },
  fluency: { label: "문장 유려화", score: 24.7, liftPct: 28 },
  citeSources: { label: "출처 인용", score: 24.6, liftPct: 27 },
  // 비효과 — 고객에게 "하지 말라"고 알려주는 용도.
  keywordStuffing: { label: "키워드 반복", score: 17.7, liftPct: -8 },
} as const;

export type ActionPriority = 1 | 2 | 3;
export type ActionKind =
  // 2026-10-03 이후 생성하지 않는다 — 저장된 과거 결과·완료 기록 호환용으로만 남긴다.
  | "rank_strategy"
  | "prompt_gap"
  | "source_portfolio"
  | "content_fix"
  | "avoid"
  // 2026-09-28 근거 등급 규칙표(`action-rules.ts`). 브랜드당 최대 1건씩이라 target 은 "".
  | "entity_clarity"
  | "naver_blog"
  | "best_lists"
  | "bing_webmaster"
  | "crawl_access"
  | "web_mentions";

export interface GeoAction {
  /** `avoid` 카드에만 — 「하지 마세요」 항목별 근거. */
  donts?: DontItem[];
  /** 왜 이 액션이 나왔는지 — 우리가 측정한 실제 근거(숫자·도메인·프롬프트 원문). */
  evidence: string;
  /**
   * 근거 등급 6칸(등급·출처·적용 AI·작업 시간·효과 시차·재측정 지표·실패 조건).
   * 2026-09-28 이전에 저장된 액션에는 없다 → 화면은 없으면 기존 카드만 그린다.
   */
  guide?: ActionGuide;
  /** 실행 방법. 고객이 그대로 따라 할 수 있는 수준. */
  how: string;
  kind: ActionKind;
  /** 3=지금 당장, 2=다음, 1=여유될 때. Peec 방식(1~3) 준용. */
  priority: ActionPriority;
  /** 근거 출처 표기(논문·실측). 신뢰 확보용. */
  source?: string;
  /** 한 줄 제목. 목록에서 이것만 읽어도 뭘 하라는지 알아야 한다. */
  title: string;
  /** 효과를 추정으로 끝내지 않고 다음 회차에 확인하는 방법. */
  verification?: string;
  /** 측정 근거에서 도출한 실제 수정·확인 위치. */
  where?: string;
}

/** 액션 생성에 필요한 측정 신호(구조적 타이핑 — 호출부가 무엇이든 이 모양만 맞추면 된다). */
export interface ActionInput {
  /** 순위가 나온 추천 목록의 평균 항목 수. 2개 중 1위는 "방어"를 권할 만큼 깊은 경쟁이 아니다. */
  averageMentionListSize?: number | null;
  averageMentionPosition: number | null;
  /** 공식 도메인. 측정 결과를 고객이 실제로 수정할 위치로 연결한다. */
  brandDomain?: string;
  brandName: string;
  /** 경쟁사 순위(경쟁 지형에서 추출). 내 브랜드 포함. */
  competitors?: Array<{ isMine: boolean; name: string; shareOfVoice: number }>;
  /** 요청한 고유 엔진 수. 성공 측정 수보다 클 때만 부분 측정을 밝힌다. */
  enginesAttempted?: number;
  enginesMeasured: number;
  /** 측정 성공 엔진 중 브랜드를 인지한 엔진 수 / 전체. */
  enginesMentioned: number;
  /**
   * 고객의 타깃 시장(`market-scope.ts`). 처방의 **채널 선택**을 시장에 맞춘다.
   *
   * 🔴 없으면 `"both"` 로 본다 — 잘못 좁혀 한쪽 시장 처방을 통째로 숨기는 것보다,
   *   넓게 두는 쪽이 안전하다(`inferMarketScope` 의 판단과 같은 방향).
   */
  marketScope?: MarketScope;
  /** 이번 회차의 네이버 검색 응답이 하나 이상 성공했는가. false면 비교 기준선이 없다. */
  naverSearchMeasured?: boolean;
  /** 실제로 AI가 인용한 자사 URL. 출처 귀속이 확인된 URL만 넣는다. */
  ownedCitationUrls?: string[];
  /** 프롬프트별 언급 여부 — 갭 액션의 핵심 신호. */
  prompts?: Array<{ hit: number; text: string; total: number }>;
  /** 인용 출처 유형별 건수(세션J 분류 재사용). */
  sourceMix?: {
    community: number;
    media: number;
    other: number;
    owned: number;
    reference: number;
  };
  /**
   * 실제 인용된 상위 도메인(건수 desc). 처방을 "커뮤니티 50%"가 아니라
   * "blog.naver.com 47건"처럼 **이름으로** 말하기 위한 입력.
   * 고객이 바로 가서 확인할 수 있어야 액션이 구체적이 된다.
   */
  topDomains?: Array<{ count: number; domain: string; owned: boolean }>;
  /**
   * 답변 단위 판정 집계(`summarizeVerdicts`) — 확인/동명 오인/모름/엔진 오류.
   * 있으면 처방이 "22건 중 8건이 다른 회사로 설명"처럼 **관측 건수**를 말한다.
   * 없으면(구버전 호출부) 엔진 단위 신호로 폴백한다.
   */
  verdicts?: VerdictEvidence;
}

function primaryOwnedPage(input: ActionInput): string {
  const measured = input.ownedCitationUrls?.find((url) =>
    HTTP_URL_RE.test(url)
  );
  if (measured) {
    return measured;
  }
  return input.brandDomain
    ? `https://${input.brandDomain}`
    : "공식 사이트의 소개·FAQ 페이지";
}

function promptVerification(prompt: string): string {
  return `수정 후 다음 측정에서 같은 질문("${prompt}")의 등록 브랜드 확인률과 인용 출처 변화를 비교하세요.`;
}

/**
 * 액션 근거에서 "성공 측정"과 "요청"을 절대 섞지 않는다.
 * 실패한 엔진까지 성공처럼 세면 6/7 표본을 7/7이라고 과장하게 된다.
 */
function measurementEvidenceLabel(input: ActionInput): string {
  if (
    typeof input.enginesAttempted === "number" &&
    input.enginesAttempted > input.enginesMeasured
  ) {
    return `응답을 받은 AI ${input.enginesMeasured}곳(요청 ${input.enginesAttempted}곳)`;
  }
  return `측정한 AI ${input.enginesMeasured}곳`;
}

// ──────────────────────────────────────────────────
// ① 순위별 기대효과 — 제거 (2026-10-03 AG-0)
// ──────────────────────────────────────────────────
//
// 🔴 `rank_strategy` 카드를 더 만들지 않는다. 논문(arXiv 2311.09735) Table 2 의 Rank 는
//   검색결과(SERP)에 나온 **출처 웹사이트의 위치**다. AI 답변에서 **브랜드가 몇 번째로
//   언급됐는지**와 다른 변수라, 그 표의 −30.3%·+2.5%·+115.1% 를 우리 순위에 붙일 근거가 없다.
//   올바른 입력 지표와 현 엔진 재현 실험이 생기기 전에는 순위별 효과를 말하지 않는다.
//   (같은 근거로 1순위권에서 공식 페이지 보강 카드를 숨기던 규칙도 지웠다.)
//   이미 저장된 카드는 `action-display-filter.ts` 가 화면에서 걸러낸다.

// ──────────────────────────────────────────────────
// ② 프롬프트 갭 — 어떤 질문에서 놓치는가
// ──────────────────────────────────────────────────

/**
 * ⛔ **"처방 2건이 사실상 같으니 병합하라"는 진단은 기각한다** (S7-4차 · 2026-08-12 실측).
 *
 * 🔬 라이브 회차(`d732a13a…`) 실측 결과 두 건은 **서로 다른 질문**이었다:
 *   ① `"Top 5 popular brands similar to SK하이닉스"` (영어)
 *   ② `"SK하이닉스와 같은 카테고리의 인기 브랜드 5가지 추천해줘"` (한국어)
 *   질문이 다르면 **고쳐야 할 페이지도 다르다**. 병합하면 놓치는 질문 하나가 화면에서
 *   사라진다 = 정보 손실이지 정리가 아니다. `how` 문구도 이미 index 로 갈라 쓰고 있다.
 *
 * 🔴 게다가 병합은 **데이터를 깨뜨린다**: 완료 표시의 정체성이
 *   `ActionCompletion @@unique([brandId, kind, target])` 이고 `target` = **질문 원문**이다
 *   (`apps/app/__tests__/action-target-key.test.ts` 가 이 규칙을 고정하고 있다).
 *   두 건을 하나로 합치면 `target` 이 바뀌어 **고객이 이미 완료 표시한 항목이 미완료로
 *   되살아난다**(before/after 증명의 근거가 끊긴다).
 *
 * → 손대지 않는다. 상한 2건도 유지한다(무명 브랜드는 갭이 여러 개 잡혀 화면이 갭으로만 찬다).
 */
function promptGapActions(input: ActionInput): GeoAction[] {
  const prompts = input.prompts ?? [];
  // 언급률이 낮은 질문부터. 전부 놓친 질문(hit=0)이 최우선.
  const gaps = prompts
    .filter((p) => p.total > 0 && p.hit < p.total)
    .sort((a, b) => a.hit / a.total - b.hit / b.total)
    .slice(0, 2);

  return gaps.map((p, index) => {
    const missRate = Math.round(((p.total - p.hit) / p.total) * 100);
    const missed = p.hit === 0;
    return {
      kind: "prompt_gap" as const,
      priority: (missed ? 3 : 2) as ActionPriority,
      title: missed
        ? `"${p.text}" — 등록 브랜드로 확인된 답변이 없습니다`
        : `"${p.text}" — 이 질문에서 ${missRate}% 놓치고 있습니다`,
      evidence: missed
        ? `AI ${p.total}곳에 물었지만 등록한 ${input.brandName}로 확인된 답변은 0개였습니다.`
        : `AI ${p.total}곳 중 등록한 ${input.brandName}로 확인된 답변은 ${p.hit}개였습니다.`,
      // 같은 문구 반복을 피한다(무명 브랜드는 갭이 여러 개 잡힌다).
      how:
        index === 0
          ? "이 질문에 실제로 도움이 되는 고유 정보(사양·가격·사례·확인 가능한 근거)를 기존의 알맞은 페이지에 먼저 보강하세요. " +
            "첫 문단에 결론을 쓰고, 질문을 소제목으로 두면 읽는 사람이 답을 바로 찾습니다. 관찰 연구에서 AI가 인용한 페이지는 제목이 질문과 더 비슷했습니다."
          : "위와 같은 방식으로 기존 FAQ나 관련 페이지에 이 질문의 답을 항목으로 보강하세요. " +
            "새 페이지는 이 질문만으로 독립된 가치가 있을 때만 만들고, 관찰 결과를 효과 보장으로 읽지 마세요.",
      source: "우리 측정 데이터 — 프롬프트별 언급 여부",
      where: `${primaryOwnedPage(input)} — 이 질문을 제목 또는 H2로 둔 FAQ·전용 섹션`,
      verification: promptVerification(p.text),
    };
  });
}

// ──────────────────────────────────────────────────
// ③ 출처 포트폴리오 — 누가 나를 대신 설명하는가
// ──────────────────────────────────────────────────

const OWNED_HEAVY_PCT = 60;
const COMMUNITY_HEAVY_PCT = 45;

/**
 * 커뮤니티 Q&A 채널을 **타깃 시장에 맞춰** 고른다 (세션N-24, 2026-08-12).
 *
 * 🔴 **막는 사고**: 예전엔 `"네이버 지식iN·관련 카페"` 가 **문자열로 박혀 있었다**.
 *   그래서 해외 시장(global) 브랜드에게도 *"네이버 지식iN에 답변하세요"* 가 나갔다.
 *   한국 서비스에 레딧을 권하는 것과 **정확히 같은 오류의 반대 방향**이다.
 *
 * ⚠️ **왜 `marketScope` 인가(언어가 아니라)**: 측정 언어는 "무슨 말로 물었나"이고,
 *   시장은 "누구에게 팔고 있나"다. 채널을 정하는 건 후자다.
 *   `marketScope` 는 이미 도메인 TLD·업종·언어로 추정되고 고객이 앱에서 고칠 수 있다
 *   (`market-scope.ts`). 여기서 새로 추정하지 않는다 — **판정은 한 곳에서만.**
 *
 * 🔴 **플랫폼 이름을 발명하지 않는다**: 글로벌 채널을 특정 사이트명(Reddit 등)으로
 *   박지 않는다. 근거는 두 가지다 —
 *   ① 업계 통계(Semrush "Reddit 40.1%")는 **영어권 기준**이고 자사 후속 연구에서
 *      **급락**했다(2025-06 → 2025-10). 시점이 지난 수치로 처방하면 그건 추측이다.
 *   ② 이 제품의 원칙은 *"잰 것만 말한다"* 다. 실제로 인용된 도메인은
 *      `input.topDomains` 로 이미 들어오므로, **관측된 것을 이름으로 말하는 쪽**이 맞다.
 *   → 시장별로는 **채널의 "유형"** 만 말하고, 구체적 이름은 측정 데이터가 말하게 한다.
 *     (`industry-profile.ts` 가 채널을 유형으로 기술하는 것과 같은 원칙.)
 */
function communityChannelHint(scope: MarketScope): string {
  if (scope === "korea") {
    return "네이버 지식iN·관련 카페에서 실제 질문에 답하기";
  }
  if (scope === "global") {
    return "해당 분야 영문 Q&A·전문가 커뮤니티에서 실제 질문에 답하기";
  }
  // both = 국내·해외 병행. 한쪽만 말하면 나머지 절반이 통째로 빠진다.
  return "국내는 네이버 지식iN·카페, 해외는 영문 Q&A 커뮤니티에서 실제 질문에 답하기";
}

function sourcePortfolioAction(input: ActionInput): GeoAction | null {
  // A cited URL alone does not establish that an answer described the brand.
  // Search results can cite the submitted domain while no engine verifies the
  // registered entity; calling those "sources AI uses to explain us" is false.
  if (input.enginesMentioned === 0) {
    return null;
  }
  const mix = input.sourceMix;
  if (!mix) {
    return null;
  }
  const total =
    mix.owned + mix.community + mix.reference + mix.media + mix.other;
  if (total === 0) {
    return null;
  }
  const pct = (n: number) => Math.round((n / total) * 100);

  // 실제 인용된 외부 도메인 상위 3개 — 처방을 "이름"으로 말하기 위한 재료.
  const external = (input.topDomains ?? []).filter((d) => !d.owned).slice(0, 3);
  const externalLabel = external
    .map((d) => `${d.domain}(${d.count}건)`)
    .join(" · ");
  const ownedCount = (input.topDomains ?? [])
    .filter((d) => d.owned)
    .reduce((sum, d) => sum + d.count, 0);
  const topExternal = external[0];

  // 🔴 외부 출처가 0건이면 「자사 편중」을 판정할 수 없다 (2026-10-03 AG-0).
  //   러너는 혼합 답변의 외부 URL 을 브랜드에 잘못 붙이지 않으려고 집계에서 뺀다
  //   (`partitionCitedSources`). 그래서 이 경로로 들어온 출처는 늘 자사 100% 다 —
  //   「제3자 출처가 없다」가 아니라 「외부 출처 비중을 재지 않았다」는 뜻이다.
  if (total - mix.owned === 0) {
    return null;
  }

  // 자사 편중 = 확인된 인용이 자사 도메인 쪽에 몰린 상태.
  if (pct(mix.owned) >= OWNED_HEAVY_PCT) {
    return {
      kind: "source_portfolio",
      priority: 3,
      title:
        "확인된 인용이 자사 사이트에 몰려 있습니다 — 제3자 언급을 늘려 보세요",
      evidence: `브랜드로 확인된 답변의 인용 ${total}건 중 ${pct(mix.owned)}%가 자사 도메인입니다(외부 ${100 - pct(mix.owned)}%).`,
      how:
        "AI는 여러 출처가 같은 말을 할 때 더 확신을 갖고 인용합니다. 우선순위대로: " +
        "①업계 매체 기고·보도자료(가장 빠르게 잡힘) " +
        "②비교·추천 리스트 등재('○○ 추천 TOP5' 형태 글에 포함되기) " +
        `③커뮤니티 Q&A 답변(${communityChannelHint(input.marketScope ?? "both")}). ` +
        "핵심은 우리 도메인 밖에서 브랜드명이 등장하는 문서 수를 늘리는 것입니다.",
      source:
        "Ahrefs 75K 브랜드 분석 — 웹 멘션 상관 0.664(백링크 0.218). ※상관이며 인과 아님",
      where: `${primaryOwnedPage(input)} 및 브랜드를 설명할 제3자 매체·비교 페이지`,
      verification:
        "다음 측정에서 자사·제3자 출처 비중과 브랜드 확인률이 함께 변했는지 비교하세요.",
    };
  }

  // 커뮤니티 편중 = 통제 불가 출처가 브랜드 서사를 지배.
  if (pct(mix.community) >= COMMUNITY_HEAVY_PCT) {
    return {
      kind: "source_portfolio",
      priority: 3,
      title: topExternal
        ? `AI는 우리 사이트보다 ${topExternal.domain}를 더 많이 보고 있습니다`
        : "블로그·커뮤니티 글이 우리를 대신 설명하고 있습니다",
      evidence: externalLabel
        ? `AI가 근거로 인용한 곳: ${externalLabel}. 자사 도메인은 ${ownedCount}건뿐입니다.`
        : `인용 출처의 ${pct(mix.community)}%가 커뮤니티·블로그이고, 자사 도메인은 ${pct(mix.owned)}%뿐입니다.`,
      how:
        (topExternal
          ? `① 지금 ${topExternal.domain}에서 우리 브랜드가 어떻게 소개되는지 직접 확인하세요. ` +
            "오래된 가격·단종 제품·경쟁사 비교글이 근거로 쓰이고 있을 수 있습니다. " +
            "잘못된 내용이 있으면 최신 정보로 답글·정정 요청부터 하세요.\n"
          : "") +
        "② 같은 질문에 대한 '공식 답'을 우리 도메인에 만드세요. " +
        "제품 사양·가격·FAQ를 한 페이지에 정리하고 질문 문구를 소제목으로 두세요. " +
        "자사 페이지가 근거로 채택된다는 보장은 없으니 다음 측정에서 확인합니다.\n" +
        "③ 그 채널에 우리 콘텐츠를 직접 올리는 것도 유효합니다. " +
        "AI가 이미 그 채널을 신뢰하고 있다는 뜻이니, 그곳에 정확한 정보를 두는 게 빠릅니다.",
      source: "우리 측정 데이터 — 실제 인용된 출처 도메인·건수",
      where: topExternal
        ? `${topExternal.domain} 및 ${primaryOwnedPage(input)}`
        : primaryOwnedPage(input),
      verification:
        "다음 측정에서 해당 도메인의 인용 건수, 자사 페이지 인용 건수와 브랜드 확인률을 비교하세요.",
    };
  }

  return null;
}

// ──────────────────────────────────────────────────
// ⑤ 공식 페이지 — 근거 등급 규칙표로 대체 (2026-09-28)
// ──────────────────────────────────────────────────
//
// 🔴 **Princeton 「+41%」 고정 카드를 지웠다.** 근거 = GPT-3.5 시절 합성 벤치마크 1편이고
//   재현이 약하다(근거 등급 weak). 그 숫자를 제목에 박으면 지킬 수 없는 약속이 된다.
//   대신 `action-rules.ts` 의 「제목·URL 을 질문에 맞추기」(Ahrefs 140만 프롬프트 · medium)
//   카드를 같은 `content_fix` kind 로 낸다 — `latest-brief.ts` 초안 기능이 이 kind 를 찾는다.
// 🔴 인지 0 일 때의 「공식 소개 한 문단 + 위키·디렉터리」 고정 문구도 지웠다.
//   인지가 낮으면 `awarenessActions` 가 채널별(네이버·추천 목록·Bing·외부 언급) 카드를 낸다.

function ruleSignals(input: ActionInput): RuleSignals {
  const measuredOwned = input.verdicts?.ownedCitationCount;
  return {
    brandDomain: input.brandDomain,
    brandName: input.brandName,
    enginesMeasured: input.enginesMeasured,
    enginesMentioned: input.enginesMentioned,
    naverSearchMeasured: input.naverSearchMeasured,
    marketScope: input.marketScope ?? "both",
    measuredLabel: measurementEvidenceLabel(input),
    // 공식 사이트 인용 수: 답변 단위 관측값 > 출처 유형 집계 > 모름(null).
    ownedCitations:
      typeof measuredOwned === "number"
        ? measuredOwned
        : (input.sourceMix?.owned ?? null),
    verdicts: input.verdicts,
  };
}

// ──────────────────────────────────────────────────
// 기존 kind 에도 근거 등급을 붙인다 — 카드마다 6칸이 비지 않게
// ──────────────────────────────────────────────────

function legacyGuide(action: GeoAction): ActionGuide | undefined {
  if (action.kind === "prompt_gap") {
    return {
      evidenceGrade: "medium",
      evidenceBasis: "observational",
      notGuaranteed:
        "질문에 맞춘 제목·FAQ가 인용을 늘린다는 실험 결과는 없습니다. 같은 문구의 페이지를 여러 개 만들면 품질 문제가 될 수 있습니다.",
      publishCheck:
        "보강한 페이지가 공개 주소에서 열리고 검색엔진에서 검색되는지(색인) 확인하세요.",
      sources: [RULE_SOURCES.ahrefsWhyCited],
      engines: ["chatgpt"],
      effortHours: { min: 2, max: 4, per: "total" },
      effectLag: "AI 검색이 새 페이지를 읽어 간 뒤(며칠~몇 주).",
      remeasureMetric: "이 질문에서 우리를 알아본 답변 수",
      failCondition:
        "페이지를 만든 뒤 두 번 재도 이 질문에서 계속 0건이면, 페이지가 색인됐는지와 제목이 질문 문구 그대로인지 확인하세요.",
    };
  }
  if (action.kind === "source_portfolio") {
    return {
      evidenceGrade: "medium",
      evidenceBasis: "observational",
      notGuaranteed:
        "제3자 언급이 늘면 AI 노출도 는다는 것은 상관관계입니다. 출처 비중이 바뀐다는 보장은 없습니다.",
      publishCheck:
        "외부 글이 공개돼 있고 회사 이름으로 검색되는지(색인) 확인하세요.",
      sources: [RULE_SOURCES.ahrefsVisibility],
      engines: [],
      effortHours: { min: 4, max: 12, per: "total" },
      effectLag: "몇 주~몇 달.",
      remeasureMetric: "인용 출처 중 우리 사이트 밖 출처의 비중",
      failCondition:
        "두 번 재도 출처 구성이 그대로면, 외부 글이 우리 이름을 정확히 쓰는지와 검색에 잡히는지 확인하세요.",
    };
  }
  return undefined;
}

// ──────────────────────────────────────────────────
// 하지 말아야 할 것 — 업계 차별화 포인트
// ──────────────────────────────────────────────────

function avoidAction(): GeoAction {
  return {
    kind: "avoid",
    priority: 1,
    title: "이건 하지 마세요 — 효과가 없거나 역효과입니다",
    evidence:
      "AI 최적화로 흔히 권해지지만, 대규모 조사·공식 문서에서 효과가 확인되지 않았거나 규정 위반 위험이 있는 방법들입니다.",
    how: DONT_LIST.map(
      (item, index) =>
        `${"①②③④⑤⑥⑦"[index] ?? "·"}${item.title} — ${item.reason}`
    ).join("\n"),
    source: "근거 없음 · Ahrefs 스키마 조사 · Google 검색 센터 · 표시광고법",
    donts: DONT_LIST,
  };
}

// ──────────────────────────────────────────────────
// 진입점
// ──────────────────────────────────────────────────

/** 화면에 세우는 액션 최대 개수. 업계 1위 불만이 "압도적이다" — 적게 확실하게. */
const MAX_ACTIONS = 5;

/**
 * 측정 신호 → 실행 가능한 액션 목록(우선순위 desc).
 * 모든 액션은 evidence(우리 측정 근거)와 how(실행 방법)를 반드시 갖는다.
 */
export function buildGeoActions(input: ActionInput): GeoAction[] {
  const actions: GeoAction[] = [];
  const sig = ruleSignals(input);

  // 삽입 순서 = 같은 우선순위 안에서의 표시 순서(정렬은 안정 정렬).
  //   동명 오인이 제일 먼저다 — 다른 회사로 알려진 상태에서 노출을 늘리면 오해도 같이 는다.
  const entity = entityClarityAction(sig);
  if (entity) {
    actions.push(entity);
  }
  const crawl = crawlAccessAction(sig);
  if (crawl) {
    actions.push(crawl);
  }
  actions.push(...awarenessActions(sig));
  actions.push(ownedPageAction(sig, primaryOwnedPage(input)));
  actions.push(...promptGapActions(input));

  const portfolio = sourcePortfolioAction(input);
  if (portfolio) {
    actions.push(portfolio);
  }

  // 🔴 **「하지 마세요」는 상한에서 제외한다** (N-46 · 1,024조합 중 352건이 상한 도달).
  //   돈·시간 낭비를 막는 유일한 카드인데 P1 이라 상한에 걸리면 항상 먼저 잘렸다.
  //   → 상한은 «해야 할 일»에만 적용하고, «하지 말 것»은 항상 맨 아래 붙인다.
  const todo = actions
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_ACTIONS)
    .map((a) => applyGuideCopy(a.guide ? a : { ...a, guide: legacyGuide(a) }));
  return [...todo, avoidAction()];
}

/** 기존 topRecommendations(string[]) 호환 — 구 UI·PDF가 아직 문자열 배열을 기대한다. */
export function actionsToStrings(actions: GeoAction[]): string[] {
  return actions.map((a) => `${a.title} — ${a.how}`);
}

/**
 * 완료 기록의 대상 키 — `ActionCompletion.target` 에 저장되는 값 (2026-08-10 세션N-13).
 *
 * 🔴 **왜 함수로 뽑았나**: 이 규칙이 **두 화면에 복제**돼 있었다
 *   (추적 경로 `/actions` · 무료 진단 경로). 규칙이 갈라지면 **같은 액션이 두 번
 *   기록되거나**(완료했는데 다시 미완료로 보임), 완료 표시가 **엉뚱한 액션에 붙는다**.
 *   `ActionCompletion` 은 `@@unique([brandId, kind, target])` 이라 이 값이 곧 정체성이다.
 *
 * 규칙: `prompt_gap` 은 **같은 종류가 여러 건**(질문마다 1건) 나오므로 제목으로 구분한다.
 *   나머지 종류는 브랜드당 최대 1건이라 빈 문자열이면 충분하다.
 */
export function actionTargetKey(action: Pick<GeoAction, "kind" | "title">) {
  return action.kind === "prompt_gap" ? action.title : "";
}
