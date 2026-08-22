/*
 * 정기결제 다음 청구일 계산 — 월말 경계 고정. 2026-08-12 세션N-25.
 *
 * 왜 테스트하나: 청구일 계산은 **라이브에서 확인이 안 된다**(테스트 채널은 실제 청구가
 *   없고, 월말 버그는 가입 한 달 뒤에야 드러난다). 순수 함수로 빼서 여기서 고정한다.
 */

import {
  addMonthsClamped,
  nextBillingDate,
} from "@repo/payments/billing-cycle";
import { describe, expect, it } from "vitest";

describe("nextBillingDate — 보통 달", () => {
  it("15일 가입 → 다음 달 15일", () => {
    expect(
      nextBillingDate(new Date("2026-08-15T10:30:00Z")).toISOString()
    ).toBe("2026-09-15T10:30:00.000Z");
  });

  it("시각(시·분·초)을 그대로 유지한다", () => {
    const from = new Date("2026-03-10T23:59:58.123Z");
    const next = nextBillingDate(from);
    expect(next.getUTCHours()).toBe(23);
    expect(next.getUTCMinutes()).toBe(59);
    expect(next.getUTCSeconds()).toBe(58);
    expect(next.getUTCMilliseconds()).toBe(123);
  });
});

describe("nextBillingDate — 🔴 월말(이게 이 파일의 존재 이유)", () => {
  it("1/31 → 2/28 (2월 31일로 넘어가지 않는다)", () => {
    expect(
      nextBillingDate(new Date("2026-01-31T09:00:00Z")).toISOString()
    ).toBe("2026-02-28T09:00:00.000Z");
  });

  it("윤년 2월은 29일로 붙는다 (2028년)", () => {
    expect(
      nextBillingDate(new Date("2028-01-31T09:00:00Z")).toISOString()
    ).toBe("2028-02-29T09:00:00.000Z");
  });

  it("31일 → 30일뿐인 달은 30일 (5/31 → 6/30)", () => {
    expect(
      nextBillingDate(new Date("2026-05-31T09:00:00Z")).toISOString()
    ).toBe("2026-06-30T09:00:00.000Z");
  });

  it("12월 → 다음 해 1월로 연도가 넘어간다", () => {
    expect(
      nextBillingDate(new Date("2026-12-31T09:00:00Z")).toISOString()
    ).toBe("2027-01-31T09:00:00.000Z");
  });
});

describe("addMonthsClamped", () => {
  it("여러 달을 한 번에 더해도 말일 보정이 유지된다 (1/31 +13개월 → 2027-02-28)", () => {
    expect(
      addMonthsClamped(new Date("2026-01-31T00:00:00Z"), 13).toISOString()
    ).toBe("2027-02-28T00:00:00.000Z");
  });

  it("🔴 매달 '원래 날짜'가 아니라 직전 청구일 기준이면 날짜가 앞당겨진 채 굳는다", () => {
    // 1/31 → 2/28 까지는 정상. 그런데 2/28 을 기준으로 다시 더하면 3/28 이 된다.
    // (= 31일로 되돌아오지 않는다) — 호출부는 **최초 가입일**을 기준으로 누적해야 한다.
    const first = nextBillingDate(new Date("2026-01-31T00:00:00Z"));
    expect(nextBillingDate(first).toISOString()).toBe(
      "2026-03-28T00:00:00.000Z"
    );
    // 최초 가입일 기준으로 2개월을 더하면 3/31 로 제대로 돌아온다.
    expect(
      addMonthsClamped(new Date("2026-01-31T00:00:00Z"), 2).toISOString()
    ).toBe("2026-03-31T00:00:00.000Z");
  });
});
