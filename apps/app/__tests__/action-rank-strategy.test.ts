/**
 * 🔬 **순위 구간 액션(`rank_strategy`) 가드** — N-46.
 *
 * 왜 생겼나: 👤 *"향상 액션 가이드가 명확히 잘 작동하는지 전수조사해"* 를 실측하다
 * **이 액션만 테스트가 0건**이라는 걸 발견했다. N-45 가 남긴 *"9종 전부 통과"* 는
 * **액션 종류 9개가 아니라 테스트 케이스 9개**였다(문서를 베끼면 틀린다 — 또 나왔다).
 *
 * 🔴 **왜 하필 이게 위험한가**: 이 액션은 순위에 따라 **정반대 처방**을 낸다.
 *   · 1위권  → *"최적화하지 마라"* (논문 Table 2: Rank1 **−30.3%** = 역효과)
 *   · 2위권  → *"효과가 작다"*
 *   · 하위권 → *"지금이 최적화 효과가 가장 큰 구간"*
 *   경계값(`RANK_LIFT_TABLE`)이 잘못 바뀌면 **1위 고객에게 「최적화하세요」** 가 나간다.
 *   고객이 **돈과 시간을 써서 실행하는 조언**이라, 조용히 뒤집히면 실제 손해가 난다.
 *   그런데 지금은 그렇게 뒤집혀도 테스트가 **전부 초록**이었다.
 *
 * ⚠️ **문구를 하드코딩하지 않는다**(📕 「가드가 버그의 호위병이 된다」).
 *   기대값에 문구를 박으면 ① 문구만 고쳐도 빨개지고 ② 정작 **논리가 뒤집힌 건** 못 잡는다.
 *   → 여기서는 **계약**을 본다: 어느 구간이 어느 `tone` 으로 가는가 · 세 구간이
 *     **서로 다른 말을 하는가** · 근거 숫자가 **입력에서 나온 값인가**.
 */

import { buildGeoActions } from "@repo/audit/actions";
import { describe, expect, it } from "vitest";

type Input = Parameters<typeof buildGeoActions>[0];

/** 순위 외 조건은 고정 — 순위만 움직여 그 축의 영향만 본다. */
const base: Input = {
  averageMentionPosition: 3,
  brandName: "설화수",
  enginesMeasured: 7,
  enginesMentioned: 7,
  prompts: [{ hit: 7, text: "설화수 추천해줘", total: 7 }],
  sourceMix: { community: 40, media: 10, other: 5, owned: 2, reference: 3 },
  topDomains: [
    { count: 40, domain: "blog.naver.com", owned: false },
    { count: 2, domain: "sulwhasoo.com", owned: true },
  ],
};

const rankAction = (pos: number | null) =>
  buildGeoActions({ ...base, averageMentionPosition: pos }).find(
    (a) => a.kind === "rank_strategy"
  );

describe("순위 구간 액션 — 구간마다 다른 처방이 나온다", () => {
  it("🔴 **1위권은 「하지 마라」 쪽이다** — 최적화가 역효과인 구간(논문 Rank1 −30.3%)", () => {
    const action = rankAction(1);
    expect(action, "1위권인데 순위 액션이 아예 없다").toBeTruthy();
    // 이 구간의 처방은 **방어**다. 「더 하라」고 하면 논문과 정반대가 된다.
    expect(
      action?.how,
      "1위권에 최적화를 권하고 있다 — 논문 Table 2 와 정반대다"
    ).toMatch(/떨어뜨린|감시|유지|방어/);
  });

  it("🔴 **하위권은 「지금 하라」 쪽이다** — 최적화 효과가 가장 큰 구간", () => {
    const action = rankAction(8);
    expect(action, "하위권인데 순위 액션이 없다").toBeTruthy();
    expect(
      action?.how,
      "하위권인데 최적화를 권하지 않는다 — 기회 구간을 놓친다"
    ).toMatch(/최적화|보강|실행/);
  });

  it("🔴🔴 **1위권과 하위권은 절대 같은 말을 하면 안 된다**", () => {
    // 📕 N-45 교훈: 「분기가 있는가」는 통과해도 **두 갈래가 같은 문구**면 화면은 똑같다.
    const top = rankAction(1);
    const low = rankAction(8);
    expect(top?.title).not.toBe(low?.title);
    expect(top?.how).not.toBe(low?.how);
  });

  it("🟡 **중간(2위권)은 제3의 답이다** — 위/아래 어느 쪽 복사본도 아니다", () => {
    const mid = rankAction(2);
    const top = rankAction(1);
    const low = rankAction(8);
    expect(mid, "2위권 액션이 없다").toBeTruthy();
    expect(mid?.title).not.toBe(top?.title);
    expect(mid?.title).not.toBe(low?.title);
  });

  it("🔴 **경계값이 밀리지 않는다** — 1.5 / 2.5 / 4.5 가 구간을 가른다", () => {
    // 경계 바로 아래/위가 **다른 구간**으로 가야 한다. 표를 잘못 고치면 여기서 터진다.
    expect(rankAction(1.5)?.title).toBe(rankAction(1)?.title);
    expect(rankAction(1.6)?.title).not.toBe(rankAction(1)?.title);
    expect(rankAction(2.5)?.title).toBe(rankAction(2)?.title);
    expect(rankAction(2.6)?.title).not.toBe(rankAction(2)?.title);
  });

  it("⛔ **순위를 모르면 순위 액션을 만들지 않는다** (없는 문제를 만들지 않는다)", () => {
    // 측정은 됐지만 순위를 못 뽑은 회차가 실제로 있다(번호목록 없는 답변).
    expect(rankAction(null)).toBeUndefined();
    expect(rankAction(0)).toBeUndefined();
  });

  it("⛔ **근거 숫자를 지어내지 않는다** — 입력한 순위가 그대로 나온다", () => {
    // 📕 이 저장소 제1 규칙: 사실 자동 생성 금지.
    expect(rankAction(3)?.evidence).toContain("3");
    expect(rankAction(7)?.evidence).toContain("7");
  });

  it("⛔ **출처가 붙는다** — 근거 없는 조언을 내보내지 않는다", () => {
    for (const pos of [1, 2, 5]) {
      const action = rankAction(pos);
      expect(action?.source, `순위 ${pos} 액션에 출처가 없다`).toBeTruthy();
    }
  });
});
