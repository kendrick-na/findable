// GEO 점수 5축 — 단일 진실 (audit-result UI · 리드메일 · OG 이미지 공유)
//
// 배경(2026-07-30 결과페이지 결함감사 §14): 채점이 audit-result.tsx와 lead
// route에 각각 구현돼 서로 다른 값을 냈고(recognition 분모: 중복 포함 raw vs
// 고유 엔진 수), OG 이미지는 SoV를 GEO 점수처럼 표기했다. 이 모듈로 통일한다.
//
// 재설계 2건(같은 감사 §14):
//   - sentiment(40): 기존 ((pos−neg)/total+1)×20 은 "전부 중립"을 20/40으로
//     벌점 처리. 중립 서술은 결함이 아니므로 기준선을 0.75로 올리고, 부정만
//     강하게 감점: 40×(0.75 + 0.25×pos비율 − neg비율). 전부 중립 = 30/40.
//   - presence(20): 기존 도메인수×4 는 topCitedDomains가 top-5 리스트라
//     사실상 상시 만점. 집중도(HHI)를 반영해 "출처 존재 기본 4점 + 분산도
//     16점"으로: 4 + 16×(1−HHI). 한 도메인 쏠림(64%↑)이면 점수가 내려간다.
//   - recognition(20): 분모에서 "측정 실패(오류) 엔진"을 제외. 측정 실패는
//     브랜드 미인지가 아니다(감사 §13과 동일 원칙).

export interface GeoScoreMetrics {
  /**
   * 순위가 나온 목록들의 평균 크기(분모). competition 의 **경쟁 규모 가중**에 쓴다.
   * `averageRelativePosition` 과 **둘 다 있어야** 새 채점식이 작동한다(하나만 있으면 폴백).
   */
  averageMentionListSize?: number | null;
  averageMentionPosition: number | null;
  /**
   * 상대 위치 0~1 (0=목록 맨 앞). 세션N-10(2026-08-07) 신설 — competition 채점의 **우선** 입력.
   * 없으면(도입 전 측정분) `averageMentionPosition` 폴백. 자세한 이유는 아래 competition 주석.
   */
  averageRelativePosition?: number | null;
  enginesCovered: string[];
  enginesWithMention: string[];
  errors?: Array<{ engineId: string; message: string }>;
  sentimentDistribution?: {
    positive: number;
    neutral: number;
    negative: number;
  };
  sov: number;
  /** API 키 미설정 등으로 만들어진 가짜 응답 수. 인지도 분모에서 제외한다. */
  stubCount?: number;
  topCitedDomains?: Array<{ domain: string; count: number }>;
}

// ⚠️ `*Cap`·`recognitionRate` = M1(2026-08-07 세션N-8) 표시용 파생값.
//   화면이 recognitionRate 를 **다시 계산하면** 감사 §10(임계값 76/51/26 3중 복제)과
//   똑같은 사고가 난다(한 곳만 고치면 화면·메일·OG가 어긋남). 여기서 단 한 번 계산해 넘긴다.
//   ⚠️ 점수(sentiment·presence·total)는 **1도 바뀌지 않는다** — total 계산에 미참여.
//   (아래 멤버 순서는 lint `useSortedInterfaceMembers` 강제라 의미 단위로 묶이지 않는다.)
export interface GeoAxisScores {
  /** 경쟁 위치(평균 순위) 0~10 */
  competition: number;
  /** 노출 품질(인용 출처 다양성) 0~20 */
  presence: number;
  /** [표시용] 노출의 실효 만점 = 20 × recognitionRate */
  presenceCap: number;
  /** 브랜드 인지(측정 성공 엔진 중 언급 비율) 0~20 */
  recognition: number;
  /** [표시용] 감성·노출에 곱해진 인지 비율 0~1. 두 축의 실효 상한을 정하는 선행 값. */
  recognitionRate: number;
  /** 감정 분석 0~40 (= raw × recognitionRate — 인지도 종속) */
  sentiment: number;
  /** [표시용] 감성의 실효 만점 = 40 × recognitionRate (인지도가 허용하는 최대치) */
  sentimentCap: number;
  /** 점유율 0~10 */
  sov: number;
  /** 5축 합계 = GEO 점수 0~100 */
  total: number;
}

// ──────────────────────────────────────────────────────────────────
// 등급 임계값 — 단일 진실 (2026-08-07 세션N-8, 감사 10번)
//
// 이전엔 76/51/26 이 **3곳에 복제**돼 있었다: 화면(`audit-result.tsx`) ·
// 메일(`lead/route.ts` `tierLabel`) · OG 이미지(`og/route.tsx` `tier`).
// 하나만 바꾸면 **화면·메일·공유 이미지가 서로 다른 등급**을 말한다.
// 같은 계열 사고가 이미 한 번 OG 이미지를 깨뜨린 전례가 있다(결함감사 §OG).
// → 점수를 만드는 곳(이 파일)이 등급도 정한다. 임계값 변경은 **여기 한 곳**만.
//
// ⚠️ 실측(세션N): 임계값 자체는 정상 — 인지100%·감성 절반긍정이면 80점=리더 도달 가능.
export const SCORE_TIERS = {
  leader: 76,
  competitive: 51,
  emerging: 26,
} as const;

export type ScoreTier = "leader" | "competitive" | "emerging" | "critical";

/** 총점 → 등급 키. ⚠️ SoV가 아니라 **GEO 총점**을 넘길 것(이름-값 불일치 전례 있음). */
export function scoreTier(totalScore: number): ScoreTier {
  if (totalScore >= SCORE_TIERS.leader) {
    return "leader";
  }
  if (totalScore >= SCORE_TIERS.competitive) {
    return "competitive";
  }
  if (totalScore >= SCORE_TIERS.emerging) {
    return "emerging";
  }
  return "critical";
}

/** 등급 한글 라벨 — 화면·메일·OG가 공유하는 표기. */
export const TIER_LABEL_KO: Record<ScoreTier, string> = {
  leader: "리더",
  competitive: "경쟁 가능",
  emerging: "막 시작",
  critical: "AI에서 안 보임",
};

export const TIER_LABEL_EN: Record<ScoreTier, string> = {
  leader: "Market Leader",
  competitive: "Competitive Position",
  emerging: "Emerging Presence",
  critical: "Critical Gap",
};

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * competition 의 "경쟁 규모 가중"이 만점(1.0)에 도달하는 목록 크기(세션N-10).
 * 이 크기 이상이면 충분한 경쟁으로 보고 자리 점수를 그대로 준다.
 * 5 = 저장 원문 재실행 실측 분포의 최빈값(분모 2·3·4·5 중 5가 최다).
 * AI 답변의 "추천 목록"이 대개 5개라는 관찰과 일치한다.
 */
const FULL_COMPETITION_SIZE = 5;

/** 중복 포함 리스트(프롬프트×엔진)에서 고유 엔진 수. */
export function uniqueEngineCount(list: string[]): number {
  return new Set(list).size;
}

/** 측정 실패(오류)가 난 고유 엔진 수. */
export function erroredEngineCount(metrics: GeoScoreMetrics): number {
  return new Set((metrics.errors ?? []).map((e) => e.engineId)).size;
}

/** 측정에 실제 성공한 고유 엔진 수(오류 엔진 제외). 최소 1 보장 없음 — 호출부에서 방어. */
export function measuredEngineCount(metrics: GeoScoreMetrics): number {
  return Math.max(
    uniqueEngineCount(metrics.enginesCovered) - erroredEngineCount(metrics),
    0
  );
}

/** 실제 응답을 받은 횟수. 오류와 stub을 미노출로 오인하지 않기 위한 공통 분모다. */
export function successfulResponseCount(metrics: GeoScoreMetrics): number {
  return Math.max(
    metrics.enginesCovered.length -
      (metrics.errors?.length ?? 0) -
      (metrics.stubCount ?? 0),
    0
  );
}

export function geoAxisScores(metrics: GeoScoreMetrics): GeoAxisScores {
  const dist = metrics.sentimentDistribution ?? {
    positive: 0,
    neutral: 0,
    negative: 0,
  };
  const sentTotal = dist.positive + dist.neutral + dist.negative;

  // ⚠️ 2026-07-31 세션K — 인지도 게이트.
  //   실측: 무명 사이트(forget.sh 89 · 5throck 86 · 윈디플로 96)가 나이키(97)와 같은 대역,
  //   Tesla(69)보다 높게 나왔다. 원인은 "AI가 브랜드를 모르는데도" sentiment 기준선 30점과
  //   presence 기본점이 자동 지급되는 구조였다(전체의 40점 가까이가 무조건 들어옴).
  //   → 감성·노출은 **브랜드가 실제로 인지된 만큼만** 유효하다고 본다.
  //   recognitionRate 0 이면 감성·노출 점수도 0 으로 수렴한다.
  //   (인지 없는 브랜드에 "감성이 중립적이라 좋다"는 점수를 줄 근거가 없다.)
  // ⚠️ 2026-08-02 세션M(F11) — 고유 엔진 → **응답 빈도** 기준으로 변경.
  //   기존 `고유언급엔진 / 고유측정엔진` 은 "한 프롬프트라도 언급되면 그 엔진은 만점"이라
  //   **4번 물어 1번 언급**과 **4번 다 언급**을 동일 취급했다.
  //   라이브 실측(최근 8건): recognitionRate 가 **전부 1.00** — 무명 개인 블로그·깃허브 페이지·
  //   나이키가 모두 인지도 만점으로, 브랜드를 구분하지 못하는 사실상의 상수였다.
  //   실제 언급 빈도는 79~94% 로 갈리고, 권역별로는 SK하이닉스 한국 50% vs 글로벌 100%.
  //   → 분자·분모를 **응답 단위**로 바꿔 빈도 정보를 살린다.
  //   영향(실측 8건): 3~11점 하락, 평균 −6.4. 나이키 −3 / SK하이닉스 −11 로 **변별력 발생**
  //   (기존엔 68~71 로 전부 뭉쳐 있었다).
  //   ⚠️ 점수 체계 변경이라 기존 시계열과 단절된다. 실고객 0명 시점에 일괄 적용(사용자 승인 2026-08-02).
  const usableResponses = successfulResponseCount(metrics);
  const recognitionRate =
    usableResponses > 0
      ? clamp(0, 1, metrics.enginesWithMention.length / usableResponses)
      : 0;

  // 전부 중립 = 30/40 기준선. 긍정은 최대 +10, 부정은 비율만큼 최대 −40.
  //   여기에 인지도 게이트를 곱해 "모르는 브랜드"의 자동 득점을 차단한다.
  const sentimentRaw =
    sentTotal === 0
      ? 30
      : clamp(
          0,
          40,
          Math.round(
            40 *
              (0.75 +
                0.25 * (dist.positive / sentTotal) -
                dist.negative / sentTotal)
          )
        );
  const sentiment = Math.round(sentimentRaw * recognitionRate);

  // 노출 품질: 출처가 하나라도 있으면 4점 + 도메인 분산도(1−HHI)로 16점.
  const domains = metrics.topCitedDomains ?? [];
  const citeTotal = domains.reduce((sum, d) => sum + d.count, 0);
  const hhi =
    citeTotal === 0
      ? 1
      : domains.reduce((sum, d) => sum + (d.count / citeTotal) ** 2, 0);
  //   인지도 게이트 동일 적용: 브랜드를 모르는데 인용 출처가 다양하다고 점수를 줄 수 없다
  //   (검색엔진이 질의어로 아무 문서나 물어온 경우가 대부분 — 세션K 인용 오염 실측).
  const presenceRaw =
    citeTotal === 0 ? 0 : clamp(0, 20, 4 + Math.round(16 * (1 - hhi)));
  const presence = Math.round(presenceRaw * recognitionRate);

  // 브랜드 인지: 측정 성공 엔진 중 언급 엔진 비율.
  const recognition = clamp(0, 20, Math.round(recognitionRate * 20));

  const sov = clamp(0, 10, Math.round((metrics.sov ?? 0) / 10));

  // 경쟁 위치(10점) — 세션N-10(2026-08-07) 개정.
  //
  // 🔴 개정 이유 2가지:
  //   ① 기존 `11 - avgPos*2` 는 **분모를 안 봤다**. *"2개 중 1위"* 와 *"50개 중 1위"* 가
  //      똑같이 9점이었다. 앞의 것은 사실상 경쟁이 없는 목록이다.
  //   ② 그 위에 `estimateMentionPosition` 의 **가짜 1위 폴백**(목록에 브랜드가 없어도 1위)이
  //      얹혀 있었다. 실측: 완료 71건 중 58건(82%)이 순위를 보유해 평균 8.76/10 을 받고 있었고,
  //      저장 원문 재실행 결과 순위 보유 26건 중 **11건(42%)이 그 가짜**였다.
  //      폴백은 utils.ts 에서 제거했고, 여기서는 **분모를 반영**한다.
  //
  // 새 척도 = **자리 점수 × 경쟁 규모 가중**. 두 요소를 곱하는 이유:
  //   · 자리(`1 - relative`) 만 쓰면 *"2개 중 1위"* 와 *"50개 중 1위"* 가 **똑같이 만점**이 된다
  //     — 고치려던 문제가 그대로 남는다(설계 중 경계 테스트로 잡음).
  //   · 규모만 쓰면 큰 목록의 꼴찌가 작은 목록의 1위보다 높아진다.
  //   → `10 × 자리 × 규모` 로 둘을 함께 본다.
  //
  // 규모 가중 = `min(1, (listSize - 1) / (FULL_COMPETITION - 1))`.
  //   후보가 1개면 0(경쟁이 아니다) · 5개 이상이면 1(충분한 경쟁으로 본다).
  //   기준 5는 **실측 분포**에서 왔다: 저장 원문 재실행 시 분모가 2·3·4·5 에 퍼져 있고
  //   최빈값이 5(9건 중 9건)였다. AI 답변의 "추천 목록"이 대개 5개라는 뜻이다.
  //
  // 예시: "5개 중 1번째"=10점 · "5개 중 3번째"=5점 · "5개 중 5번째"=0점
  //      · "2개 중 1번째"=**3점**(경쟁이 얕다) · "50개 중 1번째"=10점
  //
  // ⚠️ 폴백 경로(도입 전 측정분): 분모가 없으면 기존 식을 그대로 쓴다. 소급 재계산이
  //   불가능한 과거 데이터의 점수를 임의로 흔들지 않기 위함이다(시계열 연속성).
  const relPos = metrics.averageRelativePosition;
  const avgListSize = metrics.averageMentionListSize;
  const avgPos = metrics.averageMentionPosition;
  let competition: number;
  if (
    relPos !== null &&
    relPos !== undefined &&
    avgListSize !== null &&
    avgListSize !== undefined
  ) {
    const scale = Math.min(
      1,
      Math.max(0, (avgListSize - 1) / (FULL_COMPETITION_SIZE - 1))
    );
    competition = clamp(0, 10, Math.round(10 * (1 - relPos) * scale));
  } else if (avgPos === null || avgPos === undefined) {
    competition = 0;
  } else {
    competition = clamp(0, 10, Math.round(11 - avgPos * 2));
  }

  return {
    sentiment,
    presence,
    recognition,
    sov,
    competition,
    total: sentiment + presence + recognition + sov + competition,
    // 표시용 파생값 — 점수에 영향 없음(위 total 계산에 미참여).
    recognitionRate,
    sentimentCap: Math.round(40 * recognitionRate),
    presenceCap: Math.round(20 * recognitionRate),
  };
}
