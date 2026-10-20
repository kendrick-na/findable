import { describe, expect, it } from "vitest";
import { safeRatio, wilsonInterval } from "./measurement-stats";

// 기대값은 손계산(Wilson 식, z=1.96)으로 직접 쓴 것이다. 코드 출력을 베끼지 않았다.
//   n=100,k=90: 0.8256~0.9448 / n=8,k=5: 0.3057~0.8632 / n=8,k=0 상한 0.3244 / n=8,k=8 하한 0.6756
function known(successes: number, total: number) {
  const r = wilsonInterval(successes, total);
  if (r.status !== "known") {
    throw new Error("known 이어야 함");
  }
  return r.value;
}

describe("wilsonInterval — 손계산 고정값", () => {
  it("n=100, k=90 → 0.8256~0.9448", () => {
    const v = known(90, 100);
    expect(v.low).toBeCloseTo(0.8256, 3);
    expect(v.high).toBeCloseTo(0.9448, 3);
    expect(v.method).toBe("wilson");
    expect(v.confidence).toBe(0.95);
  });

  it("n=8, k=5 → 0.3057~0.8632", () => {
    const v = known(5, 8);
    expect(v.low).toBeCloseTo(0.3057, 3);
    expect(v.high).toBeCloseTo(0.8632, 3);
  });

  it("k=0 은 0% 가 아니라 구간: 하한 0, 상한 약 0.3244 (n=8)", () => {
    const v = known(0, 8);
    expect(v.low).toBe(0);
    expect(v.high).toBeCloseTo(0.3244, 3);
  });

  it("k=n 은 100% 확정이 아니라 하한 약 0.6756, 상한 1 (n=8)", () => {
    const v = known(8, 8);
    expect(v.low).toBeCloseTo(0.6756, 3);
    expect(v.high).toBe(1);
  });

  it("구간은 항상 0~1 안, low <= high", () => {
    for (const [k, n] of [
      [0, 1],
      [1, 1],
      [1, 3],
      [2.5, 7],
    ] as const) {
      const v = known(k, n);
      expect(v.low).toBeGreaterThanOrEqual(0);
      expect(v.high).toBeLessThanOrEqual(1);
      expect(v.low).toBeLessThanOrEqual(v.high);
    }
  });

  it("소수 k(칸별 평균 노출률의 합)를 받는다", () => {
    const v = known(2.5, 5); // p=0.5
    expect(v.low).toBeLessThan(0.5);
    expect(v.high).toBeGreaterThan(0.5);
    // p=0.5 는 구간이 0.5 를 중심으로 대칭
    expect(v.low + v.high).toBeCloseTo(1, 9);
  });

  it("같은 입력은 같은 출력(재계산 일치)", () => {
    expect(wilsonInterval(5, 8)).toEqual(wilsonInterval(5, 8));
  });

  it("기준일 as_of 를 그대로 싣고, 모르면 null", () => {
    expect(wilsonInterval(5, 8, "2026-10-20").as_of).toBe("2026-10-20");
    expect(wilsonInterval(5, 8).as_of).toBeNull();
  });
});

describe("wilsonInterval — 확인 불가", () => {
  it("n=0 → unavailable(insufficient_sample), 0 이 아님", () => {
    const r = wilsonInterval(0, 0);
    expect(r.status).toBe("unavailable");
    if (r.status === "unavailable") {
      expect(r.reason).toBe("insufficient_sample");
      expect(r.detail_ko).not.toBe("");
    }
  });

  it("음수 분모도 계산하지 않는다", () => {
    expect(wilsonInterval(0, -3).status).toBe("unavailable");
  });

  it("k>n, k<0, NaN, Infinity 는 계산하지 않는다", () => {
    expect(wilsonInterval(9, 8).status).toBe("unavailable");
    expect(wilsonInterval(-1, 8).status).toBe("unavailable");
    expect(wilsonInterval(Number.NaN, 8).status).toBe("unavailable");
    expect(wilsonInterval(1, Number.POSITIVE_INFINITY).status).toBe(
      "unavailable"
    );
  });
});

describe("safeRatio", () => {
  it("정상 비율은 0~1 소수, 반올림 없음", () => {
    expect(safeRatio(1, 3)).toBeCloseTo(0.333_333_333_3, 9);
    expect(safeRatio(0, 5)).toBe(0);
  });

  it("분모 0 이하·비숫자는 null (0 이 아님)", () => {
    expect(safeRatio(0, 0)).toBeNull();
    expect(safeRatio(3, 0)).toBeNull();
    expect(safeRatio(1, -1)).toBeNull();
    expect(safeRatio(Number.NaN, 4)).toBeNull();
  });
});
