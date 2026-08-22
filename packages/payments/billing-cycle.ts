/*
 * 정기결제 주기 계산 — 다음 청구일을 구한다. 2026-08-12 세션N-25.
 *
 * 왜 파일을 나눴나: `portone.ts` 는 `server-only` + fetch 라 테스트에서 부를 수 없다.
 *   날짜 계산은 **순수 함수**라 고정할 수 있으므로 여기로 뺀다.
 *   (교훈: 라이브에서 확인 못 하는 경로는 순수 함수로 빼서 테스트로 고정한다.)
 *
 * 🔴 이 파일이 존재하는 진짜 이유 = **월말 문제**.
 *   1월 31일에 가입한 고객의 다음 청구일은 2월 31일이 아니다.
 *   JS `Date` 는 2월 31일을 **3월 3일로 조용히 넘긴다**(overflow) — 그대로 쓰면
 *   청구일이 매달 뒤로 밀리고, 고객에게 고지한 "매월 같은 날"과 어긋난다.
 *   → 말일을 넘기면 **그 달의 마지막 날로 붙인다**(업계 표준).
 *
 * ⚠️ 시각(시·분)은 가입 시각을 그대로 유지한다. 날짜만 옮긴다.
 */

/** 그 달의 마지막 날(1~31). `Date` 의 day=0 은 전월 말일을 뜻한다. */
function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * `from` 으로부터 `months` 개월 뒤의 같은 날짜를 돌려준다.
 * 대상 달에 그 날짜가 없으면(1/31 → 2월) **그 달 말일로 붙인다**.
 *
 * @param from 기준 시각(보통 이번 회차 결제 시각)
 * @param months 더할 개월 수(기본 1 — 월 구독)
 */
export function addMonthsClamped(from: Date, months = 1): Date {
  const year = from.getUTCFullYear();
  const monthIndex = from.getUTCMonth();
  const day = from.getUTCDate();

  const targetMonth = monthIndex + months;
  const targetYear = year + Math.floor(targetMonth / 12);
  // JS 의 `%` 는 음수에서 음수를 내므로 12를 더해 정규화한다(과거 방향 계산 대비).
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;

  const clampedDay = Math.min(day, lastDayOfMonth(targetYear, normalizedMonth));

  return new Date(
    Date.UTC(
      targetYear,
      normalizedMonth,
      clampedDay,
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds()
    )
  );
}

/**
 * 다음 청구일. 월 구독이므로 1개월 뒤.
 *
 * ⚠️ 호출부는 이 값을 **화면 고지("차기 결제일")와 예약 API 에 똑같이** 써야 한다.
 *   두 곳이 다른 값을 쓰면 고지와 실제 청구가 어긋난다(심사·표시광고 리스크).
 */
export function nextBillingDate(from: Date): Date {
  return addMonthsClamped(from, 1);
}
