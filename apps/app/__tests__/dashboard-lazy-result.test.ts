/**
 * 🔴 **왜 이 테스트가 있나** (세션N-39)
 *
 * 대시보드 첫 픽셀까지의 서버 대기 **83%가 쿼리 한 줄**이었다.
 * `auditJob.findMany(take:20)` 이 `result`(Json) 를 통째로 실어와서
 * 20행에 **837KB**(행당 42KB)가 붙었다 — **6,293ms**.
 * 같은 쿼리에서 Json 만 빼면 **196ms**(32배).
 *
 * 그런데 그 `result` 는 **Tracking 이 비었을 때만** 쓰는 폴백 입력이다.
 * [실측 2026-08-17] org 4개 중 데이터 있는 2개는 **둘 다 Tracking 보유**(197·42행)
 * → 실사용 경로에서 837KB 는 **읽고 그대로 버려졌다.**
 *
 * ⚠️ 이 테스트가 지키는 계약은 **"빠르다"가 아니라 "무거운 컬럼을 조건부로 읽는다"** 다.
 *   속도는 환경 따라 흔들리지만 이 구조는 흔들리면 안 된다.
 *   📕 규율: 가드는 문구가 아니라 **계약**을 검사한다(reference_findable_traps §1).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");
const PAGE = join(ROOT, "apps/app/app/(authenticated)/page.tsx");

/** 주석을 걷고 실행 코드만 남긴다(줄 끝 주석 포함 — N-36 에서 뚫린 자리). */
const stripToCode = (raw: string): string => {
  const out: string[] = [];
  let inBlock = false;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes("*/")) {
        inBlock = false;
      }
      continue;
    }
    if (t.startsWith("//") || t.startsWith("*")) {
      continue;
    }
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) {
        inBlock = true;
      }
      continue;
    }
    let quote: string | null = null;
    let cut = -1;
    for (let i = 0; i < line.length; i++) {
      const c = line[i] as string;
      if (quote) {
        if (c === "\\") {
          i++;
        } else if (c === quote) {
          quote = null;
        }
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        continue;
      }
      if (c === "/" && line[i + 1] === "/") {
        cut = i;
        break;
      }
    }
    out.push(cut >= 0 ? line.slice(0, cut) : line);
  }
  return out.join("\n");
};

const pageCode = stripToCode(readFileSync(PAGE, "utf8"));

// 정규식은 최상위에(lint: useTopLevelRegex).
const LITE_QUERY = /const jobsLite =[\s\S]*?take: 20,[\s\S]*?\)\s*:\s*\[\];/;
const HEAVY_QUERY = /const jobsWithResult =[\s\S]*?:\s*null;/;
const SELECT_BLOCK = /select:\s*\{[\s\S]*?\}/;
const GUARDED_BY_TRACKING = /trackingData === null/;
const FALLBACK_USES_HEAVY = /buildDashboardData\(jobsWithResult/;
const HAS_DATA_USES_LITE = /hasData\s*=\s*trackingData !== null \|\| jobsLite/;
const RESULT_SELECTED = /\bresult:\s*true/;
const FALLBACK_USES_LITE = /buildDashboardData\(jobsLite/;

describe("대시보드 — 무거운 result(Json)를 조건부로만 읽는다", () => {
  // ── 가드 ①: 1차 쿼리가 select 로 좁혀져 있다 ─────────────────
  it("🔴 1차 조회는 select 로 좁혀 result 를 싣지 않는다", () => {
    const lite = pageCode.match(LITE_QUERY);
    expect(lite, "jobsLite 조회를 못 찾았다").not.toBeNull();
    const q = lite?.[0] ?? "";
    // select 가 있어야 한다(없으면 전체 컬럼 = 837KB 회귀)
    expect(q, "select 없이 전체 컬럼을 읽고 있다").toMatch(SELECT_BLOCK);
    // 🔴 여기 result 가 들어오면 최적화가 통째로 무효가 된다 — 진짜 조준점
    expect(q, "1차 조회에 result 가 들어왔다(=6.3초 회귀)").not.toMatch(
      RESULT_SELECTED
    );
  });

  // ── 가드 ②: 무거운 조회가 Tracking 조건 뒤에 숨어 있다 ────────
  it("🔴 무거운 조회는 폴백이 필요할 때만 실행된다", () => {
    const heavy = pageCode.match(HEAVY_QUERY);
    expect(heavy, "jobsWithResult 조회를 못 찾았다").not.toBeNull();
    // 조건 없이 무조건 실행되면 쪼갠 의미가 없다
    expect(heavy?.[0], "무거운 조회가 trackingData 조건 없이 돈다").toMatch(
      GUARDED_BY_TRACKING
    );
  });

  // ── 가드 ③: 폴백 경로가 실제로 무거운 쪽을 쓴다 ───────────────
  it("폴백 집계는 result 를 가진 쪽을 입력으로 받는다", () => {
    // 가벼운 쪽을 넘기면 `result` 가 없어 폴백이 **조용히 빈 대시보드**가 된다.
    expect(pageCode).toMatch(FALLBACK_USES_HEAVY);
    expect(
      pageCode,
      "폴백에 jobsLite 를 넘기면 result 가 없어 집계가 비어버린다"
    ).not.toMatch(FALLBACK_USES_LITE);
  });

  // ── 가드 ④: hasData 는 가벼운 쪽으로 판정한다 ─────────────────
  it("빈 상태 판정에 무거운 조회를 쓰지 않는다", () => {
    // hasData 가 jobsWithResult 를 보면 그걸 항상 읽어야 해서 최적화가 무너진다.
    expect(pageCode).toMatch(HAS_DATA_USES_LITE);
  });
});
