/*
 * 요금제 카드 배지(「현재」/「추천」) 판정 — 2026-08-12 세션N-26.
 *
 * 🔴 **막는 사고**: 예전 조건은 `isCurrent && !tier.featured` 였다.
 *   → **추천 플랜을 결제한 고객은 「현재」 배지를 영영 못 본다.**
 *   돈을 낸 사람이 자기 상태를 확인하지 못하는 건 요금제 화면에서 가장 나쁜 결함이다
 *   (하단 CTA 는 "이용 중" 이라 **화면 안에서 서로 다른 말을 하고 있었다**).
 *
 * ⚠️ 배지 슬롯은 **한 칸**이다 — 둘 다 켜지면 줄이 밀린다.
 *   그래서 "둘 다 안 켜짐"뿐 아니라 **"둘 다 켜짐"도 결함**으로 고정한다.
 *
 * ⚠️ 왜 정적 검사인가: `billing/page.tsx` 는 서버 컴포넌트라 렌더 테스트가 무겁고,
 *   판정이 JSX 조건에 인라인으로 박혀 있어 순수함수로 부를 수 없다.
 *   → 구조(조건식)로 고정한다. 🔴 존재 검사가 아니라 **조건의 형태**로 판정.
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const PAGE_PATH = join(
  import.meta.dirname,
  "../app/(authenticated)/billing/page.tsx"
);

const source = readFileSync(PAGE_PATH, "utf8");

/*
 * 주석 제거 — 주석 속 문구가 검사를 통과·실패시키지 않도록.
 * ⚠️ JSX 주석까지 지운다. 이걸 빠뜨렸다가 **고친 이유를 적은 설명 주석**이
 *   "옛 조건이 살아있다"로 잡혔다(가드가 제 몫을 한 것이지만, 판정 대상은
 *   어디까지나 **실행되는 코드**여야 한다).
 *
 * 🔴 **정규식으로 지우지 않는다** — 게으른 수량자로 블록주석을 지우면 앞쪽
 *   주석 시작과 **한참 뒤의** 주석 끝이 짝지어져 실제 코드가 통째로 사라진다.
 *   다른 파일에서 **40,570자**가 날아가 가드가 조용히 무력해진 적이 있다.
 *   → **줄 단위 상태 기계**로 센다.
 */
const code = ((): string => {
  const out: string[] = [];
  let inBlock = false;
  for (const line of source.split("\n")) {
    const t = line.trimStart();
    if (inBlock) {
      if (t.includes("*/")) {
        inBlock = false;
      }
      continue;
    }
    if (t.startsWith("//")) {
      continue;
    }
    if (t.startsWith("/*") || t.startsWith("{/*")) {
      if (!t.includes("*/")) {
        inBlock = true;
      }
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
})();

// biome: 정규식은 최상위 상수로.
/** 「현재」 배지가 `isCurrent` 하나로만 걸린다(featured 를 다시 안 따진다). */
const CURRENT_BADGE_UNCONDITIONAL = /\{isCurrent\s*&&\s*\(/;
/** 「추천」 배지는 현재 플랜이 아닐 때만. */
const FEATURED_BADGE_YIELDS = /\{tier\.featured\s*&&\s*!isCurrent\s*&&\s*\(/;
/** 🔴 되살아나면 안 되는 옛 조건. */
const OLD_BROKEN_CONDITION = /isCurrent\s*&&\s*!tier\.featured/;
/** 「추천」 배지 조건 전수 — `!isCurrent` 가 빠진 것이 있으면 배지가 겹친다. */
const FEATURED_BADGE_CONDITIONS = /\{tier\.featured\s*&&[^(]*/g;
/** 하단 CTA 가 현재 플랜을 가리는 삼항. */
const CTA_CURRENT_BRANCH = /isCurrent\s*\?\s*\(/;

describe("요금제 배지 — 「현재」가 「추천」보다 우선한다", () => {
  test("🔴 옛 조건 `isCurrent && !tier.featured` 가 되살아나지 않았다", () => {
    // 이게 있으면 추천 플랜 결제 고객이 「현재」를 못 본다.
    expect(code).not.toMatch(OLD_BROKEN_CONDITION);
  });

  test("「현재」 배지는 featured 여부와 무관하게 걸린다", () => {
    expect(code).toMatch(CURRENT_BADGE_UNCONDITIONAL);
  });

  test("「추천」 배지는 현재 플랜이면 자리를 양보한다(슬롯 1칸)", () => {
    expect(code).toMatch(FEATURED_BADGE_YIELDS);
  });

  test("🔴 두 배지가 동시에 켜질 수 있는 조건이 없다", () => {
    // `tier.featured &&` 로 시작하면서 `!isCurrent` 가 없는 배지 조건이 있으면
    // 현재이면서 추천인 플랜에서 배지가 두 개 렌더된다.
    const featuredBadgeConditions = code.match(FEATURED_BADGE_CONDITIONS) ?? [];
    expect(featuredBadgeConditions).toHaveLength(1);
    expect(featuredBadgeConditions[0]).toContain("!isCurrent");
  });

  test("하단 CTA 는 여전히 현재 플랜에 「이용 중」을 쓴다(배지와 같은 말)", () => {
    // 화면 안에서 두 곳이 서로 다른 말을 하면 안 된다.
    expect(code).toMatch(CTA_CURRENT_BRANCH);
    expect(source).toContain("이용 중");
  });
});
