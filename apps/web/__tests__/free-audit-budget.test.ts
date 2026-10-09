import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DAILY_FREE_BUDGET_KRW,
  dailyFreeJobCap,
  FREE_AUDIT_AVG_COST_API_SEARCH_KRW,
  FREE_AUDIT_AVG_COST_KRW,
  freeAuditAvgCostKrw,
} from "@/lib/free-audit-budget";

describe("무료 진단 일일 예산 — 원가모델 v2 재보정(2026-10-07)", () => {
  it("평균단가는 v2 환산 평균(≈777원) 이상이다 — v1 값 250원으로 돌아가지 않는다", () => {
    expect(FREE_AUDIT_AVG_COST_KRW).toBeGreaterThanOrEqual(777);
    expect(FREE_AUDIT_AVG_COST_KRW).toBe(1000);
  });

  it("기본 예산 5만원이면 하루 50건(예전 200건은 예산을 넘겼다)", () => {
    expect(dailyFreeJobCap(DEFAULT_DAILY_FREE_BUDGET_KRW)).toBe(50);
    // 회귀 가드: 예전 단가로는 200건이 나왔다.
    expect(dailyFreeJobCap(DEFAULT_DAILY_FREE_BUDGET_KRW, 250)).toBe(200);
  });

  it("예산이 이상하거나 단가보다 작아도 최소 1건은 남긴다", () => {
    expect(dailyFreeJobCap(500)).toBe(1);
    expect(dailyFreeJobCap(Number.NaN)).toBe(1);
    expect(dailyFreeJobCap(-1)).toBe(1);
  });
});

describe("무료 진단 평균 원가 — 엔진 세트(FINDABLE_ENGINE_SET) 보수 상향", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("플래그가 꺼져 있으면 기존 1,000원·하루 50건 그대로", () => {
    expect(freeAuditAvgCostKrw()).toBe(1000);
    expect(dailyFreeJobCap(DEFAULT_DAILY_FREE_BUDGET_KRW)).toBe(50);
  });

  it("api-search-v1 이면 더 비싼 값(1,400원)을 쓰고 하루 건수는 줄어든다", () => {
    vi.stubEnv("FINDABLE_ENGINE_SET", "api-search-v1");
    expect(FREE_AUDIT_AVG_COST_API_SEARCH_KRW).toBeGreaterThan(
      FREE_AUDIT_AVG_COST_KRW
    );
    expect(freeAuditAvgCostKrw()).toBe(1400);
    expect(dailyFreeJobCap(DEFAULT_DAILY_FREE_BUDGET_KRW)).toBe(35);
  });
});
