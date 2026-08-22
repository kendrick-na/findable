/**
 * 🔴 **왜 이 테스트가 있나** (세션N-42 — 배지에 영어 원문이 새어 나오던 버그)
 *
 * `/prompts` 목록의 유형 배지가 **한 번도 맞은 적이 없었다**.
 * 라벨맵 키가 `brand`·`competitor`·`category` 였는데 **DB 에 그 값이 저장되는 경로가 없다**:
 *   마법사 힌트(`brand`/`competitor`) → `CATEGORY_MAP`(suggest-prompts.ts) → **enum 으로 변환**
 *   (`brand→recommendation` · `competitor→comparison`) → 그 값이 DB 에 들어간다.
 * 화면은 `?? prompt.category` 폴백이 있어 **깨지지 않고 조용히** 영어를 보여줬다.
 *
 * 🔴 조용한 결함이라 사람이 눈으로 봐도 "원래 저런가 보다" 하고 넘어간다 → 가드로 잡는다.
 *
 * ⭐ **enum 을 직접 읽어 대조한다**(내가 손으로 적은 목록과 비교하지 않는다).
 *   스키마에 값이 추가되면 이 테스트가 **먼저 깨져서** 라벨 누락을 알려준다.
 *   (= 다음 사람이 같은 실수를 반복할 수 없게 만드는 것이 이 가드의 목적)
 *
 * ⚠️ 네트워크·DB 를 타지 않는다 — 스키마 파일과 소스의 계약만 검사한다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LIST = join(process.cwd(), "app/(authenticated)/prompts/prompt-list.tsx");
const SAVE = join(process.cwd(), "app/actions/brand/suggest-prompts.ts");
const SCHEMA = join(
  process.cwd(),
  "../../packages/database/prisma/schema.prisma"
);

const SUGGEST = join(
  process.cwd(),
  "../../packages/ai/lib/prompt-suggestions.ts"
);

const listSource = readFileSync(LIST, "utf8");
const saveSource = readFileSync(SAVE, "utf8");
const schemaSource = readFileSync(SCHEMA, "utf8");
const suggestSource = readFileSync(SUGGEST, "utf8");

// 정규식은 최상위에(lint: useTopLevelRegex).
/** `enum PromptCategory { ... }` 본문. 스키마가 **단일 진실**이다. */
const ENUM_BLOCK = /enum PromptCategory\s*\{([^}]*)\}/;
/** 라벨맵 본문 — 여기 적힌 키가 enum 을 전부 덮어야 한다. */
const LABEL_BLOCK =
  /const CATEGORY_LABEL: Record<string, string> = \{([^}]*)\}/;
/** 저장 경로가 질문별 유형을 쓰는가(N-42 이후의 진실). */
const SAVE_USES_NORMALIZE = /category:\s*normalizeTopic\(/;
/** LLM 이 유형을 못 줬을 때의 기본값 표 — 이 값도 화면이 알아야 한다. */
const FALLBACK_MAP =
  /FALLBACK_TOPIC:\s*Record<PromptCategoryHint,\s*PromptTopic>\s*=\s*\{([^}]*)\}/;
/** `  key:` 에서 키만. */
const KEY_LINE = /^([a-z_]+)\s*:/;
/** enum 값 한 줄(소문자·밑줄만). */
const ENUM_LINE = /^[a-z_]+$/;
/** 변환표 우변의 문자열 값. */
const MAP_VALUE = /:\s*"([a-z_]+)"/g;

/** `  key: value,` 꼴에서 키만 뽑는다(주석 줄은 버린다). */
function keysOf(block: string): string[] {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("*"))
    .map((l) => l.match(KEY_LINE)?.[1])
    .filter((k): k is string => Boolean(k));
}

/** enum 본문에서 값만 뽑는다. */
function enumValues(block: string): string[] {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .filter((l) => ENUM_LINE.test(l));
}

describe("질문 유형 배지 — DB enum 과 라벨이 어긋나지 않는다", () => {
  const enumBody = schemaSource.match(ENUM_BLOCK)?.[1] ?? "";
  const labelBody = listSource.match(LABEL_BLOCK)?.[1] ?? "";
  const values = enumValues(enumBody);
  const labels = keysOf(labelBody);

  it("스키마에서 enum 을 실제로 읽어온다 (테스트가 헛돌지 않는다)", () => {
    // 이 단언이 없으면 정규식이 빗나갔을 때 빈 배열끼리 비교해 **항상 통과**한다.
    expect(values.length).toBeGreaterThanOrEqual(7);
    expect(values).toContain("comparison");
    expect(values).toContain("recommendation");
  });

  it("🔴 enum 값을 **전부** 한글 라벨로 덮는다 (하나라도 빠지면 영어가 샌다)", () => {
    const missing = values.filter((v) => !labels.includes(v));
    expect(missing).toEqual([]);
  });

  it("⛔ 저장되지 않는 값을 라벨에 두지 않는다 (죽은 키 = 다음 사람의 오해)", () => {
    const ghosts = labels.filter((l) => !values.includes(l));
    expect(ghosts).toEqual([]);
  });

  it("🔴 실제로 저장되는 값을 화면이 안다", () => {
    // 이 버그의 진원지 — 화면이 마법사 힌트(`brand`)를 읽고 있었는데
    //   저장되는 건 변환된 enum 이었다.
    // ⚠️ N-42 후속: 저장 경로가 `CATEGORY_MAP` → `normalizeTopic` 으로 **옮겨갔다**.
    //   가드를 지우지 않고 **옮겨간 진실을 따라간다**(의도는 그대로: 화면이 실제
    //   저장값을 안다). 📕 규율 = 리팩터로 가드가 깨지면 패턴만 갱신한다(N-39 함정 5).
    expect(SAVE_USES_NORMALIZE.test(saveSource)).toBe(true);
    // `normalizeTopic` 의 폴백 기본값도 화면이 알아야 한다(LLM 실패 시 이 값이 저장된다).
    const fallbackBody = suggestSource.match(FALLBACK_MAP)?.[1] ?? "";
    const stored = [...fallbackBody.matchAll(MAP_VALUE)].map((m) => m[1]);
    expect(stored.length).toBeGreaterThan(0);
    for (const value of stored) {
      expect(labels).toContain(value);
    }
  });
});
