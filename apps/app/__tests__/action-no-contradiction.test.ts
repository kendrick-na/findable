/**
 * 🔬 **액션 간 모순 가드** — N-46 전수조사(1,024조합)가 찾은 것을 고정한다.
 *
 * 이 파일이 막는 두 가지(둘 다 **한 액션 안이 아니라 액션 사이**의 문제라
 * `action-rank-strategy.test.ts` 로는 못 잡는다):
 *
 * 1. 🔴🔴 **1순위권에 「전면 최적화」와 「방어」가 같이 뜨는 것** (수정 전 144건)
 *    논문 Table 2 기준 1위가 최적화하면 **−30.3%**. 고객이 돈·시간을 써서 손해 본다.
 * 2. 🔴 **「하지 마세요」가 상한에 잘려나가는 것** (수정 전 352조합이 상한 도달)
 *    문제가 많은 고객일수록 액션이 많아 **이걸 못 보던** 역진적 구조였다.
 *
 * ⚠️ **문구를 하드코딩하지 않는다** — `kind` 와 **구조**로 검사한다
 *   (📕 「가드가 버그의 호위병이 된다」: 기대값에 문구를 박으면 문구만 고쳐도 빨개지고
 *    정작 논리가 뒤집힌 건 못 잡는다).
 */

import { buildGeoActions } from "@repo/audit/actions";
import { describe, expect, it } from "vitest";

type In = Parameters<typeof buildGeoActions>[0];

const RANKS: (number | null)[] = [
  null,
  0,
  1,
  1.4,
  1.5,
  1.6,
  2,
  2.4,
  2.5,
  2.6,
  3,
  4.4,
  4.5,
  4.6,
  7,
  20,
];
const MENTIONED = [0, 1, 3, 7];
const SOURCE_MIXES = [
  {
    mix: { community: 90, media: 0, other: 0, owned: 0, reference: 0 },
    d: [{ count: 90, domain: "blog.naver.com", owned: false }],
  },
  {
    mix: { community: 0, media: 0, other: 0, owned: 40, reference: 0 },
    d: [{ count: 40, domain: "b.com", owned: true }],
  },
  {
    mix: { community: 10, media: 20, other: 5, owned: 30, reference: 20 },
    d: [{ count: 30, domain: "b.com", owned: true }],
  },
  { mix: { community: 0, media: 0, other: 0, owned: 0, reference: 0 }, d: [] },
];
const PROMPTSETS = [
  [{ hit: 7, text: "추천해줘", total: 7 }],
  [
    { hit: 7, text: "추천해줘", total: 7 },
    { hit: 0, text: "인기5", total: 7 },
  ],
  [
    { hit: 0, text: "추천해줘", total: 7 },
    { hit: 0, text: "인기5", total: 7 },
  ],
  [],
];

/** 전수 조합을 한 번 만들어 재사용한다(1,024건). */
function everyCombination() {
  const out: { input: In; label: string }[] = [];
  for (const rank of RANKS) {
    for (const mentioned of MENTIONED) {
      for (const s of SOURCE_MIXES) {
        for (const prompts of PROMPTSETS) {
          out.push({
            label: `rank=${rank} 인지=${mentioned} 출처=${JSON.stringify(s.mix)} 질문=${prompts.length}`,
            input: {
              brandName: "설화수",
              enginesMeasured: 7,
              enginesMentioned: mentioned,
              averageMentionPosition: rank,
              prompts,
              sourceMix: s.mix,
              topDomains: s.d,
            } as In,
          });
        }
      }
    }
  }
  return out;
}

/** 「지금은 방어 국면」을 말하는 액션인가 — 순위 기반 처방만 본다. */
const isDefend = (a: { kind: string; how: string }) =>
  a.kind === "rank_strategy" && /떨어뜨린|방어|감시|유지/.test(a.how);

describe("액션끼리 모순되지 않는다 (전수 1,024조합)", () => {
  it("🔴🔴 **「방어하라」와 「전면 최적화하라」가 같은 화면에 오지 않는다**", () => {
    const bad: string[] = [];
    for (const { input, label } of everyCombination()) {
      const actions = buildGeoActions(input);
      const defend = actions.some(isDefend);
      // content_fix = 브랜드 전반의 문장 품질을 올리라는 **전면 최적화** 처방.
      // (prompt_gap 은 「그 질문 전용 페이지」라 축이 달라 모순이 아니다.)
      const pushAll = actions.some((a) => a.kind === "content_fix");
      if (defend && pushAll) {
        bad.push(label);
      }
    }
    expect(
      bad,
      `1순위권에 최적화 처방이 함께 나온 조합 ${bad.length}건:\n${bad.slice(0, 5).join("\n")}`
    ).toEqual([]);
  });

  it("🔴 **「하지 마세요」는 어떤 조합에서도 잘리지 않는다**", () => {
    const missing: string[] = [];
    for (const { input, label } of everyCombination()) {
      if (!buildGeoActions(input).some((a) => a.kind === "avoid")) {
        missing.push(label);
      }
    }
    expect(missing, `avoid 가 사라진 조합 ${missing.length}건`).toEqual([]);
  });

  it("⛔ **어떤 조합에서도 화면이 비지 않는다**", () => {
    for (const { input, label } of everyCombination()) {
      expect(
        buildGeoActions(input).length,
        `액션 0개: ${label}`
      ).toBeGreaterThan(0);
    }
  });

  it("⛔ **「하지 마세요」는 항상 맨 아래** — 해야 할 일이 먼저 읽힌다", () => {
    for (const { input } of everyCombination()) {
      const actions = buildGeoActions(input);
      const idx = actions.findIndex((a) => a.kind === "avoid");
      expect(idx).toBe(actions.length - 1);
    }
  });
});
