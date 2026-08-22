/*
 * 조치 전후(before/after) 대조 회귀 테스트 — 2026-08-12 세션N-24.
 *
 * 🔴 **막는 사고: 근거가 안 되는 숫자를 근거처럼 내놓는 것.**
 *   이 값은 대표님이 **투자·영업 자리에서 쓸 자료**다. 여기서 과장이 섞이면
 *   그건 버그가 아니라 **허위 보고**가 된다.
 *
 * 📌 실제 사고 이력: 설화수 언급 16→27 상승분은 측정자가 **전량 우리 본인**이었고
 *   상승 시기가 **우리 측정기 개선 시기와 겹쳤다**. 그대로 내놨으면 VC 에게
 *   *"제품 효과가 아니라 측정 방식이 바뀐 것"* 으로 **정확히 반대로** 읽혔을 것이다.
 *   → 그래서 이 모듈은 판정하지 않고 **숫자와 한계를 같이** 내보낸다.
 *
 * @vitest-environment node
 */
import {
  type BeforeAfterRow,
  buildBeforeAfterRow,
  presentableRows,
} from "@repo/audit/before-after";
import { describe, expect, test } from "vitest";

const DAY = 24 * 60 * 60 * 1000;
const completedAt = new Date("2026-08-01T00:00:00Z");
const at = (offsetDays: number) =>
  new Date(completedAt.getTime() + offsetDays * DAY);

const completion = {
  completedAt,
  kind: "source_portfolio",
  recognitionAtCompletion: 0.5,
  sovAtCompletion: 0.3,
  target: "test.com",
};

describe("before = 완료 시점 스냅샷을 신뢰한다", () => {
  test("스냅샷이 있으면 시계열보다 스냅샷을 쓴다", () => {
    // 시계열의 직전값(0.9)과 스냅샷(0.3)이 다를 때 스냅샷이 이겨야 한다.
    // 스냅샷 = "그때 화면에 뭐라고 쓰여 있었나" = 진짜 before.
    const row = buildBeforeAfterRow(completion, [
      { measuredAt: at(-1), sov: 0.9 },
      { measuredAt: at(2), sov: 0.5 },
    ]);
    expect(row.beforeSov).toBe(0.3);
  });

  test("스냅샷이 없으면 직전 측정으로 대신하고 그 사실을 경고한다", () => {
    const row = buildBeforeAfterRow({ ...completion, sovAtCompletion: null }, [
      { measuredAt: at(-1), sov: 0.2 },
      { measuredAt: at(2), sov: 0.5 },
    ]);
    expect(row.beforeSov).toBe(0.2);
    expect(row.caveats.join()).toContain("스냅샷이 없어");
  });
});

describe("after = 조치 후 충분히 지난 측정만 인정한다", () => {
  test("🔴 조치 당일 측정은 after 로 치지 않는다 (조치 효과일 수 없다)", () => {
    const row = buildBeforeAfterRow(completion, [
      { measuredAt: at(0.5), sov: 0.9 }, // 12시간 뒤 — 너무 이르다
    ]);
    expect(row.afterSov).toBeNull();
    expect(row.deltaSov).toBeNull();
    expect(row.caveats.join()).toContain("24시간");
  });

  test("24시간 이상 지난 첫 측정을 after 로 쓴다", () => {
    const row = buildBeforeAfterRow(completion, [
      { measuredAt: at(0.5), sov: 0.9 },
      { measuredAt: at(2), sov: 0.5 },
      { measuredAt: at(5), sov: 0.7 },
    ]);
    expect(row.afterSov).toBe(0.5);
  });

  test("delta 는 after - before", () => {
    const row = buildBeforeAfterRow(completion, [
      { measuredAt: at(2), sov: 0.5 },
    ]);
    expect(row.deltaSov).toBeCloseTo(0.2, 5);
  });
});

describe("🔴 0 과 '아직 모른다'를 구분한다", () => {
  test("after 측정이 없으면 delta 가 0 이 아니라 null 이다", () => {
    const row = buildBeforeAfterRow(completion, []);
    // 🔴 0 으로 만들면 "효과 없음"이라는 **없는 사실**을 주장하게 된다.
    expect(row.deltaSov).toBeNull();
    expect(row.afterSov).toBeNull();
  });

  test("before 가 없으면 비교 불가를 명시한다", () => {
    const row = buildBeforeAfterRow({ ...completion, sovAtCompletion: null }, [
      { measuredAt: at(2), sov: 0.5 },
    ]);
    expect(row.beforeSov).toBeNull();
    expect(row.deltaSov).toBeNull();
    expect(row.caveats.join()).toContain("비교할 수 없");
  });
});

describe("🔴 인과로 단정하지 않는다 (가장 중요한 가드)", () => {
  test("숫자가 나온 행에는 반드시 인과 경고가 붙는다", () => {
    const row = buildBeforeAfterRow(completion, [
      { measuredAt: at(2), sov: 0.5 },
      { measuredAt: at(3), sov: 0.6 },
      { measuredAt: at(4), sov: 0.7 },
    ]);
    expect(row.deltaSov).not.toBeNull();
    // 이 경고가 빠지면 "조치했더니 올랐다"는 인과 주장이 된다.
    expect(row.caveats.join()).toContain("인과로 단정할 수 없");
  });

  test("측정이 3회 미만이면 추세 경고가 붙는다", () => {
    const row = buildBeforeAfterRow(completion, [
      { measuredAt: at(2), sov: 0.5 },
    ]);
    expect(row.caveats.join()).toContain("추세로 보기 어렵");
  });

  test("점수가 떨어져도 숨기지 않는다", () => {
    const row = buildBeforeAfterRow(completion, [
      { measuredAt: at(2), sov: 0.1 },
    ]);
    // 🔴 불리한 결과를 감추면 그건 조작이다.
    expect(row.deltaSov).toBeCloseTo(-0.2, 5);
  });
});

describe("presentableRows — 내놓을 수 있는 것만", () => {
  test("delta 가 없는 행은 제외한다", () => {
    const rows: BeforeAfterRow[] = [
      buildBeforeAfterRow(completion, [{ measuredAt: at(2), sov: 0.5 }]),
      buildBeforeAfterRow(completion, []), // after 없음
    ];
    expect(presentableRows(rows)).toHaveLength(1);
  });

  test("경고가 있어도 숫자가 있으면 내놓는다 (경고째로 보여주는 게 정직하다)", () => {
    const rows = [
      buildBeforeAfterRow(completion, [{ measuredAt: at(2), sov: 0.5 }]),
    ];
    const shown = presentableRows(rows);
    expect(shown).toHaveLength(1);
    // 경고를 지우고 내보내면 안 된다.
    expect(shown[0]?.caveats.length).toBeGreaterThan(0);
  });
});
