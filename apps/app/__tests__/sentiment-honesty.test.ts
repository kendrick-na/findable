/**
 * 감성 정직성 회귀 테스트 (2026-08-16 세션N-34 · G-1).
 *
 * 🔴 **왜 필요한가 — 실측으로 드러난 결함 2건**
 *
 * ① **화면이 상태를 좋게 반올림했다.** `sentimentTier` 가 부정은 **비중**으로 판정하는데
 *    (*"1건이든 전부든 똑같이 섞임"* 이라 이미 고쳐짐) 긍정만 `positive > 0` 하나로 갈려
 *    **긍정 1건만 있어도 「우호적」** 이 됐다.
 *    🔬 실측(브랜드 3개 전량): 긍정 비중 **14% · 15% · 12%** 인데 셋 다 「우호적」.
 *    실제로는 **85% 이상이 중립**이다.
 *
 * ② **`별로` 가 조사를 부정으로 셌다.** `estimateSentiment` 는 부분 문자열로 세는데
 *    한국어 `별로` 는 `용도별로`·`목적별로` 처럼 **조사**로 훨씬 자주 쓰인다.
 *    🔬 실측(rawResponse 75행): `별로` **4건 전부 조사형** · **진짜 부정 0건**.
 *
 * ⚠️ **분류기 임계값(±2)은 건드리지 않았다.** 근거 없는 경계선을 발명하는 것이고
 *   (이 저장소가 금지한 것), 바꾸면 저장된 회차의 값이 전부 재해석된다.
 *   진짜 해법은 v1.5 정밀 분석이고 그건 별개 트랙이다.
 *
 * @vitest-environment node
 */

import { estimateSentiment } from "@repo/ai/lib/engines/utils";
import { describe, expect, it } from "vitest";
// 🔴 **실제 화면이 쓰는 함수를 그대로 불러 검사한다.**
//   테스트에 판정 로직을 복제하면 화면이 바뀌어도 테스트가 통과해버린다
//   (이 저장소가 "같은 수치 2벌"로 반복해 겪은 함정).
import {
  sentimentComparison,
  sentimentTier as tier,
} from "../app/(authenticated)/components/dashboard-kpis";
import { positiveRateOf } from "../app/(authenticated)/lib/dashboard-data";

describe("감성 티어 — 상태를 좋게 반올림하지 않는다", () => {
  it("🔴 긍정이 소수면 「우호적」이라 하지 않는다 (실측 재현)", () => {
    // 실측 그대로: 나이키 긍5·중28·부0 = 긍정 15%
    expect(tier({ positive: 5, neutral: 28, negative: 0, total: 33 })).toBe(
      "중립적"
    );
    // sulwhasoo 긍2·중12 = 14%
    expect(tier({ positive: 2, neutral: 12, negative: 0, total: 14 })).toBe(
      "중립적"
    );
    // 엔비디아 긍2·중15 = 12%
    expect(tier({ positive: 2, neutral: 15, negative: 0, total: 17 })).toBe(
      "중립적"
    );
  });

  it("긍정이 실제로 지배적이면 「우호적」이 맞다", () => {
    expect(tier({ positive: 20, neutral: 10, negative: 0, total: 30 })).toBe(
      "우호적"
    );
  });

  it("🔴 긍정·부정이 같은 경계(3할)를 쓴다 — 한쪽만 후하면 안 된다", () => {
    // 대칭성 계약: 같은 비중이면 같은 강도로 판정한다
    const p = tier({ positive: 3, neutral: 7, negative: 0, total: 10 }); // 긍정 30%
    const n = tier({ positive: 0, neutral: 7, negative: 3, total: 10 }); // 부정 30%
    expect(p).toBe("우호적");
    expect(n).toBe("부정 많음");
  });

  it("부정은 소수여도 숨기지 않는다 (기존 동작 보존)", () => {
    expect(tier({ positive: 0, neutral: 32, negative: 1, total: 33 })).toBe(
      "부정 섞임"
    );
  });

  it("측정이 0건이면 판정하지 않는다", () => {
    expect(tier({ positive: 0, neutral: 0, negative: 0, total: 0 })).toBe("—");
  });
});

describe("긍정 비율 — 같은 수치 2벌 금지 (세션N-34 감사)", () => {
  // 🔴 같은 식이 **3벌**로 흩어져 있었다: `positiveRateOf` · 카드 값 · 비교 문장.
  //   이 저장소는 같은 수치 복제로 두 번 사고를 냈다(`7/6=117%` · `95% vs 7곳`).
  //   지금은 셋이 한 함수를 쓴다 — 그 계약을 고정한다.
  it("비교 문장의 숫자가 `positiveRateOf` 와 정확히 일치한다", () => {
    // ⚠️ **반올림이 갈리는 값을 골랐다.** 처음엔 15%·30% 같은 딱 떨어지는 값을 썼는데
    //   `Math.round` 든 `Math.floor` 든 결과가 같아 **가드가 장식**이었다(뮤테이션으로 발각).
    //   `2/7` = round 29 / floor 28 → 계산처가 갈리면 **즉시 틀어진다**.
    const previous = { positive: 2, neutral: 5, negative: 0, total: 7 }; // 29%
    const current = { positive: 5, neutral: 4, negative: 0, total: 9 }; // 56%
    const prevRate = positiveRateOf(previous);
    const currRate = positiveRateOf(current);
    const text = sentimentComparison(current, previous);
    // 문장이 말하는 이전 값 = 단일 진실이 낸 값
    expect(text).toContain(`${prevRate}%`);
    // 변화폭도 두 값의 차이와 같아야 한다
    expect(text).toContain(`${(currRate ?? 0) - (prevRate ?? 0)}%p`);
  });

  it("변화가 없으면 올랐다/내렸다고 하지 않는다", () => {
    const same = { positive: 5, neutral: 28, negative: 0, total: 33 };
    const text = sentimentComparison(same, same);
    expect(text).toContain("같아요");
    expect(text).not.toMatch(/올랐|내렸/);
  });

  it("이전 측정이 없으면 비교를 지어내지 않는다", () => {
    const current = { positive: 5, neutral: 28, negative: 0, total: 33 };
    expect(sentimentComparison(current, null)).toContain("2회차");
  });
});

describe("분류기 — `별로` 조사 오탐", () => {
  it("🔴 `용도별로` 는 부정 점수를 **깎지 않는다**", () => {
    // ⚠️ 이 검사를 설계할 때 한 번 틀렸다: 조사 문장만 넣고 `not.toBe("negative")`
    //   를 걸었더니 **`별로` 가 부정 키워드로 살아 있어도 통과**했다.
    //   임계값이 -2 라 `별로` 1점만으로는 어차피 neutral 이기 때문이다(= 가드가 장식).
    //   → **진짜 부정어 1개와 짝지어** 점수가 -2 로 넘어가는지로 판정한다.
    //     `별로` 가 부정으로 세어지면 `단점`(-1) + `별로`(-1) = -2 → negative 가 된다.
    const withParticle = "나이키는 용도별로 다르고 단점도 하나 있습니다.";
    expect(estimateSentiment(withParticle, "나이키")).not.toBe("negative");

    // 대조군: 조사 대신 **진짜 부정어**가 하나 더 있으면 negative 가 맞다.
    const genuinelyNegative = "나이키는 실망스럽고 단점도 하나 있습니다.";
    expect(estimateSentiment(genuinelyNegative, "나이키")).toBe("negative");
  });

  it("진짜 부정 표현은 여전히 잡는다", () => {
    // `실망`·`단점` 2개 → score -2 → negative
    const text = "이 브랜드는 실망스럽고 단점이 많습니다.";
    expect(estimateSentiment(text, "이 브랜드")).toBe("negative");
  });

  it("긍정 표현도 여전히 잡는다", () => {
    const text = "테스트브랜드는 최고이고 인기 있는 추천 제품입니다.";
    expect(estimateSentiment(text, "테스트브랜드")).toBe("positive");
  });

  it("브랜드가 안 나오면 판정하지 않는다 (없는 판정 금지)", () => {
    expect(
      estimateSentiment("전혀 다른 이야기입니다.", "테스트브랜드")
    ).toBeNull();
  });
});
