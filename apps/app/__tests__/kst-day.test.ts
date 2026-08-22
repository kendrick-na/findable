/*
 * KST 하루 경계 테스트 — 2026-08-12 세션N-25.
 *
 * 🔴 **막는 사고**: 일일 상한이 **UTC 자정**으로 끊기는 것.
 *   그러면 한국 사용자 기준 **오전 9시에 리셋**돼서 "아침부터 이미 소진" 이 된다.
 *   이 프로젝트는 같은 종류로 이미 크게 뎄다 — cron `0 17 * * *` 을 "새벽 2시"로
 *   읽었는데 UTC 라서 실제로는 **오전 11시 KST** 에 돌고 있었다.
 *
 * ⚠️ **왜 테스트가 꼭 필요한가**: 날짜 경계는 **라이브에서 확인이 불가능**하다.
 *   자정을 기다려야 하고 경계 직전/직후를 재현할 수 없다.
 *   → 프로젝트 규칙: *"라이브에서 확인 못 하는 경로는 순수 함수로 빼서 테스트로 고정."*
 *
 * ⚠️ `kstDayStart` 는 기준 시각을 **인자로 받는다** — 안에서 `Date.now()` 를 부르면
 *   가짜 타이머가 시계를 안 돌려 테스트가 불가능해진다(프로젝트 함정 목록).
 *
 * @vitest-environment node
 */

import { kstDayStart } from "@repo/audit/kst-day";
import { describe, expect, test } from "vitest";

describe("kstDayStart — KST 하루 경계", () => {
  test("KST 자정 직후는 그 날의 시작을 가리킨다", () => {
    // 2026-08-12 00:00 KST = 2026-08-11 15:00 UTC
    const justAfterMidnightKst = new Date("2026-08-11T15:00:00.000Z");
    expect(kstDayStart(justAfterMidnightKst).toISOString()).toBe(
      "2026-08-11T15:00:00.000Z"
    );
  });

  test("KST 자정 1분 전은 **전날** 시작을 가리킨다 — 경계가 밀리면 실패한다", () => {
    // 2026-08-11 23:59 KST = 2026-08-11 14:59 UTC
    const justBeforeMidnightKst = new Date("2026-08-11T14:59:00.000Z");
    expect(kstDayStart(justBeforeMidnightKst).toISOString()).toBe(
      "2026-08-10T15:00:00.000Z"
    );
  });

  test("🔴 UTC 자정으로 끊는 구현이면 실패한다 — 사고 재현 방지", () => {
    // 2026-08-12 08:00 KST = 2026-08-11 23:00 UTC.
    // UTC 기준으로 자르면 "2026-08-11T00:00Z"(= KST 오전 9시)가 나온다.
    // KST 기준이면 "2026-08-11T15:00Z"(= KST 자정)여야 한다.
    const morningKst = new Date("2026-08-11T23:00:00.000Z");
    const start = kstDayStart(morningKst);

    expect(start.toISOString()).toBe("2026-08-11T15:00:00.000Z");
    // UTC 자정 구현이었다면 이 값이 나왔을 것 — 명시적으로 배제한다.
    expect(start.toISOString()).not.toBe("2026-08-11T00:00:00.000Z");
  });

  test("UTC 날짜가 바뀌어도 같은 KST 하루면 같은 시작을 준다", () => {
    // 둘 다 2026-08-12 KST (오전 6시 / 오후 11시)
    const a = new Date("2026-08-11T21:00:00.000Z"); // 12일 06:00 KST
    const b = new Date("2026-08-12T14:00:00.000Z"); // 12일 23:00 KST

    expect(kstDayStart(a).toISOString()).toBe(kstDayStart(b).toISOString());
    expect(kstDayStart(a).toISOString()).toBe("2026-08-11T15:00:00.000Z");
  });

  test("월·연 경계를 넘어도 깨지지 않는다", () => {
    // 2027-01-01 00:30 KST = 2026-12-31 15:30 UTC
    const newYearKst = new Date("2026-12-31T15:30:00.000Z");
    expect(kstDayStart(newYearKst).toISOString()).toBe(
      "2026-12-31T15:00:00.000Z"
    );
  });

  test("반환값은 항상 KST 자정 = UTC 15:00 이다", () => {
    // 하루를 3시간 간격으로 훑어도 시각 부분은 늘 15:00Z 여야 한다.
    const base = Date.UTC(2026, 7, 11, 0, 0, 0);
    for (let h = 0; h < 24; h += 3) {
      const t = new Date(base + h * 60 * 60 * 1000);
      const start = kstDayStart(t);
      expect(start.getUTCHours()).toBe(15);
      expect(start.getUTCMinutes()).toBe(0);
      expect(start.getUTCSeconds()).toBe(0);
    }
  });
});
