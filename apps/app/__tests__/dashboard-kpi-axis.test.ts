import koDict from "@repo/internationalization/dictionaries/ko.json";
/**
 * 🔬 **KPI 1번 카드 계약 가드** — N-46 라이브 실측이 잡은 두 가지를 고정한다.
 *
 * 1. 🔴🔴 **라벨과 값의 축이 같아야 한다**
 *    라벨은 `recognition`(엔진 축 · "곳")인데 값은 `sov`(응답 축 · "%")였다.
 *    라이브에서 *"AI가 우리를 아나? 95%"* 밑에 *"7곳 중 7곳"*(=100%)이 붙어
 *    **고객이 검산하면 안 맞았다**. 📕 N-30 「축이 다른 두 숫자를 나란히 두면 검산하려 든다」.
 *
 * 2. 🔴 **값이 있으면 빈 상태 문구를 쓰지 않는다**
 *    값과 힌트가 서로 다른 필드를 봐서 **「62%」 옆에 「측정하면 …보여드려요」** 가 떴다.
 *
 * @vitest-environment jsdom
 * 라벨의 축은 카드 소스, 빈 상태 분기는 실제 힌트 함수의 반환값으로 검증한다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { METRICS } from "@repo/audit/metric-dictionary";
import { describe, expect, it } from "vitest";
import { measurementCoverageHint } from "../app/(authenticated)/components/dashboard-kpis";

/** 문구는 사전에서 온다(2026-10-06) — 한국어 화면 기준으로 검사. */
const KO_KPIS = koDict.app.kpis;

const SRC = readFileSync(
  join(process.cwd(), "app/(authenticated)/components/dashboard-kpis.tsx"),
  "utf8"
);

/** 주석을 먼저 지운다 — 📕 「가드가 자기 주석을 센다」 사고 5회. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** 1번 카드 블록만 잘라낸다(다음 `<KpiCard` 전까지). */
function firstCardBlock(): string {
  const body = stripComments(SRC);
  const start = body.indexOf("<KpiCard");
  // 🔴 훑는 대상 비어있지 않음 자기점검(N-47). `expect` → `throw`
  //   (이 함수는 `it()` 밖이라 biome noMisplacedAssertion 이 옳다. 보호 강도는 동일.)
  if (start < 0) {
    throw new Error(
      "가드 대상이 없다: <KpiCard — 컴포넌트 이름이 바뀌었는지 확인할 것"
    );
  }
  const next = body.indexOf("<KpiCard", start + 8);
  return body.slice(start, next === -1 ? undefined : next);
}

describe("KPI 1번 카드 — 라벨과 값이 같은 축", () => {
  it("🔴🔴 **라벨이 sov(응답 축)의 질문이다** — 값이 %라서", () => {
    const card = firstCardBlock();
    expect(
      card,
      "값은 %(sov)인데 라벨이 recognition(곳) 이면 검산이 깨진다"
    ).toContain('metricCopy("sov", isKo).question');
    expect(card).not.toContain('metricCopy("recognition"');
  });

  it("⛔ **사전이 두 지표를 다른 축으로 정의하고 있다** (전제 확인)", () => {
    // 이 전제가 깨지면 위 규칙의 근거가 사라진다 → 사전을 먼저 본다.
    expect(METRICS.sov.axis).toBe("response");
    expect(METRICS.recognition.axis).toBe("uniqueEngine");
    expect(METRICS.sov.format).toBe("percent");
    expect(METRICS.recognition.format).toBe("count");
  });

  it("🔴 **힌트의 빈 상태가 값(latestSov)에 걸려 있다**", () => {
    const card = firstCardBlock();
    expect(card).toContain("measurementCoverageHint(coverage, latestSov, t)");
    expect(measurementCoverageHint(null, 62, KO_KPIS)).not.toContain(
      "측정하면"
    );
    expect(measurementCoverageHint(null, null, KO_KPIS)).toContain("측정하면");
  });

  it("⛔ **두 갈래가 같은 문구가 아니다** (분기만 있고 말이 같으면 화면은 그대로)", () => {
    expect(measurementCoverageHint(null, 62, KO_KPIS)).not.toBe(
      measurementCoverageHint(null, null, KO_KPIS)
    );
    expect(
      measurementCoverageHint({ mentioned: 2, total: 4 }, 62, KO_KPIS)
    ).toContain("측정한 AI·검색 4곳 중 2곳");
  });
});
