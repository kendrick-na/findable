/**
 * 🔴 **왜 이 테스트가 있나** (세션N-39 · v4 §4-b 탭2)
 *
 * v4 가 *"현재 `null` 반환(`prompt-scoreboard.tsx:27-29`) → **빈 상태 신설 필요**"*
 * 라고 짚은 자리가 그대로 남아 있었다. `return null` 이면 섹션이 **통째로 사라져**
 * 사용자는 *"원래 없는 기능인가?"* 로 읽는다.
 *
 * 🔬 **실측(2026-08-17 · 진짜 DB Tracking 239행)**: 지금은 발생 **0건**
 *   (7/7 브랜드가 질문 보유 · `promptId` null 0행 · `prompt.text` 없음 0행).
 *   그런데도 만든 이유 = 이 표는 **최신 1회분만** 보는데(`dashboard-data.ts:661`)
 *   그 회차에 질문이 안 붙으면 전부 버려진다(`foldPromptScores`) —
 *   **N-36 의 「측정 성공·화면 정상·데이터만 증발」과 같은 형상**이다.
 *   그때 섹션이 조용히 사라져 3주간 아무도 못 봤다.
 *
 * ⚠️ 스크린샷으로 잡은 실수 1건도 여기서 지킨다: 처음엔 빈 상태 제목을
 *   「밀리는 질문」 `text-base` 로 썼는데 실제 화면은 「질문별 성적」 `text-lg` 였다
 *   → **같은 섹션이 상태에 따라 다른 이름으로 불렸다.**
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");
const FILE = join(
  ROOT,
  "apps/app/app/(authenticated)/components/prompt-scoreboard.tsx"
);
// 🔴 주석을 걷고 실행 코드만 남긴다. 안 걷으면 이 파일에서 실제로 뚫렸다 —
//   "제목이 「질문별 성적」이어야 한다" 를 설명하는 주석이 그 문구를 포함해서
//   등장 횟수가 2가 아니라 3이 됐다(= 가드가 자기 주석을 세고 오판).
//   📕 N-37 함정 4번과 같은 유형: 날조 금지 가드가 제 주석을 잡는다.
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
    // 🔴 JSX 주석 `{/* … */}` 이 **여러 줄**이면 블록 상태로 들어가야 한다.
    //   이걸 빠뜨려 첫 줄만 걷고 나머지가 코드로 남았다 = 가드가 제 주석을 셌다.
    if (t.startsWith("{/*")) {
      if (!t.includes("*/")) {
        inBlock = true;
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
    out.push(line);
  }
  return out.join("\n");
};

const code = stripToCode(readFileSync(FILE, "utf8"));

// 정규식은 최상위에(lint: useTopLevelRegex).
const RETURNS_NULL = /if \(scores\.length === 0\) \{\s*return null;/;
// 0건 분기 = `if (...) {` 부터 그 분기를 닫는 `\n  }` 까지.
// ⚠️ JSX 가 들어 있어 중간에 `  }` 처럼 보이는 줄이 없다는 보장이 없다 →
//   `);` 로 닫히는 return 문까지를 명시적으로 잡는다(느슨하게 잡으면 본문을 놓친다).
const EMPTY_BRANCH = /if \(scores\.length === 0\) \{[\s\S]*?\n {4}\);\n {2}\}/;
const HEADING = /질문별 성적/g;
// ⚠️ 화면 문구는 **줄바꿈으로 쪼개져 있다**(JSX 들여쓰기). 한 줄로 가정하면
//   문구가 멀쩡한데도 가드가 실패한다 → 공백/줄바꿈을 `\s+` 로 흡수한다.
const SAYS_WHY = /질문별로\s+나눠\s+볼\s+기록이\s+없어요/;
const SAYS_NEXT = /질문을\s+등록하고\s+다시\s*\n?\s*측정하면/;
const HEADING_SIZE = /text-lg/g;
const MISLEADS_MEASURE = /측정을 시작/;

describe("v4 탭2 — 질문별 성적 0건 상태", () => {
  // ── 가드 ①: 섹션이 사라지지 않는다(진짜 조준점) ────────────────
  it("🔴 0건에 return null 로 되돌아가지 않는다", () => {
    expect(
      code,
      "return null 로 되돌아갔다 — 섹션이 통째로 사라져 「원래 없는 기능」으로 읽힌다"
    ).not.toMatch(RETURNS_NULL);
  });

  // ── 가드 ②: 이유 + 다음 순서를 말한다 ─────────────────────────
  it("빈 화면이 아니라 이유와 다음 순서를 말한다", () => {
    const branch = code.match(EMPTY_BRANCH);
    expect(branch, "0건 분기를 못 찾았다").not.toBeNull();
    const body = branch?.[0] ?? "";
    // 이유가 없으면 사용자는 자기 잘못인지 버그인지 모른다.
    expect(body, "왜 비었는지 설명이 없다").toMatch(SAYS_WHY);
    // 다음 순서가 없으면 막다른 화면이 된다.
    expect(body, "다음에 뭘 할지 안 알려준다").toMatch(SAYS_NEXT);
  });

  // ── 가드 ③: 제목이 데이터 있을 때와 같다 ──────────────────────
  it("🔴 0건과 데이터 있을 때의 제목이 같다", () => {
    // 상태에 따라 이름이 갈리면 같은 섹션이 두 이름으로 불린다(NN/g 4).
    // 두 분기에 각각 하나씩 = 총 2회 등장해야 한다.
    expect(
      code.match(HEADING),
      "제목이 두 분기에서 갈렸다(「질문별 성적」 2회여야 한다)"
    ).toHaveLength(2);
    // 크기까지 같아야 한다 — 눈으로 보면 다른 섹션처럼 보인다.
    expect(code.match(HEADING_SIZE)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  // ── 가드 ④: 측정을 다시 하라고 하지 않는다 ────────────────────
  it("⚠️ 「측정하세요」로 오도하지 않는다", () => {
    const branch = code.match(EMPTY_BRANCH);
    // 이 카드가 보이는 시점엔 이미 측정이 있다(`hasData` 분기 안).
    // 원인은 **질문이 안 붙은 것**이지 측정을 안 한 게 아니다.
    expect(
      branch?.[0],
      "측정이 이미 있는데 「측정을 시작하세요」라고 하면 거짓 안내가 된다"
    ).not.toMatch(MISLEADS_MEASURE);
  });
});
