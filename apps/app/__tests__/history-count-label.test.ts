/**
 * `/history` 건수 문구 회귀 테스트 (S7-4차 · 2026-08-12).
 *
 * 🔴 **막는 사고**: `/history` 는 `take: 50` 인데 총 건수도 상한도 화면에 없었다.
 *   51번째 측정부터는 **오래된 기록이 말없이 잘려** 고객은 사라진 줄 안다
 *   (NN/g 1 시스템 상태 가시성).
 *
 * ⚠️ 왜 순수 함수로 뺐나: 이 판정을 `page.tsx` 안에 삼항으로 두면 **서버 컴포넌트라
 *   테스트가 안 된다**. 라이브 QA 계정은 측정 0건이라 **잘림 문구 경로가 영원히
 *   검증되지 않는다** — 실제로 배포 후 눈으로 확인했는데 0건 경로만 보였다.
 *   → 규칙을 함수로 빼서 여기서 세 경우를 전부 고정한다.
 */
import { describe, expect, test } from "vitest";
import { historyCountLabel } from "../app/(authenticated)/lib/history-count-label";

// biome: 정규식은 최상위에 둔다(함수 안에 두면 호출마다 재생성).
const ANY_DIGIT = /\d/;

describe("historyCountLabel", () => {
  test("0건이면 숫자를 말하지 않는다 (빈 상태 안내가 그 일을 한다)", () => {
    const label = historyCountLabel(0, 50);
    expect(label).toBe("지금까지 측정한 결과를 모아뒀어요.");
    expect(label).not.toMatch(ANY_DIGIT);
  });

  test("상한 이하면 총 건수만 말한다", () => {
    expect(historyCountLabel(7, 50)).toBe("지금까지 7번 측정했어요.");
    // 딱 상한이면 잘린 게 없으므로 잘림 문구가 붙으면 안 된다.
    expect(historyCountLabel(50, 50)).toBe("지금까지 50번 측정했어요.");
  });

  test("🔴 상한을 넘으면 **잘렸다고 말한다** (조용한 잘림 금지)", () => {
    const label = historyCountLabel(51, 50);
    expect(label).toContain("51번");
    expect(label).toContain("최근 50건만");
  });
});
