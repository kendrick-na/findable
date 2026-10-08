import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planCapabilities } from "@repo/auth/plan";
import { describe, expect, it } from "vitest";

/**
 * 🔴 요금표의 브랜드 수 = 실제 플랜 한도(2026-10-06).
 * 사고: 영어 요금표만 Starter 를 *"1 brand monitored"* 로 적었다 — 코드는 3개, 한국어 표도 3개.
 * 같은 사실을 언어마다 다르게 말하면 돈 내기 전 화면이 거짓말을 한다.
 */
const PAGE = readFileSync(
  join(import.meta.dirname, "../app/[locale]/pricing/page.tsx"),
  "utf8"
);

describe("pricing page brand counts match plan limits", () => {
  it.each(["starter", "growth"] as const)("%s", (plan) => {
    const limit = planCapabilities(plan).brandLimit;
    expect(PAGE).toContain(`"${limit}개 브랜드 측정"`);
    expect(PAGE).toContain(`"${limit} brands monitored"`);
  });

  it("영어 표에 1개 브랜드라는 표기가 남지 않는다", () => {
    expect(PAGE).not.toContain("1 brand monitored");
  });
});
