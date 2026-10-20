// packages/audit/measurement-stats.ts — A0 오차 범위 계산기 (순수 함수, 2026-10-21)
//
// 하는 일: 「몇 번 중 몇 번」을 오차 범위(Wilson 95% 구간)로 바꾼다. 비율은 0~1 소수이며 반올림하지 않는다
//   (answer-buckets 의 bucketRate 0~100 정수와 섞지 않는다 — K0 규칙 4).
// 하지 않는 일: DB·환경변수·외부 호출, 판정 재계산, 점수 계산. 입력 숫자만 본다.
//
// 🔴 「k=0 도 0% 가 아니라 구간으로」: 8번 물어 0번 나왔다고 해서 진짜 비율이 0 이라는 뜻이 아니다.
//   Wilson 구간은 횟수가 적어도 쓸 수 있는 오차 범위 계산법이라, k=0 이면 [0, 약 0.324](n=8)처럼
//   「위쪽 끝이 0 보다 크다」를 그대로 보여 준다. 반대로 k=n 도 1.0 확정이 아니라 [약 0.676, 1] 이다.
//
// 식(z = 1.959963984540054, 양쪽 95%):
//   p      = k / n
//   center = (p + z²/(2n)) / (1 + z²/n)
//   half   = z · √( p(1−p)/n + z²/(4n²) ) / (1 + z²/n)
//   구간   = [center − half, center + half]  (0~1 로 자름 — 부동소수 오차 때문에 −1e-17 이 나오는 것만 막는다)
//
// successes 는 소수여도 된다. 같은 질문을 여러 번 물은 반복은 독립 표본이 아니므로 A1-a 가
//   「질문×엔진 칸」을 n 으로, 칸별 평균 노출률의 합을 k 로 넣는다(repeat-aggregate.ts).
//
// 값이 없으면 0 이 아니라 Known 의 unavailable(+사유)로 돌려준다(K0 규칙 3).

import type { Interval, Known } from "./proof-types";

/** 양쪽 95% 정규 분위수. 정수 반올림 없이 그대로 쓴다. */
export const Z_95 = 1.959_963_984_540_054;

/**
 * 분자/분모 비율(0~1). **분모가 0 이하이거나 숫자가 아니면 null — 0 이 아니다.**
 * 「측정하지 못함」과 「0건」은 다른 상태다.
 */
export function safeRatio(part: number, whole: number): number | null {
  if (!(Number.isFinite(part) && Number.isFinite(whole)) || whole <= 0) {
    return null;
  }
  return part / whole;
}

/**
 * Wilson 95% 구간.
 *
 * @param successes 성공(노출) 수. 0 이상 total 이하. 소수 허용(칸별 평균 노출률의 합).
 * @param total 시도 수(분모). 0 이하면 계산하지 않는다.
 * @param asOf 기준일(ISO). 모르면 null — null 은 최신이라는 뜻이 아니다.
 */
export function wilsonInterval(
  successes: number,
  total: number,
  asOf: string | null = null
): Known<Interval> {
  if (!(Number.isFinite(successes) && Number.isFinite(total))) {
    return {
      as_of: asOf,
      detail_ko: "입력값이 숫자가 아니라 구간을 계산하지 않음",
      reason: "source_missing",
      status: "unavailable",
    };
  }
  if (total <= 0) {
    return {
      as_of: asOf,
      detail_ko: "분모(시도 수)가 0 이라 구간을 계산하지 않음",
      reason: "insufficient_sample",
      status: "unavailable",
    };
  }
  if (successes < 0 || successes > total) {
    return {
      as_of: asOf,
      detail_ko: "성공 수가 0~분모 범위를 벗어나 구간을 계산하지 않음",
      reason: "source_missing",
      status: "unavailable",
    };
  }
  const p = successes / total;
  const z2 = Z_95 * Z_95;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const half =
    (Z_95 * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) /
    denominator;
  return {
    as_of: asOf,
    status: "known",
    value: {
      confidence: 0.95,
      high: Math.min(1, center + half),
      low: Math.max(0, center - half),
      method: "wilson",
    },
  };
}
