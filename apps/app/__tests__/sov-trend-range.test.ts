/**
 * @vitest-environment jsdom
 *
 * 🔴 **왜 이 가드가 있나** (세션N-41 — 대시보드 기간 필터)
 *
 * 경쟁사 4곳이 전부 기간 필터(`Last 7 Days`·`Last 14 days`·`Last 12 weeks`)를 갖는데
 * 우리는 없었다. 붙이면서 **장식 컨트롤이 되는 것**을 막아야 했다:
 *   ① 고르면 점이 2개 미만 → 빈 화면. 경쟁사 공통 실패 1번(Otterly `No data to display.`)
 *   ② 기준시각을 `Date.now()` 로 잡으면 며칠 쉰 계정이 "7일" 을 눌렀을 때 **0점**이 된다
 *      (멀쩡한 데이터가 사라진다)
 *   ③ 증감 기준이 기간에 따라 바뀌는데 분모를 안 밝히면 같은 숫자가 다른 뜻이 된다
 *
 * ⭐ 이 파일은 **소스 정규식이 아니라 실제 함수 동작**을 검사한다 — 계약을 직접 실행한다.
 *   📕 규율: 가드는 문구가 아니라 계약을 검사한다(reference_findable_traps §1).
 *
 * ⚠️ `.test.ts` 에 `@vitest-environment jsdom` 도크블록 필수(이 저장소는 vitest 설정
 *   파일이 없어 기본값이 `node` 다). 이 파일은 DOM 을 안 쓰지만, 임포트 사슬에
 *   `recharts`(브라우저 전제)가 걸려 있어 jsdom 이 필요하다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  filterByRange,
  headlineOf,
  rangeOptions,
} from "../app/(authenticated)/components/sov-trend-chart";
import type { SovTrendPoint } from "../app/(authenticated)/lib/dashboard-data";

const DAY = 24 * 60 * 60 * 1000;
/** 기준시각을 상수로 고정 — `Date.now()` 를 쓰면 테스트가 날짜에 따라 흔들린다. */
const NOW = new Date("2026-08-17T00:00:00Z").getTime();

/**
 * nike.com 실측 형태: 6회 · Jul 30~Aug 17 · SoV 0→97→97→94→97→94
 * ⚠️ `SovTrendPoint.sov` 는 **`number`(non-null)** 다 — 타입이 그렇게 선언돼 있다
 *   (`dashboard-data.ts:151`). 테스트가 null 을 넣으면 실제로 올 수 없는 입력을
 *   검증하는 것이 되므로 타입을 그대로 따른다.
 */
const point = (daysAgo: number, sov: number): SovTrendPoint => ({
  label: `d-${daysAgo}`,
  positiveRate: null,
  position: null,
  sov,
  timestamp: NOW - daysAgo * DAY,
});

const NIKE = [
  point(18, 0),
  point(18, 97),
  point(6, 97),
  point(4, 94),
  point(2, 97),
  point(0, 94),
];

describe("기간 필터 — 마지막 측정 기준으로 자른다", () => {
  it("🔴 기준시각은 `오늘`이 아니라 **마지막 측정**이다", () => {
    // 마지막 측정이 30일 전이고 그 앞 측정이 5일 전(=d-35)인 계정.
    //   `오늘` 기준이면 7일 창(d-0~d-7)에 **0점** → 멀쩡한 데이터가 사라진다.
    //   `마지막 측정`(d-30) 기준이면 d-35·d-30 이 들어와 **2점**이 남는다.
    const stale = [point(40, 88), point(35, 90), point(30, 95)];
    const got = filterByRange(stale, 7);
    expect(got.length, "오늘 기준으로 잘라서 멀쩡한 데이터가 사라졌다").toBe(2);
    expect(got.map((p) => p.label)).toEqual(["d-35", "d-30"]);
  });

  it("최근 7일은 실제로 구간을 좁힌다", () => {
    expect(filterByRange(NIKE, 7).length).toBe(4); // d-6·d-4·d-2·d-0
    expect(filterByRange(NIKE, null).length).toBe(6);
  });

  it("전체(null)는 원본을 그대로 준다", () => {
    expect(filterByRange(NIKE, null)).toHaveLength(NIKE.length);
  });

  it("빈 배열에도 터지지 않는다", () => {
    expect(filterByRange([], 7)).toEqual([]);
  });
});

describe("기간 선택지 — 빈 화면이 되는 버튼은 만들지 않는다", () => {
  it("🔴 고르면 점이 2개 미만인 기간은 선택지에 없다", () => {
    // 측정 2회가 20일 간격 → 7일·14일을 누르면 1점(빈 화면)이 된다.
    const sparse = [point(20, 90), point(0, 95)];
    const labels = rangeOptions(sparse).map((option) => option.label);
    expect(labels, "빈 화면이 되는 7일 버튼이 살아있다").not.toContain("7일");
    expect(labels, "빈 화면이 되는 14일 버튼이 살아있다").not.toContain("14일");
  });

  it("🔴 데이터가 채우는 기간은 선택지에 있다", () => {
    const labels = rangeOptions(NIKE).map((option) => option.label);
    // nike 실측 형태(18일 폭): 7일 4점 · 14일 4점 · 30일 6점 = 전체와 동일.
    //   30일이 이미 전체를 덮으므로 `전체` 는 **중복이라 붙지 않는다**(아래 케이스와 같은 계약).
    expect(labels).toContain("7일");
    expect(labels).toContain("30일");
    expect(labels.length).toBeGreaterThan(1); // 필터 UI 가 렌더되는 조건
  });

  it("선택지가 1개뿐이면 호출부가 UI 를 숨긴다(length<=1 계약)", () => {
    // 측정 1회 = 어느 기간도 2점을 못 만든다 → `전체` 하나만 남아야 한다.
    const single = [point(0, 90)];
    expect(rangeOptions(single).length).toBeLessThanOrEqual(1);
  });

  it("모든 후보가 전체와 같은 점 수면 `전체` 를 중복으로 붙이지 않는다", () => {
    // 3점이 하루 안에 몰려 있으면 7일·14일·30일·전체가 전부 3점 → 중복 버튼 방지.
    const dense = [point(0, 90), point(0, 92), point(0, 94)];
    const all = rangeOptions(dense).filter((o) => o.days === null);
    expect(all.length, "같은 결과를 주는 버튼이 중복으로 생겼다").toBe(0);
  });
});

/**
 * 🔴 **로직 테스트가 못 잡는 구멍을 메운다** — 뮤테이션으로 발견(N-41).
 *   `data={visible}` 를 `data={trend}` 로 되돌려도(=차트가 필터를 무시) 위 함수
 *   테스트는 **13/13 통과했다**. 필터를 눌러도 그림이 안 바뀌는 게 정확히 그 상태다.
 *   → 차트에 넘기는 값이 **필터된 배열**인지 소스 계약으로 함께 잠근다.
 * ⚠️ 이건 문구가 아니라 배선 검사다(어떤 변수를 차트에 넘기는가).
 */
const CHART_USES_FILTERED = /data=\{visible\}/;
const EMPTY_GATE_USES_FILTERED = /visible\.length < 2/;

describe("배선 — 차트가 필터된 데이터를 그린다", () => {
  it("🔴 AreaChart 에 `visible`(필터 결과)을 넘긴다", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(authenticated)/components/sov-trend-chart.tsx"),
      "utf8"
    );
    expect(
      source,
      "차트가 원본 trend 를 그린다 — 필터를 눌러도 그림이 안 바뀐다"
    ).toMatch(CHART_USES_FILTERED);
    expect(
      source,
      "빈 상태 판정이 원본 기준이다 — 필터 결과가 1점인데 그래프를 그리려 든다"
    ).toMatch(EMPTY_GATE_USES_FILTERED);
  });
});

describe("머리글 숫자 — 분모를 밝힌다", () => {
  it("최신 값과 구간 첫 점 대비 증감을 준다", () => {
    const got = headlineOf(filterByRange(NIKE, null), null);
    expect(got?.latest).toBe(94); // 마지막 점
    expect(got?.delta).toBe(94); // 0 → 94
    expect(got?.rangeNote).toBe("전체 기간");
  });

  it("🔴 기간을 좁히면 증감 기준도 함께 바뀐다", () => {
    // 7일 구간의 첫 점은 97 → 94-97 = -3
    const got = headlineOf(filterByRange(NIKE, 7), 7);
    expect(got?.delta).toBe(-3);
    expect(
      got?.rangeNote,
      "기간을 밝히지 않으면 같은 숫자가 다른 뜻이 된다"
    ).toBe("최근 7일");
  });

  it("점이 1개면 증감을 만들지 않는다(없는 비교를 지어내지 않는다)", () => {
    expect(headlineOf([point(0, 90)], null)?.delta).toBeNull();
  });

  it("빈 배열이면 머리글을 그리지 않는다", () => {
    expect(headlineOf([], null)).toBeNull();
  });

  it("소수점 증감을 1자리로 반올림한다(0.30000001 방지)", () => {
    const got = headlineOf([point(2, 90.1), point(0, 90.4)], null);
    expect(got?.delta).toBe(0.3);
  });

  it("변화가 없으면 0 을 준다(null 과 구분된다)", () => {
    // 🔴 `0` 과 `null` 은 다른 뜻이다 — 0=변화없음 · null=비교불가.
    //   섞으면 "변화 없음"을 "비교 못 함"으로 감추게 된다.
    const got = headlineOf([point(2, 95), point(0, 95)], null);
    expect(got?.delta).toBe(0);
  });
});
