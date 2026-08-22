/**
 * 🔴🔴 **순위 평균의 모집단을 밝힌다** (N-48 · 2026-08-20).
 *
 * ## 프로덕션 실측이 발단
 *
 * 대시보드가 「4개 중 1.3번째」라고 headline 을 쓴다. 그런데 실제로는:
 *
 * | 엔진 | 등장 | 순위 산출 |
 * |---|---:|---:|
 * | Claude · Perplexity · 네이버 · 다음 | 46 | **0** (목록형 답변이 아니다) |
 * | Gemini · ChatGPT · HyperCLOVA X | 50 | 18 |
 * | **합계** | **96** | **18 (19%)** |
 *
 * 🔴 **19% 로 만든 평균이 전체 대표값처럼 읽힌다.** 고객은 *"우리가 1.3번째"* 라고 믿고
 *   의사결정하는데, 실제로는 **7개 엔진 중 2~3개** 이야기다.
 *
 * ⚠️ `averagePosition` 이 null 을 제외하는 것 **자체는 옳다** — 0 으로 깔면 순위가
 *   실제보다 좋게 왜곡된다. 문제는 **제외했다는 사실을 화면이 말하지 않는 것**이다.
 *   📕 이 저장소 최다 사고 *"못 잰 것을 0이라 부르기"* 의 사촌 —
 *     **못 잰 것을 조용히 빼고 남은 것으로 단정하기.**
 *
 * ⭐ 옆의 등장률은 이미 「질문 4개 기준」으로 모집단을 밝힌다. **같은 문법**을 준다.
 * 📕 재설계안 v4 §403 이 규정한 `평균 N개 중 · M개 응답 평균` 의 **M** 이 이것이다.
 *
 * @vitest-environment jsdom
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardKpis } from "../app/(authenticated)/components/dashboard-kpis";
import type { DashboardData } from "../app/(authenticated)/lib/dashboard-data";

const base: DashboardData = {
  averageMentionListSize: 4,
  averageMentionPosition: 1.3,
  brandOptions: [],
  coverage: { mentioned: 7, total: 7 },
  latestBrandDomain: "sulwhasoo.com",
  latestBrandId: "b1",
  latestBrandName: "sulwhasoo.com",
  latestMeasuredAt: new Date("2026-08-20T01:00:00Z"),
  latestSov: 95,
  positionSampleCount: 18,
  previousMentionPosition: null,
  previousSentiment: null,
  promptScores: [],
  sentiment: null,
  sovDeltaPoints: null,
  totalCount: 7,
  trend: [],
};

describe("순위 카드 — 모집단을 밝힌다", () => {
  afterEach(cleanup);

  it("🔴🔴 「N개 응답 평균」이 화면에 있다(원래 버그: 없었다)", () => {
    render(<DashboardKpis data={base} paid={true} />);
    expect(screen.getByText(/순위는 18개 응답 평균/)).toBeTruthy();
  });

  it("⚠️ 표본 수를 **모르면**(폴백 경로) 표기를 생략한다 — 지어내지 않는다", () => {
    // AuditJob 폴백은 이 수를 모른다 → null. 0 으로 깔면 "0개 응답 평균"이라는 거짓이 된다.
    render(
      <DashboardKpis data={{ ...base, positionSampleCount: null }} paid={true} />
    );
    expect(screen.queryByText(/응답 평균/)).toBeNull();
    // 그래도 순위 자체는 계속 보여준다(값은 있다).
    expect(screen.getByText(/4개 중 1\.3번째/)).toBeTruthy();
  });

  it("⚠️ 표본이 0이면 표기하지 않는다(순위가 아예 없는 측정)", () => {
    render(
      <DashboardKpis
        data={{
          ...base,
          averageMentionPosition: null,
          positionSampleCount: 0,
        }}
        paid={true}
      />
    );
    expect(screen.queryByText(/응답 평균/)).toBeNull();
  });

  it("✅ 등장률의 모집단 표기와 **같은 자리·같은 문법**이다(회귀 방지)", () => {
    render(
      <DashboardKpis
        data={{
          ...base,
          promptScores: [
            { hit: 3, position: 1.5, text: "q1", total: 4 },
            { hit: 2, position: null, text: "q2", total: 4 },
          ],
        }}
        paid={true}
      />
    );
    // 한 줄 안에서 「질문 N개 기준」과 「순위는 M개 응답 평균」이 같이 읽혀야 한다.
    expect(screen.getByText(/질문 2개 기준.*순위는 18개 응답 평균/)).toBeTruthy();
  });
});

/**
 * 🔴 **폴백 경로가 표본 수를 「지어내지」 않는지** 소스로 못박는다.
 *
 * ⚠️ 위 렌더 테스트는 **컴포넌트 prop** 만 검증한다 — 데이터 계층이 `null` 대신 `0` 을
 *   깔아도 렌더 테스트는 통과한다(뮤테이션으로 실제 확인했다: 4/4 통과).
 *   📕 이 저장소 규율 *"가드가 원래 버그를 무는지 확인한다"* — 그래서 이 블록을 더 짰다.
 *
 * AuditJob 폴백에는 순위 표본 수가 **없다**(`AuditMetrics` 에 그 필드가 없다).
 * 그때 `0` 을 넣으면 화면이 「0개 응답 평균」이라 말하거나, 조건을 지나쳐 **거짓 표기**가 된다.
 */
describe("폴백 경로 — 표본 수를 지어내지 않는다", () => {
  it("🔴 AuditJob 폴백은 `positionSampleCount: null` 이다(0 이 아니다)", () => {
    const src = readFileSync(
      join(process.cwd(), "app/(authenticated)/lib/dashboard-data.ts"),
      "utf8"
    );
    // 주석을 먼저 벗긴다 — 주석에 적힌 설명을 코드로 세면 안 된다(N-47 사고 5회).
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code.length).toBeGreaterThan(2000); // 훑는 대상이 비어있지 않다
    expect(code).toContain("positionSampleCount: null");
    // 🔴 0 으로 깔면 안 된다.
    expect(code).not.toMatch(/positionSampleCount:\s*0\s*,/);
  });
});
