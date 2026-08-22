/**
 * 지표 사전 — **뜻·형식·방향·분모의 단일 진실** (2026-08-16 세션N-34).
 *
 * 🔴 **왜 만들었나 (전수 감사 · 재설계안 v4 §4-a-1)**: 같은 개념을 화면마다 다르게 부르고,
 *   무엇보다 **분모 축 3종이 라벨 없이 섞여** 있었다. 이 저장소가 그것으로 세 번 사고를 냈다.
 *
 *     N-14  못 잰 것을 `0점`이라 부름  (apple.com — 28엔진 전멸인데 "손실 800세션/월")
 *     N-28  화면에 `우리를 아는 AI 7/6` · `117%`   (한 화면에 분모 규칙이 세 벌)
 *     N-30  `95%` 와 `7곳` 이 같은 화면에서 모순    (응답 축 vs 엔진 축)
 *
 *   세 사고의 원인은 전부 같다 — **분모가 무엇인지 코드가 말하지 않았다.**
 *   숫자는 맞는데 이름이 없어서, 다음 사람이(그리고 내가) 다른 축의 숫자를 나란히 놓았다.
 *
 * 🔒 **이 파일은 계산하지 않는다.** 뜻만 갖는다. 숫자는 기존 단일 진실이 계속 단독 담당한다:
 *
 *     measurement-coverage.ts  측정 성공/시도 집계
 *     geo-score.ts             점수 축·가중치
 *     rank-label.ts            순위 표기(분모·표본)
 *     market-scope.ts          엔진 권역 분류
 *
 *   → 여기에 계산을 넣으면 **단일 진실이 하나 더 늘어난다** = 만들려던 문제를 다시 만드는 것.
 *
 * ⚠️ **읽는 코드 없는 필드를 만들지 않는다** (프로젝트 규칙 · `Brand.language` 사고).
 *   이 사전의 모든 필드는 같은 커밋에서 화면에 연결된다. 연결처가 없는 항목은 추가하지 않는다.
 */

// ─────────────────────────────────────────────────────────────
// 1. 분모 축 — 🔴 사전의 1순위 임무
// ─────────────────────────────────────────────────────────────

/**
 * 우리가 실제로 쓰는 분모는 **세 종류**다. 이름이 없어서 사고가 났다.
 *
 * 🔴 **축이 다르면 두 숫자를 나란히 놓으면 안 된다.** `96%`(응답 축)와 `7곳`(엔진 축)은
 *   둘 다 맞는 값인데도 같은 줄에 있으면 독자가 하나를 다른 하나로 검산하려 든다
 *   (N-30 사고). 축 이름을 붙이는 것이 그걸 막는 유일한 방법이다.
 */
export type DenominatorAxis = "response" | "uniqueEngine" | "successRow";

export interface DenominatorAxisMeta {
  /** 이 축이 무엇을 세는지 평문 한 줄. 🔴 툴팁이 아니라 **본문에 쓸 수 있는** 문장. */
  description: string;
  /** 화면에 쓰는 짧은 이름. */
  label: string;
  /** 세는 단위(수량 뒤에 붙는 말). `AI 7곳` 의 `곳`. */
  unit: string;
}

export const DENOMINATOR_AXES: Record<DenominatorAxis, DenominatorAxisMeta> = {
  /**
   * **응답 축** — 프롬프트 × 엔진 = 한 줄. 실측 구조가 `엔진 7 × 프롬프트 4 = 28행` 이다.
   * ⚠️ 이 축의 수는 엔진 수보다 **항상 크다**. 엔진 수인 척하면 분모가 뻥튀기된다.
   */
  response: {
    label: "응답",
    unit: "개",
    description:
      "AI에게 던진 질문 하나에 대한 답변 하나입니다. 같은 AI라도 질문이 다르면 따로 셉니다.",
  },

  /**
   * **고유 엔진 축** — 같은 엔진에 4번 물어도 **1곳**.
   * 히어로 카드(`우리를 아는 AI 5/7`)가 쓰는 축이다.
   */
  uniqueEngine: {
    label: "AI",
    unit: "곳",
    description:
      "측정한 AI 서비스의 개수입니다. 같은 AI에 여러 번 물어봐도 한 곳으로 셉니다.",
  },

  /**
   * **성공 행 축** — 오류·미연결(stub)을 뺀 행.
   *
   * 🔴 **대시보드(`apps/app`)가 이 축을 쓴다** — 그리고 그건 **의도된 것이다**.
   *   `Tracking` 테이블은 저장 단계에서 실패·stub 행을 아예 안 쌓기 때문에(D5),
   *   대시보드의 분모는 **구조적으로** 성공 행이 된다
   *   (`dashboard-data.ts:376-380` 주석이 그렇게 명시한다).
   *   ⚠️ 그러므로 이것은 **고칠 버그가 아니라 이름을 붙일 축**이다.
   *   무료진단(`apps/web`)은 오류 행까지 손에 쥐고 있어 시도/성공을 둘 다 말할 수 있다 —
   *   두 앱의 숫자가 달라 보이는 진짜 이유가 이것이고, **문구로 밝히면 해소된다**.
   */
  successRow: {
    label: "측정 성공",
    unit: "개",
    description:
      "답변을 실제로 받아낸 것만 셉니다. 오류가 난 AI는 분모에서 빠집니다.",
  },
} as const;

/** 수량에 축 단위를 붙인다. `7` + `uniqueEngine` → `AI 7곳`. */
export function axisCountLabel(axis: DenominatorAxis, count: number): string {
  const meta = DENOMINATOR_AXES[axis];
  return `${meta.label} ${count}${meta.unit}`;
}

/** 분모 표기. `5` / `7` + `uniqueEngine` → `AI 7곳 중 5곳`. */
export function axisRatioLabel(
  axis: DenominatorAxis,
  part: number,
  total: number
): string {
  const meta = DENOMINATOR_AXES[axis];
  return `${meta.label} ${total}${meta.unit} 중 ${part}${meta.unit}`;
}

// ─────────────────────────────────────────────────────────────
// 2. 지표 메타
// ─────────────────────────────────────────────────────────────

/**
 * 🔴 **방향** — 순위 계열은 **낮을수록 좋다**. 화면에 그 표식이 없어서
 *   `3위`가 좋은 건지 나쁜 건지 고객이 알 수 없었다(v4 §4-a-2 축2).
 */
export type MetricDirection = "higher" | "lower";

export type MetricFormat = "percent" | "count" | "rank" | "score";

export interface MetricMeta {
  /** 이 지표가 서 있는 분모 축. 🔴 축이 다른 지표를 나란히 놓지 말 것. */
  axis: DenominatorAxis;
  /** 평문 한 줄 정의. 🔴 툴팁이 아니라 **항상 보이는 자리**에 쓴다(Scrunch f062 구조). */
  description: string;
  direction: MetricDirection;
  format: MetricFormat;
  /** 화면 라벨(명사형). */
  label: string;
  /** 카드 제목용 질문형. 대시보드의 라이팅 원칙 — 신조어를 피한다. */
  question: string;
}

/**
 * ⚠️ **이름을 여기서 새로 발명하지 않았다.** 화면에 이미 있는 말 중
 *   가장 널리 쓰이는 것을 골랐다(등장률 = app 6곳 · 무료진단 `우리 비중` 3곳).
 *   사전이 새 단어를 들고 오면 이름이 5개째가 될 뿐이다.
 */
export type MetricKey =
  | "sov"
  | "recognition"
  | "rank"
  | "sentiment"
  | "citation";

export const METRICS: Record<MetricKey, MetricMeta> = {
  /** 등장률 — 이름이 4개였던 그 지표(`우리 비중`·`언급률`·`SoV`·`등장률`). */
  sov: {
    label: "등장률",
    question: "AI가 우리를 얼마나 말하나?",
    description: "AI 답변 중 우리 브랜드가 등장한 비율입니다.",
    format: "percent",
    direction: "higher",
    axis: "response",
  },

  /** 인지 — `우리를 아는 AI`. 엔진 축이라 등장률과 분모가 다르다. */
  recognition: {
    label: "우리를 아는 AI",
    question: "AI가 우리를 아나?",
    description: "측정한 AI 중 우리 브랜드를 알고 답한 곳의 수입니다.",
    format: "count",
    direction: "higher",
    axis: "uniqueEngine",
  },

  /**
   * 순위 — 🔴 **낮을수록 좋다.** 분모(목록 크기)는 `rank-label.ts` 가 담당한다.
   * ⚠️ 분모가 없는 회차가 정상적으로 존재한다(N-10 이전 측정분) → 지어내지 않는다.
   */
  rank: {
    label: "평균 순위",
    question: "몇 번째로 말하나?",
    description:
      "AI가 여러 브랜드를 나열할 때 우리가 몇 번째로 나오는지입니다. 숫자가 작을수록 좋습니다.",
    format: "rank",
    direction: "lower",
    axis: "response",
  },

  /** 감성 — 유일하게 web·app 이름이 이미 일치하던 지표. */
  sentiment: {
    label: "긍정 비율",
    question: "좋게 말하나?",
    description: "우리를 언급한 답변 중 긍정적으로 서술한 비율입니다.",
    format: "percent",
    direction: "higher",
    axis: "response",
  },

  /**
   * 🔴 **인용 ≠ 등장.** 이 구분이 화면에 없어서 용어가 충돌했다
   *   (`naver-vs-ai-gap.tsx:250` 은 `인용`을 금지하는데 `truth-mirror` 는 그 말을 쓴다).
   *   **등장 = 답변 본문에 이름이 나옴 / 인용 = 출처 링크로 우리 페이지가 걸림.**
   */
  citation: {
    label: "인용",
    question: "우리 페이지를 출처로 다나?",
    description:
      "AI가 답변의 출처 링크로 우리 사이트를 건 것입니다. 답변 본문에 이름만 나오는 '등장'과는 다릅니다.",
    format: "count",
    direction: "higher",
    axis: "response",
  },
} as const;

/**
 * 방향 표식. 순위처럼 **낮을수록 좋은** 지표에만 꼬리표를 단다.
 * 높을수록 좋은 건 사람의 기본 직관이라 굳이 말하지 않는다(화면 소음).
 */
export function directionHint(key: MetricKey): string | null {
  return METRICS[key].direction === "lower" ? "낮을수록 좋음" : null;
}
