/**
 * S6-c#2 회귀 테스트 (2026-08-11).
 *
 * 🔴 **막는 사고**: 아직 없는 기능(`(준비 중)`)이 요금제 표에서 완성 기능과 **똑같은
 *   주황 체크(✓)** 로 그려졌다. 체크는 "제공됨"으로 읽히므로 **돈 내는 화면에서 없는 것을
 *   있다고 표시**한 셈이다(설계 v3 원인②). 화면은 `ready !== false` 로 아이콘을 가른다.
 *
 * 🔴 **이 테스트의 진짜 표적은 "되돌아가기"** 다: 누군가 다시 라벨에 `(준비 중)` 문자열을
 *   박아 넣으면 플래그가 없으니 **체크가 그대로 붙는다**(조용한 재발). 그래서
 *   "라벨에 그 문자열이 있으면 안 된다"를 **양방향으로** 고정한다.
 *   ⚠️ 가드가 틀린 값을 기대값으로 하드코딩하면 버그의 호위병이 된다 — 여기서는
 *      올바른 상태를 요구하고(①) 틀린 상태의 부활을 막는다(②).
 */
import { describe, expect, test } from "vitest";
import { PRICING_TIERS } from "../app/(authenticated)/lib/pricing";

const allFeatures = PRICING_TIERS.flatMap((tier) =>
  tier.features.map((feature) => ({ feature, tier: tier.name }))
);

describe("요금제 기능 — 준비 중 표시 정직성", () => {
  test("① 준비 중 기능은 ready:false 를 데이터로 들고 있다", () => {
    const notReady = allFeatures.filter(
      ({ feature }) => typeof feature !== "string" && feature.ready === false
    );
    // 실제로 준비 중인 기능이 3개 있다(주간 자동 리포트 · 이메일 알림 · Export).
    // 개수를 박는 게 아니라 "플래그를 쓰는 항목이 실재한다"를 확인한다.
    expect(notReady.length).toBeGreaterThan(0);
  });

  test("② 🔴 라벨에 '(준비 중)' 문자열을 박지 않는다 (플래그가 단일 진실)", () => {
    for (const { feature, tier } of allFeatures) {
      const label = typeof feature === "string" ? feature : feature.label;
      expect(
        label.includes("준비 중"),
        `${tier} 의 "${label}" — 라벨 대신 { ready: false } 를 쓸 것. ` +
          "문자열로 적으면 체크(✓)가 그대로 붙어 없는 기능을 파는 표시가 된다."
      ).toBe(false);
    }
  });

  test("③ 결제 가능한 플랜에는 실제로 되는 기능이 반드시 있다", () => {
    for (const tier of PRICING_TIERS) {
      if (tier.chargedKrw === undefined) {
        continue;
      }
      const ready = tier.features.filter(
        (feature) => typeof feature === "string" || feature.ready !== false
      );
      // 돈을 받는 플랜이 "준비 중"만으로 채워지는 일을 막는다.
      expect(
        ready.length,
        `${tier.name} 에 제공 중인 기능이 없다`
      ).toBeGreaterThan(0);
    }
  });
});
