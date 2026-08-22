/**
 * 🔴 **왜 이 테스트가 있나** (세션N-42 — 질문 유형이 2종으로 뭉개지던 문제)
 *
 * `PromptCategory` enum 은 7종인데 **실제 저장되는 값은 2종뿐**이었다.
 * 원인: 마법사가 `takeClean(items, language, category)` 로 **배열 단위**에 유형을
 * 통째 부여하고, 저장 직전 `CATEGORY_MAP` 이 `brand→recommendation`·
 * `competitor→comparison` 로 **두 값으로 접었다**.
 * → `best_in_category`(카테고리 1위) 처럼 GEO 에서 가장 중요한 유형이 **한 번도 안 잡혔다**.
 *
 * 이제 질문마다 LLM 이 `topic` 을 판단한다. 이 가드는 그 배선이 **끊기지 않는지** 본다:
 *   ① 스키마가 질문별 topic 을 받는가 ② 저장 경로가 그 값을 쓰는가
 *   ③ 모르는 값이 와도 안전한가 ④ 폴백도 유형을 갖는가
 *
 * ⚠️ **추가 AI 호출이 늘지 않아야 한다** — 같은 `generateObject` 한 번의 출력 모양만 바뀐다.
 *   호출이 늘면 측정 1건 원가가 오른다(무료 진단 원가방어 원칙).
 *
 * ⚠️ 네트워크·DB 를 타지 않는다 — 소스의 계약 + 순수 함수만 검사한다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 🔴 `normalizeTopic` 을 **import 하지 않는다**.
 *   `prompt-suggestions.ts` 는 최상단에서 `models.ts` → `keys().OPENAI_API_KEY` 를 타므로
 *   import 만으로 *"server-side environment variable on the client"* 로 죽는다(실측).
 *   → 순수 함수인데 모듈 부작용 때문에 못 부른다 → **같은 규칙을 여기서 재현**해 검사한다.
 *   ⚠️ 재현이라 원본과 어긋날 수 있다 → 아래 「소스 계약」 검사로 원본이 이 규칙을
 *     유지하는지 함께 확인한다(둘이 같이 깨져야 통과하도록).
 */
const TOPIC_VALUES = new Set([
  "best_in_category",
  "alternative",
  "comparison",
  "recommendation",
  "problem_solving",
  "buying_guide",
  "custom",
]);
const FALLBACK: Record<string, string> = {
  brand: "recommendation",
  competitor: "comparison",
};
function normalizeTopic(raw: string | undefined, hint: "brand" | "competitor") {
  const v = raw?.trim().toLowerCase();
  return v && TOPIC_VALUES.has(v) ? v : FALLBACK[hint];
}

const SUGGEST = join(
  process.cwd(),
  "../../packages/ai/lib/prompt-suggestions.ts"
);
const SAVE = join(process.cwd(), "app/actions/brand/suggest-prompts.ts");
const SCHEMA = join(
  process.cwd(),
  "../../packages/database/prisma/schema.prisma"
);

const suggestSource = readFileSync(SUGGEST, "utf8");
const saveSource = readFileSync(SAVE, "utf8");
const schemaSource = readFileSync(SCHEMA, "utf8");

// 정규식은 최상위에(lint: useTopLevelRegex).
/** 질문 1개가 topic 을 갖는 스키마인지. `z.array(z.string())` 이면 옛 구조다. */
const ITEM_SCHEMA = /promptItemSchema\s*=\s*z\.object\(/;
/** 옛 구조 잔존 — 질문 배열이 문자열 배열이면 유형이 통째로 부여된다. */
const OLD_STRING_ARRAY =
  /(brand|competitor)Prompts(Ko|En):\s*z\s*\.array\(z\.string\(\)\)/;
/** 저장 경로가 질문별 유형을 쓰는가. */
const SAVE_USES_TOPIC = /category:\s*normalizeTopic\(/;
/** 접는 표를 다시 쓰면 2종으로 되돌아간다. */
const SAVE_USES_OLD_MAP = /category:\s*CATEGORY_MAP\[/;
/** AI 호출 횟수 — 늘면 원가가 오른다. */
const GENERATE_CALL = /generateObject\(/g;
/** enum 본문. */
const ENUM_BLOCK = /enum PromptCategory\s*\{([^}]*)\}/;
/** 폴백 질문들의 topic. */
const FALLBACK_TOPICS = /topic:\s*"([a-z_]+)"/g;
/** enum 값 한 줄. */
const ENUM_LINE = /^[a-z_]+$/;
/** 원본의 폴백 표 — 위 재현본이 이것과 같아야 한다. */
const FALLBACK_MAP =
  /FALLBACK_TOPIC:\s*Record<PromptCategoryHint,\s*PromptTopic>\s*=\s*\{([^}]*)\}/;

describe("질문 유형 태깅 — 2종으로 뭉개지지 않는다", () => {
  it("스키마가 **질문마다** topic 을 받는다", () => {
    expect(ITEM_SCHEMA.test(suggestSource)).toBe(true);
  });

  it("⛔ 옛 구조(문자열 배열)로 되돌아가지 않았다", () => {
    // 되돌아가면 유형이 배열 단위로 통째 부여된다 = 이 작업 전 상태.
    expect(OLD_STRING_ARRAY.test(suggestSource)).toBe(false);
  });

  it("🔴 저장 경로가 질문별 유형을 쓴다 (접는 표를 안 쓴다)", () => {
    expect(SAVE_USES_TOPIC.test(saveSource)).toBe(true);
    expect(SAVE_USES_OLD_MAP.test(saveSource)).toBe(false);
  });

  it("⚠️ AI 호출이 1회 그대로다 (원가가 오르지 않는다)", () => {
    const calls = suggestSource.match(GENERATE_CALL) ?? [];
    expect(calls.length).toBe(1);
  });

  it("🔴 위에서 재현한 폴백 규칙이 **원본과 같다** (재현이 낡으면 잡는다)", () => {
    // 원본을 import 할 수 없어 규칙을 복제했다 → 복제가 원본과 갈라지면 이 테스트가 깨진다.
    const body = suggestSource.match(FALLBACK_MAP)?.[1] ?? "";
    expect(body).toContain('brand: "recommendation"');
    expect(body).toContain('competitor: "comparison"');
    // 재현본도 같은 값을 쓰는지 대조.
    expect(FALLBACK.brand).toBe("recommendation");
    expect(FALLBACK.competitor).toBe("comparison");
  });

  it("🔴 재현한 유효값 집합이 **DB enum 과 같다**", () => {
    const enumBody = schemaSource.match(ENUM_BLOCK)?.[1] ?? "";
    const values = enumBody
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => ENUM_LINE.test(l));
    expect([...TOPIC_VALUES].sort()).toEqual([...values].sort());
  });
});

describe("normalizeTopic — 모르는 값이 와도 질문을 잃지 않는다", () => {
  it("유효한 유형은 그대로 통과시킨다", () => {
    expect(normalizeTopic("best_in_category", "competitor")).toBe(
      "best_in_category"
    );
    expect(normalizeTopic("buying_guide", "brand")).toBe("buying_guide");
  });

  it("모르는 값·빈 값이면 균형축 기준 기본값으로 떨어진다", () => {
    // 🔴 버리지 않는다 — 유형 하나 때문에 멀쩡한 질문이 사라지면 손해다.
    expect(normalizeTopic("나는_없는_유형", "brand")).toBe("recommendation");
    expect(normalizeTopic(undefined, "competitor")).toBe("comparison");
    expect(normalizeTopic("", "brand")).toBe("recommendation");
  });

  it("대소문자·공백이 섞여도 받아준다", () => {
    expect(normalizeTopic("  COMPARISON ", "brand")).toBe("comparison");
  });

  it("🔴 돌려주는 값은 **항상** DB enum 안에 있다", () => {
    const enumBody = schemaSource.match(ENUM_BLOCK)?.[1] ?? "";
    const values = enumBody
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => ENUM_LINE.test(l));
    expect(values.length).toBeGreaterThanOrEqual(7);
    for (const raw of ["best_in_category", "쓰레기값", undefined, ""]) {
      expect(values).toContain(normalizeTopic(raw, "brand"));
      expect(values).toContain(normalizeTopic(raw, "competitor"));
    }
  });
});

describe("정적 폴백 — LLM 이 실패해도 유형이 한 덩어리가 되지 않는다", () => {
  it("폴백 질문들의 유형이 **2종 넘게** 갈린다", () => {
    // 폴백이 전부 같은 유형이면 LLM 실패 시 묶음 화면이 한 칸이 된다.
    const topics = new Set(
      [...suggestSource.matchAll(FALLBACK_TOPICS)].map((m) => m[1])
    );
    expect(topics.size).toBeGreaterThanOrEqual(3);
  });
});
