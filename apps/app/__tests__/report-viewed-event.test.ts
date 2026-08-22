/**
 * 🔴 **왜 이 테스트가 있나** (세션N-39 · v4 P1-8)
 *
 * v4 가 요구한 `report_viewed` 가 **코드에 0건**이었다(백로그에 ⬜ 로만 남아 있었다).
 * v4 §P1-8: *"이게 없으면 부분가림·트라이얼이 효과 있었는지 판단할 수 없다."*
 *
 * 🔬 이 이벤트가 `$pageview`·`audit_completed` 와 **어떻게 다른가**(중복 아님의 근거):
 *   - `$pageview`      = URL 도달. 측정 실패·측정 중에도 찍힌다 → 「봤다」가 아니다.
 *   - `audit_completed`= 측정이 끝났다(**생산**).
 *   - `report_viewed`  = 사람이 결과를 봤다(**소비**).
 *   둘의 차이가 곧 **끝났는데 아무도 안 본 진단**이다.
 *
 * 🔴 가장 중요한 계약은 **`revisit` 경로가 살아 있는 것**이다. 이미 완료된 결과를 열면
 *   폴링이 안 돌아 live 집계가 발화하지 않는다 — 링크 공유 조회가 통째로 증발한다.
 *
 * ⚠️ 규율: 가드는 문구가 아니라 **계약**을 검사한다(reference_findable_traps §1).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");
const FUNNEL = join(ROOT, "packages/analytics/funnel.ts");
const VIEW = join(
  ROOT,
  "apps/web/app/[locale]/audit/[jobId]/components/audit-result.tsx"
);

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

const funnelCode = stripToCode(readFileSync(FUNNEL, "utf8"));
const viewCode = stripToCode(readFileSync(VIEW, "utf8"));

// 정규식은 최상위에(lint: useTopLevelRegex).
const EXPORTS_TRACKER = /export const trackReportViewed = /;
const EMITS_EVENT = /safeCapture\(\s*"report_viewed"/;
const HAS_MODE_TYPE =
  /export type ReportViewMode =[\s\S]{0,200}?"live" \| "revisit"/;
const IMPORTS_TRACKER =
  /trackReportViewed,?\s*\n?\s*\}? from "@repo\/analytics\/funnel"/;
const CALLS_LIVE = /trackReportViewed\(\{[\s\S]{0,200}?mode: "live"/;
const CALLS_REVISIT = /trackReportViewed\(\{[\s\S]{0,200}?mode: "revisit"/;
const DEDUPE_REF = /reportViewedRef/;
const REVISIT_GUARDS_RESULT =
  /!job\?\.result \|\|[\s\S]{0,80}?status !== "completed"/;
const SAFE_CAPTURE_WRAPPED = /const safeCapture = /;

describe("P1-8 report_viewed — 측정 완료(생산)와 조회(소비)를 가른다", () => {
  // ── 가드 ①: 이벤트가 실제로 발행된다 ──────────────────────────
  it("🔴 trackReportViewed 가 report_viewed 를 실제로 쏜다", () => {
    expect(funnelCode, "트래커가 없다").toMatch(EXPORTS_TRACKER);
    // 함수만 있고 capture 를 안 하면 **아무것도 안 하는 계측**이 된다(가짜 안심).
    expect(funnelCode, "이벤트 이름을 실제로 쏘지 않는다").toMatch(EMITS_EVENT);
  });

  // ── 가드 ②: live/revisit 축이 존재한다 ────────────────────────
  it("도달 경로를 live·revisit 로 구분한다", () => {
    // 축이 없으면 "링크 공유가 도는가"를 영영 못 묻는다 — 이 이벤트의 핵심 가치다.
    expect(funnelCode).toMatch(HAS_MODE_TYPE);
  });

  // ── 가드 ③: 두 경로가 **둘 다** 연결돼 있다 ────────────────────
  it("🔴 live 와 revisit 두 호출부가 모두 있다", () => {
    expect(viewCode, "결과 화면이 트래커를 import 하지 않는다").toMatch(
      IMPORTS_TRACKER
    );
    expect(viewCode, "live(폴링 완료) 호출부가 없다").toMatch(CALLS_LIVE);
    // 🔴 여기가 진짜 조준점 — revisit 이 빠지면 링크 공유 조회가 통째로 증발한다
    expect(
      viewCode,
      "revisit 호출부가 없다 — 이미 완료된 결과를 열면 폴링이 안 돌아 아무것도 안 세어진다"
    ).toMatch(CALLS_REVISIT);
  });

  // ── 가드 ④: 중복 집계를 막는다 ────────────────────────────────
  it("같은 조회를 두 번 세지 않는다", () => {
    // live·revisit 이 같은 ref 를 공유해야 한 조회가 1회로 남는다.
    expect(viewCode).toMatch(DEDUPE_REF);
  });

  // ── 가드 ⑤: 빈손 화면을 「봤다」로 세지 않는다 ──────────────────
  it("🔴 실패·결과없음은 조회로 세지 않는다($pageview 와의 차이)", () => {
    // 이 조건이 빠지면 이 이벤트는 $pageview 의 복사본이 되고, 중복 계측이 된다.
    expect(
      viewCode,
      "결과 존재·completed 조건이 없으면 빈 화면도 「봤다」로 집계된다"
    ).toMatch(REVISIT_GUARDS_RESULT);
  });

  // ── 가드 ⑥: 분석 실패가 화면을 깨뜨리지 않는다 ─────────────────
  it("계측 실패가 본 기능을 깨뜨리지 않는다", () => {
    // 공용 safeCapture 를 타야 한다(직접 analytics.capture 를 부르면 throw 가 샌다).
    expect(funnelCode).toMatch(SAFE_CAPTURE_WRAPPED);
  });
});
