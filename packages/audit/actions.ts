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
//   2. 효과 없는 액션은 "하지 마라"고 명시한다(키워드 스터핑·llms.txt) — 업계 차별화.
//   3. 상관 근거는 인과로 단정하지 않는다.
//   4. 채널은 **타깃 시장에 맞는 것만** 제안한다(세션N-24). 한국 브랜드에 영어권
//      커뮤니티를, 해외 브랜드에 네이버를 권하면 둘 다 똑같이 엉뚱하다.

// 타입만 가져온다(런타임 의존 0) — 이 파일은 순수 함수 모듈로 유지한다.
import type { MarketScope } from "./market-scope";

// 한국어 조사 자동 선택 — "나이키이(가)" 같은 어색한 표기 방지.
// 받침 유무로 판정하되, 한글이 아니면(영문 브랜드) 기본형을 쓴다.
const HANGUL_START = 0xac_00;
const HANGUL_END = 0xd7_a3;

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

/**
 * 논문 Table 2 — 순위별 상대 개선율(%). GEO 최적화가 상위 노출 브랜드에는 **역효과**다.
 * Cite Sources 기준: Rank1 −30.3 / Rank2 +2.5 / Rank4 +15.5 / Rank5 +115.1
 * → 이 사실을 액션에 반영한 경쟁사는 확인된 바 없다(최대 차별화 지점).
 */
const RANK_LIFT_TABLE = [
  { maxRank: 1.5, lift: -30, tone: "risk" as const },
  { maxRank: 2.5, lift: 3, tone: "flat" as const },
  { maxRank: 4.5, lift: 16, tone: "gain" as const },
  { maxRank: Number.POSITIVE_INFINITY, lift: 115, tone: "gain" as const },
];

export type ActionPriority = 1 | 2 | 3;
export type ActionKind =
  | "rank_strategy"
  | "prompt_gap"
  | "source_portfolio"
  | "content_fix"
  | "avoid";

export interface GeoAction {
  /** 왜 이 액션이 나왔는지 — 우리가 측정한 실제 근거(숫자·도메인·프롬프트 원문). */
  evidence: string;
  /** 실행 방법. 고객이 그대로 따라 할 수 있는 수준. */
  how: string;
  kind: ActionKind;
  /** 3=지금 당장, 2=다음, 1=여유될 때. Peec 방식(1~3) 준용. */
  priority: ActionPriority;
  /** 근거 출처 표기(논문·실측). 신뢰 확보용. */
  source?: string;
  /** 한 줄 제목. 목록에서 이것만 읽어도 뭘 하라는지 알아야 한다. */
  title: string;
}

/** 액션 생성에 필요한 측정 신호(구조적 타이핑 — 호출부가 무엇이든 이 모양만 맞추면 된다). */
export interface ActionInput {
  averageMentionPosition: number | null;
  brandName: string;
  /** 경쟁사 순위(경쟁 지형에서 추출). 내 브랜드 포함. */
  competitors?: Array<{ isMine: boolean; name: string; shareOfVoice: number }>;
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
}

// ──────────────────────────────────────────────────
// ① 순위별 기대효과 — 논문 Table 2
// ──────────────────────────────────────────────────

/**
 * 1순위권 처방의 제목 — **상수로 뺀 이유**(N-46):
 * `buildGeoActions` 가 *"지금은 방어 국면인가"* 를 이 값으로 판단한다.
 * 문자열을 두 곳에 복제하면 제목만 고쳐도 **모순 차단이 조용히 풀린다**
 * (📕 이 저장소는 도메인 정규식이 세 번 복제돼 갈라진 사고를 이미 겪었다).
 */
const DEFEND_TITLE = "이미 1순위 — 지금은 '더 밀어붙이기'보다 방어가 낫습니다";

function rankStrategyAction(input: ActionInput): GeoAction | null {
  const pos = input.averageMentionPosition;
  if (pos === null || pos <= 0) {
    return null;
  }
  const band = RANK_LIFT_TABLE.find((b) => pos <= b.maxRank);
  if (!band) {
    return null;
  }

  if (band.tone === "risk") {
    return {
      kind: "rank_strategy",
      priority: 2,
      title: DEFEND_TITLE,
      evidence: `AI 답변에서 평균 ${pos}번째로 언급됩니다(사실상 1순위).`,
      how:
        "이 구간에서는 통계·인용문을 더 넣는 최적화가 오히려 노출을 떨어뜨린다는 실험 결과가 있습니다" +
        "(1위 사이트 −30%). 지금은 새 최적화보다 ①경쟁사가 치고 올라오는지 추세 감시 " +
        "②기존에 인용되는 페이지가 사라지거나 낡지 않게 유지하는 쪽이 안전합니다.",
      source: "Princeton GEO 논문(KDD 2024) Table 2 — Rank1 −30.3%",
    };
  }

  if (band.tone === "flat") {
    return {
      kind: "rank_strategy",
      priority: 2,
      title: "상위권 — 최적화 효과가 크지 않은 구간입니다",
      evidence: `AI 답변에서 평균 ${pos}번째로 언급됩니다.`,
      how:
        "이 구간은 콘텐츠 최적화만으로 얻는 이득이 작습니다(+3% 내외). " +
        "순위를 더 올리기보다, 아직 언급되지 않는 다른 질문(프롬프트)으로 노출 면적을 넓히는 쪽이 효율적입니다.",
      source: "Princeton GEO 논문 Table 2 — Rank2 +2.5%",
    };
  }

  // 🔴 감사 6번 동일 적용: 제목 "기대 +115%" vs 출처 "최대 +115.1%" — **최댓값을 기댓값으로**
  //   팔고 있었다(115는 Table 2에서 Rank5 한 구간의 값이다).
  //   지키지 못할 약속은 토스 심사 탈락 기준이자 다크패턴 자가진단 항목 →
  //   숫자는 **최댓값이라고 정직하게** 말하고, 제목은 숫자 없이 방향만 말한다.
  return {
    kind: "rank_strategy",
    priority: 3,
    title: "지금이 최적화 효과가 가장 큰 구간입니다",
    evidence: `AI 답변에서 평균 ${pos}번째로 언급됩니다(하위권).`,
    how:
      "하위 노출 브랜드일수록 콘텐츠 최적화 효과가 큽니다. 아래 '콘텐츠 보강' 액션부터 실행하세요. " +
      "같은 작업을 1위 브랜드가 하면 오히려 손해라, 지금이 격차를 좁힐 기회입니다.",
    source: `Princeton GEO 논문 Table 2 — 하위 순위 최대 +${band.lift}%`,
  };
}

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
          ? "이 질문에 정면으로 답하는 페이지를 만드세요. 제목에 질문을 그대로 쓰고, " +
            "첫 문단에서 결론부터 제시하는 구조가 AI가 인용하기 좋습니다."
          : "위와 같은 방식으로 이 질문 전용 섹션을 만들거나, 기존 FAQ에 항목으로 추가하세요. " +
            "질문 문구를 소제목으로 그대로 쓰는 것이 핵심입니다.",
      source: "우리 측정 데이터 — 프롬프트별 언급 여부",
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

  // 자사 편중 = 남이 우리를 얘기해주지 않는 상태.
  if (pct(mix.owned) >= OWNED_HEAVY_PCT) {
    return {
      kind: "source_portfolio",
      priority: 3,
      title: "AI가 우리 사이트만 보고 있습니다 — 제3자 언급이 필요합니다",
      evidence: `인용 출처의 ${pct(mix.owned)}%가 자사 도메인입니다(외부 ${100 - pct(mix.owned)}%). AI가 우리 주장만 근거로 삼는 상태입니다.`,
      how:
        "AI는 여러 출처가 같은 말을 할 때 더 확신을 갖고 인용합니다. 우선순위대로: " +
        "①업계 매체 기고·보도자료(가장 빠르게 잡힘) " +
        "②비교·추천 리스트 등재('○○ 추천 TOP5' 형태 글에 포함되기) " +
        `③커뮤니티 Q&A 답변(${communityChannelHint(input.marketScope ?? "both")}). ` +
        "핵심은 우리 도메인 밖에서 브랜드명이 등장하는 문서 수를 늘리는 것입니다.",
      source:
        "Ahrefs 75K 브랜드 분석 — 웹 멘션 상관 0.664(백링크 0.218). ※상관이며 인과 아님",
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
        "제품 사양·가격·FAQ를 한 페이지에 정리하고, 질문 문구를 소제목으로 그대로 쓰면 " +
        "AI가 자사 페이지를 근거로 채택할 확률이 올라갑니다.\n" +
        "③ 그 채널에 우리 콘텐츠를 직접 올리는 것도 유효합니다. " +
        "AI가 이미 그 채널을 신뢰하고 있다는 뜻이니, 그곳에 정확한 정보를 두는 게 빠릅니다.",
      source: "우리 측정 데이터 — 실제 인용된 출처 도메인·건수",
    };
  }

  return null;
}

// ──────────────────────────────────────────────────
// ⑤ 콘텐츠 보강 — 논문이 검증한 문장 단위 처방
// ──────────────────────────────────────────────────

function contentFixAction(input: ActionInput): GeoAction | null {
  // 인지가 아예 없으면 콘텐츠 보강보다 존재 자체를 먼저 만들어야 한다.
  if (input.enginesMentioned === 0) {
    return {
      kind: "content_fix",
      priority: 3,
      title:
        "등록 브랜드로 확인된 답변이 없습니다 — 먼저 '알려진 사실'을 만드세요",
      evidence: `측정한 AI ${input.enginesMeasured}곳 중 등록한 ${input.brandName}로 확인된 답변은 0개였습니다.`,
      how:
        "AI는 여러 곳에 반복 등장하는 정보를 학습합니다. ①공식 소개 페이지에 " +
        "'무엇을 하는 회사인지' 한 문단으로 명확히 쓰고 ②위키·업계 디렉터리·보도자료처럼 " +
        "제3자가 검증 가능한 자리에 같은 사실을 남기세요. 이름만 반복하는 건 효과가 없습니다.",
      source: "우리 측정 데이터 — 등록 브랜드 확인률 0%",
    };
  }

  // 🔴 감사 6번(2026-08-07 세션N-8): **카드 1개당 숫자 1개.**
  //   거절 사유: *"'최대 +41%'와 'Princeton +132.4% 사례'가 같은 카드에 —
  //   하나는 최대, 하나는 사례. 이런 숫자 섞기를 보면 나머지 데이터도 의심한다"*
  //   이 카드 하나에 **뜻이 다른 숫자가 4종** 있었다:
  //     ① 제목 "최대 +41%"(Table 1 최댓값) ② 본문 +41/31/27%(방법별 평균)
  //     ③ 출처 "+132.4%"(Table 4의 **단일 최고 사례**, 다른 표·다른 조건)
  //   → **Table 1 평균 하나로 통일**한다. +132.4%는 체리피킹이라 제거
  //     (남기면 고객이 132%를 기대하는데 실제 근거는 41%다 = 지키지 못할 약속).
  //   본문의 방법별 수치는 "무엇부터 할지" 순서를 정하는 근거라 남긴다 —
  //   **같은 표·같은 기준(베이스라인 19.3 대비)** 이므로 섞임이 아니다.
  const { quotation, statistics, citeSources } = GEO_METHOD_LIFT;
  return {
    kind: "content_fix",
    priority: 3,
    title: `인용되는 페이지에 '근거 문장'을 추가하세요 (실험 평균 +${quotation.liftPct}%)`,
    evidence: `AI ${input.enginesMeasured}곳 중 ${input.enginesMentioned}곳이 ${input.brandName}${objectParticle(input.brandName)} 인지했습니다. 이 측정은 노출 상태를 보여주며, 편집 변경의 효과는 같은 조건으로 다시 측정해야 확인할 수 있습니다.`,
    how:
      `실험에서 효과가 검증된 순서대로: ①${quotation.label}(전문가·고객 인용문, +${quotation.liftPct}%) ` +
      `②${statistics.label}(구체 수치, +${statistics.liftPct}%) ` +
      `③${citeSources.label}(출처 표기, +${citeSources.liftPct}%). ` +
      "실제 원문에서 확인한 수치와 측정 조건을 함께 적고 원출처를 연결하세요. " +
      "수치가 없다면 임의의 예시를 만들지 말고 확인 가능한 사실만 씁니다.",
    source: "Princeton GEO 논문(KDD 2024) Table 1 — 인용문 추가 시 평균 +41%",
  };
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
      "GEO/AI 최적화로 흔히 권해지지만, 실험·대규모 조사에서 효과가 확인되지 않은 방법들입니다.",
    how:
      "①키워드 반복 삽입 — 실험에서 아무것도 안 한 것보다 낮았습니다(17.7 vs 19.3). " +
      "②llms.txt 파일 생성 — 30만 도메인 조사에서 상관 0이고, Google도 " +
      "'AI용 파일을 새로 만들 필요 없다'는 입장입니다. " +
      "③구조화 데이터(스키마)만 믿기 — ChatGPT·Perplexity·Claude 직접 인용에는 효과가 확인되지 않았습니다" +
      "(검색 경유 노출에는 도움이 될 수 있어 완전히 무용하진 않습니다).",
    source:
      "Princeton GEO 논문 Table 1 · SE Ranking 30만 도메인 · Google 공식 문서",
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

  const rank = rankStrategyAction(input);

  // 🔴🔴 **1순위권에는 「콘텐츠 보강」을 내지 않는다** (N-46 전수조사 · 1,024조합 중 144건).
  //
  //   이 두 액션은 **정반대 처방**이다:
  //     · `rank_strategy`(1순위권) = *"더 밀어붙이지 마라 — 최적화가 노출을 떨어뜨린다"*
  //     · `contentFix`            = *"근거 문장을 추가하라(+41%)"*
  //   그런데 `contentFixAction` 은 **순위를 보지 않아서** 둘이 **같은 화면에 함께** 떴다.
  //   게다가 정렬이 `priority` 만 보므로 content(P3)가 rank(P2)보다 **위에** 온다
  //   → 1위 브랜드가 **틀린 조언을 먼저 읽는다**. 논문 기준 그대로 하면 **−30.3%**.
  //
  //   📕 `reference_geo_competitor_screens_4`: *"상위 노출 브랜드에는 GEO 최적화가 역효과.
  //   이 사실을 액션에 반영한 경쟁사는 확인된 바 없다(**최대 차별화 지점**)"*
  //   ⭐ 그 차별화 지점이 자기 화면에서 무너져 있었다.
  //
  //   ⚠️ **문구로 덮지 않고 발행 자체를 막는다** — 한 화면에 반대 조언이 공존하면
  //   단서를 붙여도 고객은 헷갈린다(👤 A안).
  const rankSaysDefend = rank?.title === DEFEND_TITLE;
  const content = rankSaysDefend ? null : contentFixAction(input);
  if (content) {
    actions.push(content);
  }
  actions.push(...promptGapActions(input));

  const portfolio = sourcePortfolioAction(input);
  if (portfolio) {
    actions.push(portfolio);
  }
  if (rank) {
    actions.push(rank);
  }

  // 🔴 **「하지 마세요」는 상한에서 제외한다** (N-46 · 1,024조합 중 352건이 상한 도달).
  //   `avoid` 는 P1(가장 낮음)이라 상한에 걸리면 **항상 먼저 잘렸다.**
  //   그런데 이 카드는 *"키워드 반복·llms.txt·스키마만 믿기 = 효과 없음"* 을 알리는
  //   **돈·시간 낭비를 막는 유일한 카드**다. 문제가 많은 고객일수록 액션이 많아
  //   **이걸 못 보게 되는 역진적 구조**였다.
  //   → 상한은 «해야 할 일»에만 적용하고, «하지 말 것»은 항상 맨 아래 붙인다.
  const todo = actions
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_ACTIONS);
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
