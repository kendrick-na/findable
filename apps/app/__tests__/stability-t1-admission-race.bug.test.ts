/**
 * 버그 재현(기본 건너뜀) — 입장 판정(decideAdmission)의 「확인 후 시작」 경합.
 *
 * 증상: 같은 순간에 도착한 시작 요청 N건이 모두 「지금 실행 중 0건」을 읽고 모두 start 판정을 받는다.
 *   실행 중 수는 러너가 **선점(claim)한 뒤에야** 올라가므로, 판정과 선점 사이에 들어온 요청은 서로를 못 본다.
 *   → 전체 상한(8)·고객별 상한(스타터 1/그로스 2)을 순간적으로 넘는다. (대기 줄 일꾼은 상한을 지키지만, 시작 경로가 앞지른다.)
 * 기대(올바른 동작): 동시에 도착한 20건 중 start 판정은 고객별 상한(2)을 넘지 않는다.
 * 실제: 20건 모두 start.
 *
 * 재현: cd apps/app && RUN_BUG_REPRO=1 npx vitest run __tests__/stability-t1-admission-race.bug.test.ts
 * 구현 변경이 필요하다(예: 시작 시 job 을 queued 로 만든 뒤 선점 경쟁에 맡기거나, 판정과 선점을 한 쿼리로 묶기). 이 단계(시험 작성)에서는 고치지 않는다.
 *
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/database", () => ({
  database: {
    auditJob: {
      // 아무도 선점하지 않은 순간 — 모든 요청이 같은 0 을 읽는다.
      groupBy: async () => [],
    },
  },
}));

const { decideAdmission } = await import("../lib/audit-queue/admission");

describe.skipIf(!process.env.RUN_BUG_REPRO)(
  "버그 재현: 동시에 도착한 시작 요청이 상한을 무시한다",
  () => {
    it("고객 A 20건이 같은 순간 도착하면 start 판정은 고객별 상한(2) 이하여야 한다", async () => {
      vi.stubEnv("STABILITY_ADMISSION_ENABLED", "1");
      const decisions = await Promise.all(
        Array.from({ length: 20 }, () => decideAdmission("A", "growth"))
      );
      expect(decisions.filter((d) => d === "start").length).toBeLessThanOrEqual(
        2
      );
    });
  }
);
