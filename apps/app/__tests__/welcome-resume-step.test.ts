import { describe, expect, it } from "vitest";
import { firstOpenStep } from "../app/(authenticated)/welcome/resume-step";

describe("firstOpenStep — 설정 이어가기는 비어 있는 첫 단계부터", () => {
  it("다 갖췄으면 6단계(확인·측정)", () => {
    expect(firstOpenStep([])).toBe(6);
  });
  it("별칭 → 경쟁사 → 질문 순으로 첫 빈 곳", () => {
    expect(firstOpenStep(["alias", "competitors", "discovery_prompt"])).toBe(3);
    expect(firstOpenStep(["competitors", "discovery_prompt"])).toBe(4);
    expect(firstOpenStep(["discovery_prompt"])).toBe(5);
  });
  it("필수(이름·업종·시장)가 비면 2단계", () => {
    expect(firstOpenStep(["market_scope", "competitors"])).toBe(2);
  });
  it("저장해 둔 경쟁사('없음' 포함)는 다시 묻지 않는다", () => {
    // 경쟁사가 채워졌으면 missing 에 competitors 가 없다 → 4단계를 건너뛴다.
    expect(firstOpenStep(["discovery_prompt"])).toBeGreaterThan(4);
  });
});
