/**
 * 🔴 **왜 이 테스트가 있나** (세션N-42 — 질문 목록 유형별 묶음)
 *
 * 경쟁사 3/4(Profound·Peec·Scrunch)이 `Topics` 를 최상위로 갖는다. 우리는 질문 24개가
 * **평면 목록**이라 "어느 유형에 몰려 있는지"를 볼 수 없었다.
 *
 * ⛔ 단, **1칸이면 묶지 않는다**. 아코디언 한 칸은 장식이고 무료 플랜은 질문이 5개다.
 *   (N-41 이 탭 6등분을 기각한 것과 같은 판단 — 쪼개서 빈 칸을 만들지 않는다.)
 *   이 분기가 사라지면 무료 고객 화면에 한 칸짜리 묶음이 생긴다 → 가드로 잡는다.
 *
 * 🔴🔴 **이 테스트가 버그를 지키고 있었다**(N-43). 가드가 기대값에 `groups.length <= 1` 이라는
 *   **문구를 하드코딩**해서, 그 조건이 **틀렸다는 사실**은 검사하지 못했다.
 *   `groups.length` 는 **묶음 개수**인데 의도는 **각 묶음의 칸 수**였다 → 유형이 다 달라
 *   1칸짜리 묶음 5개가 그려졌고, 테스트는 통과했다(스크린샷으로 발견).
 *   → 이제 **문구가 아니라 판정 로직**을 검사한다: 소스에서 조건식을 뽑아 **실제로 실행**해
 *     "전부 1칸" 입력에서 묶지 않는지 본다. 문구를 바꿔도 동작이 맞으면 통과해야 한다.
 *
 * ⚠️ 렌더링하지 않는다 — 소스의 계약만 검사한다(`PromptList` 는 클라이언트 컴포넌트라
 *   import 하면 `next/navigation` 등이 딸려온다).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LIST = join(process.cwd(), "app/(authenticated)/prompts/prompt-list.tsx");
const source = readFileSync(LIST, "utf8");

// 정규식은 최상위에(lint: useTopLevelRegex).
/**
 * 🔴 묶을지 말지를 정하는 **판정식**을 소스에서 뽑는다.
 *   문구(`groups.length <= 1`)를 그대로 기대하지 않는다 — 그게 바로 버그를 통과시킨 방식이다.
 *   `groups` 를 받아 boolean 을 내는 식이면 무엇이든 받아서 **실행해 본다**.
 */
const CLUSTER_DECISION = /const hasCluster\s*=\s*([^;]+);/;
/** 평면 목록으로 떨어지는 이른 반환이 있는가(판정식을 실제로 쓰는지). */
const FLAT_EARLY_RETURN = /if\s*\(\s*!hasCluster\s*\)/;
/** 묶음 함수 존재. */
const GROUP_FN = /function groupByTopic\(/;
/** 순서표 — 없으면 Map 삽입순(=DB 정렬순)이라 중요도가 안 드러난다. */
const ORDER_TABLE = /const TOPIC_ORDER = \[([^\]]*)\]/;
/** 유형 없는 질문을 담는 칸. */
const UNTAGGED_BUCKET = /const UNTAGGED = /;
/** 묶음 제목에 개수를 함께 적는가(모집단 명시). */
const COUNT_IN_HEADING = /group\.items\.length/;

describe("질문 유형 묶음 — 경쟁사 Topics 대응", () => {
  it("유형별로 묶는 함수가 있다", () => {
    expect(GROUP_FN.test(source)).toBe(true);
  });

  it("판정식과 평면 목록 이른 반환이 있다", () => {
    expect(CLUSTER_DECISION.test(source)).toBe(true);
    expect(FLAT_EARLY_RETURN.test(source)).toBe(true);
  });

  /*
   * 🔴 여기서 **소스의 판정식을 실제로 실행**한다. 문구 대조가 아니라 동작 검사다.
   *   `hasCluster === false` → 평면 목록으로 떨어진다는 뜻.
   */
  const decide = (groups: Array<{ items: unknown[] }>) => {
    const expr = CLUSTER_DECISION.exec(source)?.[1];
    if (!expr) {
      throw new Error("판정식을 소스에서 찾지 못했다");
    }
    // biome-ignore lint/security/noGlobalEval: 소스의 판정식을 그대로 실행해야 문구 하드코딩을 피할 수 있다.
    return eval(`((groups) => (${expr}))`)(groups) as boolean;
  };

  it("🔴 유형이 다 달라 **전부 1칸**이면 묶지 않는다 (N-43 이 놓친 경우)", () => {
    const allSingles = [{ items: [1] }, { items: [1] }, { items: [1] }];
    expect(decide(allSingles)).toBe(false);
  });

  it("🔴 한 유형만 있어도 (묶음 1개) 묶지 않는다", () => {
    expect(decide([{ items: [1, 2] }])).toBe(false);
  });

  it("2칸 이상인 묶음이 있으면 **묶는다**", () => {
    expect(decide([{ items: [1, 2] }, { items: [1] }])).toBe(true);
  });

  it("묶음 제목에 개수를 함께 적는다 (모집단 명시)", () => {
    expect(COUNT_IN_HEADING.test(source)).toBe(true);
  });

  it("유형 없는 질문도 잃지 않는다 (전용 칸이 있다)", () => {
    // 과거 데이터·러너 폴백은 category 가 null 이다. 버리면 목록에서 사라진다.
    expect(UNTAGGED_BUCKET.test(source)).toBe(true);
  });

  it("🔴 순서표가 **GEO 중요도순**이다 (경쟁 구도 질문이 위)", () => {
    const body = ORDER_TABLE.exec(source)?.[1] ?? "";
    const order = [...body.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(order.length).toBeGreaterThanOrEqual(7);
    // 경쟁 구도(1위·비교·대안)가 브랜드 자체(추천·구매가이드)보다 앞.
    expect(order.indexOf("best_in_category")).toBeLessThan(
      order.indexOf("recommendation")
    );
    expect(order.indexOf("comparison")).toBeLessThan(
      order.indexOf("buying_guide")
    );
  });

  it("순서표에 없는 값이 와도 **뒤에 붙는다** (enum 이 늘어도 질문을 안 잃는다)", () => {
    // indexOf === -1 을 큰 수로 치환하는 처리가 있어야 한다. 없으면 -1 이 맨 앞으로 간다.
    expect(source).toContain("=== -1 ? 99");
  });
});
