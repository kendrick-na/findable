import { countMeasurementCoverage } from "@repo/audit/measurement-coverage";
import { describe, expect, it } from "vitest";

/**
 * 🔴 세션N-28 실측 버그 고정 — 화면에 **「우리를 아는 AI 7/6」·「117%」** 가 떠 있었다.
 *
 * 사고 경위:
 *   결과 화면이 분모를 `전체 − 오류엔진 − stub엔진` 으로 **직접 계산**하고 있었다.
 *   그 규칙은 *"1번이라도 실패하면 그 엔진은 통째로 제외"* 다.
 *   그런데 단일 진실 모듈(`measurement-coverage.ts`)의 규칙은 **정반대**다 —
 *   *"4번 중 1번만 성공했어도 그 엔진은 측정됨"*.
 *
 *   실데이터(엔비디아 회차): Perplexity 가 **5회 중 3회 성공 · 2회 rate limit 실패**.
 *   → 분모는 그 엔진을 빼서 6, 분자(언급 엔진)는 그대로 7 → **7/6 = 117%**.
 *
 * ⭐ 모듈이 맞다: 답을 3번이나 받아낸 엔진을 "측정 못 했다"고 빼면 잰 것을 축소 보고하는 것이다.
 *
 * 🔴 이 테스트가 지키는 것은 **문구가 아니라 계약**이다(메모리 feedback_guard_defends_the_bug):
 *   "부분 실패한 엔진은 measured 에 남는다" + "분자 ≤ 분모".
 *   `apps/web` 에는 테스트 러너가 없어 여기(`apps/app`)에 둔다 — 검사하는 것은 공유 패키지다.
 */
describe("부분 실패 엔진의 분모 처리 (7/6·117% 재발 방지)", () => {
  // 실데이터 형태 그대로: perplexity 5행 중 3행 성공 · 2행 rate limit 실패
  const nvidiaLike = [
    { engineId: "chatgpt", errorMessage: null, isStub: false },
    { engineId: "claude", errorMessage: null, isStub: false },
    { engineId: "perplexity", errorMessage: null, isStub: false },
    {
      engineId: "perplexity",
      errorMessage: "Failed after 3 attempts. Last error: Request rate limit",
      isStub: false,
    },
    { engineId: "perplexity", errorMessage: null, isStub: false },
    {
      engineId: "perplexity",
      errorMessage: "Failed after 3 attempts. Last error: Request rate limit",
      isStub: false,
    },
    { engineId: "perplexity", errorMessage: null, isStub: false },
    { engineId: "gemini", errorMessage: null, isStub: false },
    { engineId: "hyperclova", errorMessage: null, isStub: false },
    { engineId: "naver", errorMessage: null, isStub: false },
    { engineId: "daum", errorMessage: null, isStub: false },
  ];

  it("일부만 실패한 엔진은 measured 에 남는다 (7곳)", () => {
    const { attempted, measured } = countMeasurementCoverage(nvidiaLike);
    expect(attempted).toBe(7);
    expect(measured).toBe(7);
  });

  it("🔴 언급 엔진 수(분자)가 measured(분모)를 넘지 않는다", () => {
    const { measured } = countMeasurementCoverage(nvidiaLike);
    // 화면이 쓰는 분자 = 언급한 고유 엔진 수. 최악의 경우 전 엔진이 언급이다.
    const mentionedUnique = new Set(nvidiaLike.map((r) => r.engineId)).size;
    expect(mentionedUnique).toBeLessThanOrEqual(measured);
    // 종전 화면 규칙(1회라도 실패 → 통째 제외)이면 6이 되어 이 단언이 깨진다.
    expect(Math.round((mentionedUnique / measured) * 100)).toBeLessThanOrEqual(
      100
    );
  });

  it("전부 실패한 엔진은 measured 에서 빠진다", () => {
    const allFailed = [
      { engineId: "chatgpt", errorMessage: null, isStub: false },
      { engineId: "naver", errorMessage: "boom", isStub: false },
      { engineId: "naver", errorMessage: "boom", isStub: false },
    ];
    const { attempted, measured } = countMeasurementCoverage(allFailed);
    expect(attempted).toBe(2);
    expect(measured).toBe(1);
  });

  it("stub 은 측정으로 세지 않는다", () => {
    const withStub = [
      { engineId: "chatgpt", errorMessage: null, isStub: false },
      { engineId: "daum", errorMessage: null, isStub: true },
    ];
    expect(countMeasurementCoverage(withStub).measured).toBe(1);
  });
});
