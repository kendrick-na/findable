/**
 * 「진실의 거울」 어댑터 — 2026-08-17 세션N-37 (v4 탭7).
 *
 * 🔴 여기서 지키는 계약(전부 이 저장소가 실제로 틀렸던 유형):
 *   ① **오류 ≠ 모른다** — 측정 실패를 "AI 가 우리를 모른다"로 세면 점수가 거짓이 된다.
 *   ② **분모는 답을 받은 엔진** — 실패를 분모에 넣으면 등장률이 낮게 나온다.
 *   ③ **대표 선택이 결정적**이어야 한다 — 같은 데이터로 화면이 매번 달라지면 안 된다.
 *   ④ **빈 결과는 null** — 빈 카드는 *"AI 가 아무 말도 안 했다"* 는 거짓 신호다.
 */

import { describe, expect, it } from "vitest";
import {
  buildTruthMirrorData,
  type TruthMirrorRowInput,
} from "../app/(authenticated)/lib/truth-mirror-data";

const row = (o: Partial<TruthMirrorRowInput> = {}): TruthMirrorRowInput => ({
  brandMentioned: false,
  engineId: "chatgpt",
  errorMessage: null,
  mentionPosition: null,
  rawResponse: "답변 원문",
  sentiment: null,
  ...o,
});

describe("오류는 「모른다」가 아니다", () => {
  it("전부 실패한 엔진은 분모에서 빠지고 따로 센다", () => {
    const data = buildTruthMirrorData([
      row({ brandMentioned: true, engineId: "chatgpt" }),
      row({ engineId: "claude", errorMessage: "timeout", rawResponse: null }),
    ]);
    expect(data?.measuredCount).toBe(1);
    expect(data?.erroredCount).toBe(1);
    // 🔴 판정이 갈리는 값: 실패를 분모에 넣으면 1/2=50%, 빼면 1/1=100%.
    expect(data?.knownCount).toBe(1);
  });

  it("일부만 실패한 엔진은 답한 것으로 센다", () => {
    // 한 프롬프트만 실패하고 다른 건 답했으면 그 엔진은 답한 것이다.
    const data = buildTruthMirrorData([
      row({ engineId: "gemini", errorMessage: "429", rawResponse: null }),
      row({ brandMentioned: true, engineId: "gemini" }),
    ]);
    expect(data?.erroredCount).toBe(0);
    expect(data?.measuredCount).toBe(1);
    expect(data?.engines[0].brandMentioned).toBe(true);
  });
});

describe("대표 선택이 결정적이다", () => {
  it("우리를 말한 답변을 대표로 세운다", () => {
    const data = buildTruthMirrorData([
      row({ brandMentioned: false, rawResponse: "긴 답변인데 언급 없음" }),
      row({ brandMentioned: true, rawResponse: "짧음" }),
    ]);
    expect(data?.engines[0].brandMentioned).toBe(true);
  });

  it("둘 다 말했으면 순위가 앞선 것", () => {
    const data = buildTruthMirrorData([
      row({ brandMentioned: true, mentionPosition: 5 }),
      row({ brandMentioned: true, mentionPosition: 2 }),
    ]);
    expect(data?.engines[0].mentionPosition).toBe(2);
  });

  it("입력 순서가 바뀌어도 결과가 같다", () => {
    // 🔴 재현 불가능한 화면을 만들지 않는다.
    const rows = [
      row({ brandMentioned: true, mentionPosition: 3 }),
      row({ brandMentioned: true, mentionPosition: 1 }),
      row({ brandMentioned: false }),
    ];
    const a = buildTruthMirrorData(rows);
    const b = buildTruthMirrorData([...rows].reverse());
    expect(a).toEqual(b);
  });
});

describe("빈 결과는 그리지 않는다", () => {
  it("행이 없으면 null", () => {
    expect(buildTruthMirrorData([])).toBeNull();
  });

  it("전 엔진이 실패면 null — 빈 카드를 그리지 않는다", () => {
    const data = buildTruthMirrorData([
      row({ errorMessage: "x", rawResponse: null }),
      row({ engineId: "claude", errorMessage: "y", rawResponse: null }),
    ]);
    expect(data).toBeNull();
  });
});

describe("발췌", () => {
  it("원문이 없으면 빈 문자열 — 지어내지 않는다", () => {
    const data = buildTruthMirrorData([row({ rawResponse: null })]);
    expect(data?.engines[0].excerpt).toBe("");
  });

  it("긴 원문은 자르고 말줄임을 붙인다", () => {
    const data = buildTruthMirrorData([row({ rawResponse: "가".repeat(400) })]);
    const excerpt = data?.engines[0].excerpt ?? "";
    expect(excerpt.endsWith("…")).toBe(true);
    // 판정이 갈리는 값: 280자 + 말줄임 1자.
    expect(excerpt.length).toBe(281);
  });
});

describe("정렬 — 아는 엔진이 위로", () => {
  it("언급한 엔진이 먼저 온다", () => {
    const data = buildTruthMirrorData([
      row({ brandMentioned: false, engineId: "aaa" }),
      row({ brandMentioned: true, engineId: "zzz" }),
    ]);
    expect(data?.engines[0].engineId).toBe("zzz");
  });
});

/**
 * 🔴 **브리핑은 분모에서 빠진다**(N-45 · #4-b B-5).
 * 📕 기획서 §2: *"질문이 다르므로 분모도 다르다"* · §5-c: *"분모를 섞지 않는다"*.
 *
 * 브리핑은 7엔진과 **다른 질문**(효과·후기·장단점)을 던진다. 「측정한 AI 8곳 중 N곳」
 * 처럼 같은 분모에 세우면 *"AI 8곳에 같은 걸 물었다"* 로 읽힌다 — 사실이 아니다.
 * 📕 N-30 *"축이 다른 두 숫자를 나란히 두면 검산하려 든다"*.
 *
 * ⚠️ **화면에서 빼는 게 아니다** — 카드는 그대로 나오고 자기 축 안내를 단다.
 *   빠지는 건 **숫자 문장의 분모**뿐이다. 아래 첫 케이스가 그 둘을 함께 문다.
 */
describe("브리핑은 보여주되 분모에는 넣지 않는다", () => {
  it("🔴 분모에서 빠진다 — 그러나 **카드는 남는다**", () => {
    const data = buildTruthMirrorData([
      row({ brandMentioned: true, engineId: "chatgpt" }),
      row({ brandMentioned: false, engineId: "naver-briefing" }),
    ]);
    // 분모는 7엔진 축만: 1곳(chatgpt).
    expect(data?.measuredCount).toBe(1);
    expect(data?.knownCount).toBe(1);
    // 🔴 그런데 카드는 **2개**여야 한다 — 빼버리면 편입한 의미가 없다.
    expect(data?.engines).toHaveLength(2);
    expect(
      data?.engines.some((e) => e.engineId === "naver-briefing"),
      "브리핑 카드가 사라졌다 — 분모에서만 빼야 한다"
    ).toBe(true);
  });

  it("🔴 브리핑이 **떴어도** 등장률 분자에 안 들어간다", () => {
    const data = buildTruthMirrorData([
      row({ brandMentioned: false, engineId: "chatgpt" }),
      row({ brandMentioned: true, engineId: "naver-briefing" }),
    ]);
    // 다른 질문에서 떴다고 「추천형 질문에서 등장했다」가 되면 안 된다.
    expect(data?.knownCount).toBe(0);
    expect(data?.measuredCount).toBe(1);
  });

  it("⛔ 브리핑만 있으면 분모가 **0** 이다 (없는 것을 1/1 로 부풀리지 않는다)", () => {
    const data = buildTruthMirrorData([
      row({ brandMentioned: true, engineId: "naver-briefing" }),
    ]);
    // 카드는 있지만 「측정한 AI N곳」에 셀 것이 없다.
    expect(data?.engines).toHaveLength(1);
    expect(data?.measuredCount).toBe(0);
    expect(data?.knownCount).toBe(0);
  });
});
