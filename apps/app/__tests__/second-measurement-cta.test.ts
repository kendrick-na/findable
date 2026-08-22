/**
 * 「2회차를 하라」고 **말하는 자리마다 방법을 준다** — 2026-08-17 세션N-37.
 *
 * 🔴 **왜 이 검사가 있나**: 화면 3곳이 *"비교는 2회차 측정부터 보여드려요"* ·
 *   *"두 번째 측정을 하면 변화를 그려드려요"* 라고 안내하는데 **버튼이 없었다.**
 *   그래서 3주 동안 아무도 2회차를 안 돌렸고, 다 만들어 둔 화면 4개
 *   (추세 그래프·순위 비교·감성 변화·메모)가 **잠긴 채로 방치**됐다.
 *   실측(2026-08-17): 1건(87원) 돌리자 그 4개가 **즉시** 열렸다.
 *
 * ⚠️ 문구를 하드코딩해 검사하지 않는다(문구는 계속 다듬는다).
 *   **계약**을 검사한다 = "빈 추세 카드에는 재측정 진입점이 있다".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CHART = readFileSync(
  join(process.cwd(), "app/(authenticated)/components/sov-trend-chart.tsx"),
  "utf8"
);
const PAGE = readFileSync(
  join(process.cwd(), "app/(authenticated)/page.tsx"),
  "utf8"
);

/** 주석을 걷고 실행되는 코드만 남긴다(줄머리·줄끝 모두). */
function stripToCode(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const t = line.trimStart();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");
}

const chart = stripToCode(CHART);
const page = stripToCode(PAGE);

describe("빈 추세 카드 = 다음 행동을 준다", () => {
  it("빈 상태 분기(보이는 점 < 2)에 진입점 자리가 있다", () => {
    // 데이터가 2개 이상이면 그래프가 그려지므로 진입점은 **빈 쪽**에만 있어야 한다.
    // ⚠️ 2026-08-18(N-41): 기간 필터가 들어오면서 판정 기준이 `trend` → `visible`
    //   (필터 결과)로 바뀌었다. **의도를 유지한 채 앵커만 갱신**한다 —
    //   가드를 지우지 말 것(📕 reference_findable_traps: 리팩터하면 가드가 깨지는 게 정상).
    const emptyBranch = chart.slice(
      chart.indexOf("visible.length < 2"),
      chart.indexOf("<ChartContainer")
    );
    expect(emptyBranch).toMatch(/\{emptyAction\}/);
  });

  it("페이지가 실제 측정 버튼을 주입한다", () => {
    // 🔴 이게 없으면 자리만 있고 **영원히 비어 있다**(3주간 그랬다).
    expect(page).toMatch(/emptyAction=\{/);
    expect(page).toMatch(/<StartTrackingButton/);
  });

  it("못 누르는 버튼을 그리지 않는다 — 도메인·이름이 있을 때만", () => {
    // 뮤테이션 확인: 이 가드를 빼면 깨진다(확인함).
    expect(page).toMatch(/data\.latestBrandDomain && data\.latestBrandName/);
  });

  it("차트는 서버액션을 import 하지 않는다 — 순수 표시 컴포넌트", () => {
    // 🔴 import 하면 Storybook 이 `child_process`·`net` 을 못 찾아 죽는다(실측).
    expect(chart).not.toMatch(
      /from "\.\.\/features\/brand\/start-tracking-button"/
    );
  });
});
