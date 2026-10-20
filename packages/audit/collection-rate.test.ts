import { describe, expect, it } from "vitest";
import {
  buildCollectionRate,
  collectionRateFromResponses,
  collectionRateSentence,
  countCellCoverage,
} from "./collection-rate";

const ok = (engineId: string) => ({ engineId });
const err = (engineId: string) => ({ engineId, errorMessage: "429" });
const stub = (engineId: string) => ({ engineId, isStub: true });

describe("buildCollectionRate", () => {
  it("measured/attempted 를 0~1 소수로, 반올림 없이", () => {
    const r = buildCollectionRate({ attempted: 3, measured: 2 }, 3, {
      suppression_threshold: null,
    });
    expect(r.rate).toBeCloseTo(2 / 3, 12);
    expect(r.repeat_count).toBe(3);
    expect(r.unit).toBe("engine");
    expect(r.suppressed).toBe(false);
  });

  it("attempted===0 이면 rate:null (0 이 아님), 억제도 아님", () => {
    const r = buildCollectionRate({ attempted: 0, measured: 0 }, 1, {
      suppression_threshold: 0.5,
    });
    expect(r.rate).toBeNull();
    expect(r.suppressed).toBe(false);
  });

  it("기준 미만이면 suppressed:true 이고 숫자는 남는다", () => {
    const r = buildCollectionRate({ attempted: 10, measured: 4 }, 3, {
      suppression_threshold: 0.5,
    });
    expect(r.suppressed).toBe(true);
    expect(r.rate).toBeCloseTo(0.4, 12);
    expect(r.suppression_threshold).toBe(0.5);
  });

  it("기준과 같으면 억제하지 않는다(미만만 억제)", () => {
    const r = buildCollectionRate({ attempted: 10, measured: 5 }, 3, {
      suppression_threshold: 0.5,
    });
    expect(r.suppressed).toBe(false);
  });

  it("기준값이 null 이면 아무리 낮아도 억제하지 않는다", () => {
    const r = buildCollectionRate({ attempted: 10, measured: 0 }, 3, {
      suppression_threshold: null,
    });
    expect(r.suppressed).toBe(false);
    expect(r.rate).toBe(0);
  });

  it("수집 > 시도 같은 모순 입력은 비율을 꾸미지 않는다(null)", () => {
    const r = buildCollectionRate({ attempted: 2, measured: 3 }, 1, {
      suppression_threshold: 0.5,
    });
    expect(r.rate).toBeNull();
  });

  it("칸 단위 표시를 그대로 싣는다", () => {
    const r = buildCollectionRate({ attempted: 4, measured: 4 }, 2, {
      suppression_threshold: null,
      unit: "question_engine_cell",
    });
    expect(r.unit).toBe("question_engine_cell");
  });
});

describe("collectionRateFromResponses — 기존 수집 규칙 재사용", () => {
  it("오류·스텁 응답은 수집에서 빠진다(엔진 단위)", () => {
    const r = collectionRateFromResponses(
      [ok("chatgpt"), err("claude"), stub("gemini"), ok("perplexity")],
      1,
      { suppression_threshold: null }
    );
    expect(r.attempted).toBe(4);
    expect(r.measured).toBe(2);
    expect(r.rate).toBe(0.5);
  });

  it("같은 엔진이 4번 중 1번만 성공해도 그 엔진은 수집됨", () => {
    const r = collectionRateFromResponses(
      [err("chatgpt"), err("chatgpt"), err("chatgpt"), ok("chatgpt")],
      4,
      { suppression_threshold: null }
    );
    expect(r).toMatchObject({ attempted: 1, measured: 1, rate: 1 });
  });

  it("행이 없으면 attempted 0 → rate null", () => {
    expect(
      collectionRateFromResponses(null, 0, { suppression_threshold: null }).rate
    ).toBeNull();
  });
});

describe("countCellCoverage", () => {
  it("칸 안에 성공이 하나라도 있으면 수집, 전부 오류·스텁이면 미수집", () => {
    const c = countCellCoverage([
      [ok("chatgpt"), err("chatgpt")],
      [err("claude"), err("claude")],
      [stub("gemini")],
      [ok("perplexity")],
    ]);
    expect(c).toEqual({ attempted: 4, measured: 2 });
  });

  it("빈 칸은 시도로 세지 않는다", () => {
    expect(countCellCoverage([[], [ok("chatgpt")]])).toEqual({
      attempted: 1,
      measured: 1,
    });
  });
});

describe("collectionRateSentence", () => {
  it("N건 중 M건 수집, 반복 K회", () => {
    const r = buildCollectionRate({ attempted: 8, measured: 6 }, 3, {
      suppression_threshold: null,
    });
    expect(collectionRateSentence(r)).toBe(
      "8건 중 6건 수집, 반복 3회(엔진 기준)"
    );
  });

  it("억제 시에도 건수는 보이고 기준 미만을 밝힌다", () => {
    const r = buildCollectionRate({ attempted: 8, measured: 2 }, 1, {
      suppression_threshold: 0.5,
    });
    const s = collectionRateSentence(r);
    expect(s).toContain("8건 중 2건 수집");
    expect(s).toContain("기준 미만");
  });

  it("시도 0건이면 0건 중 0건이라 쓰지 않고 「시도한 측정 없음」", () => {
    const r = buildCollectionRate({ attempted: 0, measured: 0 }, 0, {
      suppression_threshold: null,
    });
    expect(collectionRateSentence(r)).toContain("시도한 측정 없음");
  });
});
