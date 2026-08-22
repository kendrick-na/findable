import { listPriceForPlan } from "@repo/payments/catalog";
import { describe, expect, test } from "vitest";

/**
 * 잠금 버튼 가격 표기 회귀 테스트 (S4 원인③ · 2026-08-11 세션N-19).
 *
 * 🔴 **이 테스트가 막는 사고**: 잠금 버튼에 가격을 넣으면서 숫자를 **하드코딩**하면
 *   요금제를 올렸을 때 버튼만 옛 가격을 말한다 = **표시광고 문제**.
 *   그래서 버튼은 `@repo/payments/catalog` 에서 읽는데, 그 계약(만원 환산·표시가 축)이
 *   깨지지 않는지 고정한다.
 *
 * ⚠️ 이 파일은 **DOM 을 안 쓴다** → `@vitest-environment` 지시문 불필요(node 기본값으로 충분).
 *   렌더링 테스트라면 `jsdom` 지시문이 필요하다(→ `empty-state.test.tsx` 참고).
 */
describe("잠금 버튼 가격 표기", () => {
  test("표시가는 세전(listKrw) — 요금제 표와 같은 축이어야 한다", () => {
    // 요금제 표가 "₩390,000" 이라고 적는 것과 같은 값이어야 한다.
    // (청구액 429,000 은 VAT 포함이라 결제 단계에서만 쓴다 — 두 축을 섞으면
    //  고객이 두 화면을 비교했을 때 가격이 달라 보인다.)
    expect(listPriceForPlan("growth")).toBe(390_000);
  });

  test("만원 환산이 정수로 떨어진다 (버튼 문구 '월 39만원')", () => {
    const krw = listPriceForPlan("growth");
    expect(krw).not.toBeNull();
    expect(Math.round((krw as number) / 10_000)).toBe(39);
  });

  test("카탈로그에 없는 플랜명은 null — 없는 숫자를 만들지 않는다", () => {
    // 폴백이 가격 없이 렌더되는 근거. (타입 밖 값이 들어오는 경우를 방어)
    expect(listPriceForPlan("insider" as never)).toBeNull();
  });
});
