/**
 * 🔴 **왜 이 테스트가 있나** (세션N-40 — 모집단 명시)
 *
 * 히어로 3장이 `18%`·`5개 중 2번째` 같은 값을 보여주는데, **무엇을 분모로 한 값인지**
 * 화면에 없었다. 경쟁사 프레임 47장 실측: 모집단을 그 자리에 적는 곳은
 * Otterly(`Report based on 25 prompts`)·Scrunch(`20/500`) **2곳**이고 **우리만 없었다**.
 *
 * 이 줄은 눈에 잘 안 띄는 회색 한 줄이라 리팩터 중 **조용히 사라지기 쉽다**.
 * 사라지면 화면은 멀쩡해 보이는데 숫자의 근거만 없어진다 → 가드로 잡는다.
 *
 * ⚠️ 네트워크·DB 를 타지 않는다 — 소스의 계약만 검사한다.
 *   📕 규율: 가드는 문구가 아니라 계약을 검사한다(reference_findable_traps §1).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { METRICS } from "@repo/audit/metric-dictionary";
import { describe, expect, it } from "vitest";

const KPIS = join(
  process.cwd(),
  "app/(authenticated)/components/dashboard-kpis.tsx"
);

/**
 * 주석을 걷고 **실행되는 코드만** 남긴다.
 *
 * 🔴 이 저장소는 가드가 **자기 주석을 세어** 오판한 사고를 6번 겪었다
 *   (N-36 = 줄끝 주석 · N-39 = JSX `{/* *\/}` 여러 줄).
 *   그래서 세 형태를 **전부** 걷는다: ① 줄끝 `//` ② `*` 로 시작하는 블록 본문
 *   ③ JSX `{/* ... *\/}`(여러 줄 포함).
 *   ⚠️ 문자열 리터럴 안의 `//` 는 보존한다(URL 이 잘리면 계약 검사가 망가진다).
 */
function stripToCode(source: string): string {
  // ③ JSX 주석 블록을 먼저 통째로 제거(여러 줄 대응).
  // 🔴 2026-08-18(N-41): `\{\s*\/\*`(중괄호와 `/*` 사이 공백 허용)는 **과잉 삭제**한다 —
  //   템플릿 리터럴의 `${...}` 중괄호에서 시작해 뒤쪽 `*/` 까지 삼킨다.
  //   실측으로 다른 파일에서 멀쩡한 코드 2건이 사라져 오판을 냈다(이 파일은 해당 패턴이
  //   없어 결과가 같았지만, 같은 헬퍼가 번지지 않게 여기서도 엄격 패턴으로 고친다).
  const withoutJsx = source.replaceAll(/\{\/\*[\s\S]*?\*\/\}/g, "");
  return withoutJsx
    .split("\n")
    .map((line) => {
      let inSingle = false;
      let inDouble = false;
      let inTick = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (line[i - 1] === "\\") {
          continue;
        }
        if (c === "'" && !(inDouble || inTick)) {
          inSingle = !inSingle;
        } else if (c === '"' && !(inSingle || inTick)) {
          inDouble = !inDouble;
        } else if (c === "`" && !(inSingle || inDouble)) {
          inTick = !inTick;
        } else if (
          c === "/" &&
          line[i + 1] === "/" &&
          !(inSingle || inDouble || inTick)
        ) {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .filter((line) => !line.trimStart().startsWith("*"))
    .join("\n");
}

const kpisCode = stripToCode(readFileSync(KPIS, "utf8"));

// 정규식은 최상위에(lint: useTopLevelRegex).
/** 질문 수 모집단 표기. 값은 `promptScores.length`(최신 1회분 실측치)여야 한다. */
const POPULATION_PROMPTS = /질문 \$\{promptScores\.length\}개 기준/;
/** 0건일 때 표기를 생략하는 가드(빈 원장에 "질문 0개 기준"을 쓰지 않는다). */
const POPULATION_ZERO_GUARD = /promptScores\.length > 0\s*\?/;
/** 엔진 수 모집단 — 이미 있던 표기. 같이 사라지지 않게 함께 잠근다. */
const POPULATION_ENGINES = /측정한 AI \$\{coverage\.total\}곳/;
/** 상수로 박은 질문 수(날조). 실측치 보간이 아니면 이 패턴에 걸린다. */
const POPULATION_HARDCODED = /질문 \d+개 기준/;

describe("대시보드 — 숫자의 모집단을 그 자리에 밝힌다", () => {
  it("질문 수를 실측치(promptScores.length)로 표기한다", () => {
    expect(
      kpisCode,
      "모집단 표기가 사라졌다 — 히어로 숫자의 분모를 알 수 없게 된다"
    ).toMatch(POPULATION_PROMPTS);
  });

  it("🔴 질문 0건이면 표기를 생략한다", () => {
    // AuditJob 폴백 경로는 프롬프트 원장이 없어 promptScores 가 **빈 배열**이다.
    // 그때 "질문 0개 기준"은 *측정이 없다*는 뜻이 아니라 *원장이 없다*는 뜻이라
    // 고객에게 거짓으로 읽힌다 → 조건부 렌더가 계약이다.
    expect(
      kpisCode,
      "0건 생략 가드가 없다 — 빈 원장에 「질문 0개 기준」이 찍힌다"
    ).toMatch(POPULATION_ZERO_GUARD);
  });

  it("엔진 수 모집단도 함께 유지된다", () => {
    expect(kpisCode, "엔진 모집단 표기가 사라졌다").toMatch(POPULATION_ENGINES);
  });

  it("🔴 숫자를 하드코딩하지 않는다(날조 방지)", () => {
    // 📕 feedback_no_fabricated_facts — 모집단은 **실측치 보간**이어야 한다.
    //   `질문 5개 기준` 처럼 상수로 박으면 브랜드마다 다른 실제 질문 수를 덮어쓴다.
    expect(
      kpisCode,
      "모집단에 상수가 박혔다 — 실측치(promptScores.length)를 써야 한다"
    ).not.toMatch(POPULATION_HARDCODED);
  });
});

// ─────────────────────────────────────────────────────────────
// 측정 횟수 ↔ 카드 값 정합성 (세션N-43)
// ─────────────────────────────────────────────────────────────

/**
 * 🔴 **왜 이 테스트가 있나** — 한 화면이 서로 다른 말을 하고 있었다.
 *
 * 스크린샷(N-43 `값없음` 스토리): 카드 3장은 *"측정하면 AI가 우리를 아는지 보여드려요"*
 * (= 측정 전 문구)인데 바로 아래 줄은 **"측정 34회 · 2일 전"** 이었다.
 *
 * 원인은 **두 값이 다른 경로에서 온다**는 것이다:
 *   · `totalCount` = `jobs.length` — **전체 job 수**(실패·대기 포함)
 *   · 카드 값(`latestSov` 등) = *completed* + *sov 있음* + *브랜드명 일치* 를 다 통과해야 생긴다
 * → 측정이 전부 실패했거나 브랜드명 추출이 빗나가면 이 모순이 그대로 고객 화면에 나온다.
 *
 * 규율: **횟수를 숨기지 않는다**(돌린 건 사실이다). 대신 **값이 없다는 사실을 그 자리에서
 * 말한다** — 못 잰 것을 좋은 소식으로 팔지 않는 것과 같은 방향이다.
 */

/** 판정식을 소스에서 뽑는다 — 문구가 아니라 **동작**을 검사한다. */
const NO_RESULT_DECISION = /const hasNoUsableResult\s*=\s*([^;]+);/;
/** 그 판정을 실제로 렌더에 쓰는지(정의만 하고 안 쓰면 화면은 그대로다). */
const NO_RESULT_RENDERED = /hasNoUsableResult\s*\?/;

describe("대시보드 — 「측정 N회」와 카드가 다른 말을 하지 않는다", () => {
  it("판정식이 있고 렌더에 실제로 쓰인다", () => {
    expect(kpisCode, "판정식이 없다").toMatch(NO_RESULT_DECISION);
    expect(
      kpisCode,
      "판정만 만들고 렌더에 쓰지 않았다 — 화면은 그대로 모순이다"
    ).toMatch(NO_RESULT_RENDERED);
  });

  /** 소스의 판정식을 **그대로 실행**한다(문구 하드코딩 회피). */
  const decide = (state: {
    averageMentionPosition?: number | null;
    coverage?: unknown;
    latestSov?: number | null;
    sentiment?: unknown;
    totalCount: number;
  }) => {
    const expr = NO_RESULT_DECISION.exec(kpisCode)?.[1];
    if (!expr) {
      throw new Error("판정식을 소스에서 찾지 못했다");
    }
    const full = {
      averageMentionPosition: null,
      coverage: null,
      latestSov: null,
      sentiment: null,
      ...state,
    };
    const fn = `(({ totalCount, coverage, latestSov, averageMentionPosition, sentiment }) => (${expr}))`;
    // biome-ignore lint/security/noGlobalEval: 소스의 판정식을 실행해야 문구 하드코딩을 피할 수 있다.
    return eval(fn)(full) as boolean;
  };

  it("🔴 측정 기록은 있는데 값이 전부 없으면 **말해준다**", () => {
    expect(decide({ totalCount: 34 })).toBe(true);
  });

  it("🔴 측정 0회(신규 조직)엔 말하지 않는다 — 「읽지 못했다」가 거짓말이 된다", () => {
    expect(decide({ totalCount: 0 })).toBe(false);
  });

  it("값이 하나라도 있으면 말하지 않는다", () => {
    expect(decide({ latestSov: 62, totalCount: 34 })).toBe(false);
    // 감성만 있는 경우도 볼 게 있는 것이다.
    expect(
      decide({
        sentiment: { negative: 0, neutral: 29, positive: 5, total: 34 },
        totalCount: 34,
      })
    ).toBe(false);
    // 순위만 있는 경우도 마찬가지.
    expect(decide({ averageMentionPosition: 2.3, totalCount: 34 })).toBe(false);
  });

  /*
   * 🔴 **이 문구가 새 모순을 만들지 않는지** 확인한다.
   *   `coverage` 는 `completed[0]` 에서 바로 나오지만 `latestSov` 는 브랜드명 일치까지
   *   통과해야 한다 → 브랜드명 없는 구 job 이 최신이면 `latestSov` 만 null 이 된다.
   *   그때 문구가 붙으면 **"7곳에서 등장 · 볼 수 있는 결과가 없어요"** 가 되어
   *   내가 고치려던 것과 같은 자기모순이다.
   */
  it("🔴 등장 정보(coverage)가 있으면 말하지 않는다 — 새 모순 방지", () => {
    expect(
      decide({ coverage: { mentioned: 5, total: 7 }, totalCount: 34 })
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// 지표 뜻풀이 (세션N-41)
// ─────────────────────────────────────────────────────────────

/**
 * 사전의 `description` 을 **화면이 실제로 읽는지** 잠근다.
 *
 * 🔴 **왜**: `metric-dictionary.ts` 는 지표 5종의 평문 정의를 갖고 있었는데
 *   **어느 화면도 렌더하지 않았다**(N-41 실측 grep 0건). 사전은 스스로
 *   "읽는 코드 없는 필드를 만들지 않는다"고 선언하는데 정작 `description` 이 그랬다.
 *   다시 끊어지면 사전만 남고 고객은 못 읽는 상태로 조용히 돌아간다.
 *
 * ⚠️ **문구를 하드코딩하지 않는다** — 정의 문장을 여기 베끼면 사전을 고칠 때
 *   테스트가 깨지고(= 가드가 버그의 호위병), 문구 2벌 사고를 반복한다.
 *   검사하는 것은 **연결 계약**이다: `description` 을 읽고, 5종 전부를 덮는가.
 */
/** 사전의 평문 정의를 화면이 읽는가. */
const GLOSSARY_READS_DESCRIPTION = /METRICS\[\w+\]\.description/;
/** 뜻풀이가 `<details>` 네이티브인가(터치·키보드·스크린리더 무료 확보). */
const GLOSSARY_NATIVE_DETAILS = /<details/;
/** 방향 표식도 사전에서 가져오는가(화면이 직접 "낮을수록 좋음"을 쓰지 않는다). */
const GLOSSARY_USES_DIRECTION_HINT = /directionHint\(key\)/;
/** 정의 문장을 화면에 복제했는가 — 사전 문장의 특징적 조각이 소스에 있으면 위반. */
const GLOSSARY_DUPLICATED_TEXT = /답변 본문에 이름만 나오는/;
/** 뜻풀이가 덮는 지표 목록(배열 리터럴)을 뽑아낸다. */
const GLOSSARY_KEYS_BLOCK = /GLOSSARY_KEYS = \[([\s\S]*?)\]/;
/** 목록 안의 문자열 키. */
const QUOTED_KEY = /"(\w+)"/g;

describe("대시보드 — 지표 뜻풀이가 사전에 연결돼 있다", () => {
  it("🔴 사전의 평문 정의(description)를 화면이 읽는다", () => {
    expect(
      kpisCode,
      "description 을 읽는 코드가 없다 — 사전만 있고 고객은 못 읽는 상태로 돌아갔다"
    ).toMatch(GLOSSARY_READS_DESCRIPTION);
  });

  it("🔴 사전의 지표 5종을 빠짐없이 덮는다", () => {
    // 사전에 키가 늘면 뜻풀이도 같이 늘어야 한다. 한 개라도 빠지면
    // "사전엔 있는데 화면엔 없는" 구멍이 다시 생긴다.
    const listed = kpisCode.match(GLOSSARY_KEYS_BLOCK)?.[1] ?? "";
    const keys = [...listed.matchAll(QUOTED_KEY)].map((m) => m[1]);
    // 사전이 단일 진실 — 기대 목록을 여기 박지 않고 사전에서 읽는다.
    const dictKeys = Object.keys(METRICS);
    expect(
      [...keys].sort(),
      `뜻풀이가 사전 지표를 다 덮지 않는다 (사전 ${dictKeys.length}종 / 화면 ${keys.length}종)`
    ).toEqual([...dictKeys].sort());
  });

  it("툴팁이 아니라 네이티브 <details> 로 펼친다", () => {
    // 카드 2장이 <Link> 라 툴팁 트리거를 넣으면 중첩 인터랙티브가 된다.
    // 게다가 툴팁은 터치에 없다 — 모바일이 정작 화면이 가장 긴 곳이다.
    expect(
      kpisCode,
      "<details> 가 아니다 — 터치·키보드 접근성이 깨진다"
    ).toMatch(GLOSSARY_NATIVE_DETAILS);
  });

  it("방향 표식도 사전이 단독으로 정한다", () => {
    expect(
      kpisCode,
      "화면이 방향을 직접 판단하고 있다 — 사전과 갈라질 수 있다"
    ).toMatch(GLOSSARY_USES_DIRECTION_HINT);
  });

  it("🔴 정의 문장을 화면에 복제하지 않는다(같은 값 2벌 금지)", () => {
    expect(
      kpisCode,
      "사전 문장이 화면에 복제됐다 — 사전을 고쳐도 화면이 안 따라온다"
    ).not.toMatch(GLOSSARY_DUPLICATED_TEXT);
  });
});
