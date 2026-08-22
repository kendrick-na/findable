/**
 * 엔진 권역 분류 = **단일 진실** 회귀 테스트 (2026-08-16 세션N-34).
 *
 * 🔴 **왜 필요한가**: `naver-vs-ai-gap.tsx` 가 `KOREAN_ENGINES`·`GLOBAL_ENGINES`
 *   **사설 Set 두 벌**을 들고 있었다(재설계안 v4 §4-a-1 ⑥ 중복계산 5건 중 하나).
 *   목록은 우연히 일치했지만 **판정 규칙이 달랐다**:
 *
 *     market-scope  : 모르는 엔진 → **글로벌**(글로벌 LLM 이 계속 느는 쪽이라)
 *     사설 GLOBAL   : 닫힌 목록   → **어느 쪽에도 안 잡힘 = 화면에서 증발**
 *
 *   즉 엔진이 하나 추가되는 날 그 엔진은 조용히 사라지고, 분모가 줄었는데도
 *   아무도 모른다. 이 저장소가 반복해 온 **"조용한 실패"** 유형이다.
 *
 * ⚠️ 이 테스트는 **문구가 아니라 분류 계약**을 검사한다. 엔진이 추가되면
 *   `REAL_ENGINES` 를 갱신하되, 분류가 갈라지면 실패해야 한다.
 *
 * @vitest-environment node
 */

import { engineRegion, filterByRegion } from "@repo/audit/market-scope";
import { describe, expect, it } from "vitest";

/** 실제 측정에 등장하는 엔진 전량(본류 7 + 변종 2). */
const REAL_ENGINES = [
  "chatgpt",
  "chatgpt-web",
  "claude",
  "perplexity",
  "gemini",
  "hyperclova",
  "naver",
  "naver-briefing",
  "daum",
];

/** 교체 전 `naver-vs-ai-gap.tsx` 가 들고 있던 사설 목록(대조군). */
const LEGACY_KOREAN = new Set([
  "naver",
  "naver-briefing",
  "hyperclova",
  "daum",
]);

describe("권역 분류 단일화 — 화면 숫자가 바뀌지 않았다", () => {
  it("실엔진 전량에서 한국 분류가 교체 전과 동일하다", () => {
    const rows = REAL_ENGINES.map((engineId) => ({ engineId }));
    const now = filterByRegion(rows, "korea")
      .map((r) => r.engineId)
      .sort();
    const legacy = REAL_ENGINES.filter((e) => LEGACY_KOREAN.has(e)).sort();
    expect(now).toEqual(legacy);
  });

  it("한국 4엔진 · 글로벌 5엔진으로 정확히 갈린다", () => {
    const rows = REAL_ENGINES.map((engineId) => ({ engineId }));
    // 🔴 합이 전체와 같아야 한다 — 어느 쪽에도 안 잡히는 엔진이 있으면 분모가 샌다.
    const korea = filterByRegion(rows, "korea").length;
    const global = filterByRegion(rows, "global").length;
    expect(korea).toBe(4);
    expect(global).toBe(5);
    expect(korea + global).toBe(REAL_ENGINES.length);
  });

  it("🔴 모르는 엔진도 반드시 어느 한쪽에 잡힌다 — 증발하면 안 된다", () => {
    // 사설 닫힌 목록이었다면 여기서 조용히 사라졌다.
    expect(engineRegion("grok")).toBe("global");
    expect(filterByRegion([{ engineId: "grok" }], "global")).toHaveLength(1);
  });

  it("네이버 브리핑은 본류 7엔진 밖이지만 권역상 한국이다", () => {
    // market-scope 주석이 명시한 계약. 화면이 이걸 다르게 판단하면 격차 카드가 어긋난다.
    expect(engineRegion("naver-briefing")).toBe("korea");
  });
});
