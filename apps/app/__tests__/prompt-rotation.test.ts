/*
 * 🔴 러너 상한(RUNNER_PROMPT_LIMIT=8)과 요금제 저장 상한(free5/starter30/growth150)이
 *   불일치했던 결함(2026-08-22) — `createdAt asc` 고정이라 가장 먼저 저장한 8개만
 *   영원히 측정되고, growth 유료 고객이 150개를 저장해도 9번째부터는 절대 측정되지
 *   않았다. `pickRotatingPrompts`가 "가장 오래(또는 한 번도) 측정 안 된 것"부터
 *   골라, 여러 번 실행되면 전체가 돌아가며 측정되게 한다.
 *
 * @vitest-environment node
 */

import { pickRotatingPrompts } from "@repo/audit/prompt-rotation";
import { describe, expect, test } from "vitest";

interface Row {
  id: string;
  lastTrackedAt: Date | null;
}

describe("pickRotatingPrompts", () => {
  test("한 번도 측정 안 된 것을 이미 측정된 것보다 우선한다", () => {
    const rows: Row[] = [
      { id: "measured-recent", lastTrackedAt: new Date("2026-08-20") },
      { id: "never", lastTrackedAt: null },
      { id: "measured-old", lastTrackedAt: new Date("2026-08-01") },
    ];
    const picked = pickRotatingPrompts(rows, 2);
    expect(picked.map((r) => r.id)).toEqual(["never", "measured-old"]);
  });

  test("9개 초과 저장분도 두 번 실행하면 전체가 돌아간다(라운드로빈)", () => {
    const rows: Row[] = Array.from({ length: 9 }, (_, i) => ({
      id: `p${i}`,
      lastTrackedAt: null,
    }));

    const firstRun = pickRotatingPrompts(rows, 8);
    expect(firstRun).toHaveLength(8);

    // 1회차에서 뽑힌 것들을 "측정됨"으로 갱신 — 9번째(p8)만 여전히 null.
    const afterFirstRun = rows.map((r) =>
      firstRun.some((p) => p.id === r.id)
        ? { ...r, lastTrackedAt: new Date("2026-08-22") }
        : r
    );
    const secondRun = pickRotatingPrompts(afterFirstRun, 8);
    // 🔴 이게 핵심 회귀 — 예전 로직(createdAt asc 고정)이면 p8은 절대 안 뽑힌다.
    expect(secondRun.some((p) => p.id === "p8")).toBe(true);
  });

  test("저장 개수가 상한 이하면 전부 그대로 반환한다", () => {
    const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      lastTrackedAt: null,
    }));
    const picked = pickRotatingPrompts(rows, 8);
    expect(picked).toHaveLength(5);
  });
});
