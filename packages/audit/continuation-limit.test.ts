import { describe, expect, it } from "vitest";
import {
  continuationLimitOf,
  MAX_AUDIT_CONTINUATIONS,
  makeAuditCheckpoint,
  readAuditCheckpoint,
} from "./checkpoint";
import {
  ABSOLUTE_MAX_CONTINUATIONS,
  plannedContinuationLimit,
  requiredContinuations,
} from "./continuation-limit";

const scope = {
  brandId: "brand-1",
  domain: "example.com",
  language: "both" as const,
  organizationId: "org-1",
};
const context = {
  brandName: "Example",
  brandVariants: [],
  identityGrounded: true,
  officialSiteIdentity: {
    finalUrl: "https://example.com",
    title: "Example",
    description: null,
    h1: null,
    siteName: null,
  },
};
const prompts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    text: `질문 ${i}`,
    lang: "ko" as const,
  }));
const requestedAt = "2026-10-14T03:04:00.000Z";

describe("이어가기 상한 = 질문 수로 계산 (2026-10-14)", () => {
  it("계산식: ⌈질문 수×40÷240⌉+1, 기본 2 이상 · 절대 상한 8 이하", () => {
    expect(requiredContinuations(8)).toBe(3);
    expect(requiredContinuations(20)).toBe(5);
    expect(plannedContinuationLimit(4, MAX_AUDIT_CONTINUATIONS)).toBe(2);
    expect(plannedContinuationLimit(20, MAX_AUDIT_CONTINUATIONS)).toBe(5);
    expect(plannedContinuationLimit(500, MAX_AUDIT_CONTINUATIONS)).toBe(
      ABSOLUTE_MAX_CONTINUATIONS
    );
    expect(ABSOLUTE_MAX_CONTINUATIONS).toBe(8);
  });
});

describe("옛 체크포인트·진행 중 회차 호환 — 기본 2 유지", () => {
  it("continuationLimit 이 없는 체크포인트는 상한 2 (대시보드 회차 동작 불변)", () => {
    const cp = makeAuditCheckpoint(scope, context, prompts(8));
    expect(continuationLimitOf(cp)).toBe(2);
    expect(readAuditCheckpoint(cp, scope)?.continuationLimit).toBeUndefined();
  });

  it("옛 체크포인트의 이어가기 기록(count 1~2)은 그대로 읽힌다, 3은 거부된다", () => {
    const cp = makeAuditCheckpoint(scope, context, prompts(8));
    for (const count of [1, 2]) {
      expect(
        readAuditCheckpoint(
          { ...cp, continuation: { count, requestedAt } },
          scope
        )?.continuation?.count
      ).toBe(count);
    }
    expect(() =>
      readAuditCheckpoint(
        { ...cp, continuation: { count: 3, requestedAt } },
        scope
      )
    ).toThrow("invalid audit checkpoint");
  });

  it("저장된 continuationLimit(20문항=5)은 상한이 되고, 그 안의 이어가기 횟수만 허용된다", () => {
    const cp = {
      ...makeAuditCheckpoint(scope, context, prompts(20)),
      continuationLimit: 5,
    };
    expect(continuationLimitOf(cp)).toBe(5);
    expect(
      readAuditCheckpoint(
        { ...cp, continuation: { count: 5, requestedAt } },
        scope
      )?.continuation?.count
    ).toBe(5);
    expect(() =>
      readAuditCheckpoint(
        { ...cp, continuation: { count: 6, requestedAt } },
        scope
      )
    ).toThrow("invalid audit checkpoint");
  });

  it("그림자 상한과 저장 상한 중 큰 값, 절대 상한 8 초과는 거부", () => {
    const shadow = { maxContinuations: 6 } as never;
    expect(
      continuationLimitOf({ continuationLimit: 4, shadowPlanV2: shadow })
    ).toBe(6);
    expect(
      continuationLimitOf({ continuationLimit: 7, shadowPlanV2: shadow })
    ).toBe(7);
    const cp = makeAuditCheckpoint(scope, context, prompts(2));
    for (const bad of [9, 1, 2.5, "5"]) {
      expect(() =>
        readAuditCheckpoint({ ...cp, continuationLimit: bad }, scope)
      ).toThrow("invalid audit checkpoint");
    }
    // 기본 상한(2)은 허용
    expect(
      readAuditCheckpoint({ ...cp, continuationLimit: 2 }, scope)
        ?.continuationLimit
    ).toBe(2);
  });
});
