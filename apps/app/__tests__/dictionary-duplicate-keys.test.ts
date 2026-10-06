import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 사전 JSON 의 **중복 키** 경보(2026-10-07).
 *
 * 🔴 왜: 두 브랜치가 같은 구역(`app.measuring`)을 각자 만들면 git 은 충돌 없이 둘 다 남긴다.
 *   JSON.parse 는 중복 키를 에러 없이 **뒤의 것으로 덮어** 앞 구역의 키가 조용히 사라진다
 *   (실제: 관제 「이어가기」 문구 `continuing` 이 영어화면 병합에서 사라질 뻔했다).
 *   import 로 읽는 다른 테스트는 이미 덮인 결과만 봐서 못 잡는다 → 원문 텍스트를 직접 검사한다.
 */
const DICT_DIR = join(
  import.meta.dirname,
  "../../../packages/internationalization/dictionaries"
);

function duplicateKeys(text: string): string[] {
  const dups: string[] = [];
  JSON.parse(text); // 문법부터 확인. 중복 키는 parse 가 못 본다 — 깊이별 스택으로 같은 객체 안의 키를 센다.
  const stack: Set<string>[] = [];
  const path: string[] = [];
  // 문자열 전체를 한 토큰으로 먹어야 값 속 `{n}` 같은 중괄호를 구조로 오인하지 않는다.
  const tokens = text.matchAll(/"((?:[^"\\]|\\.)*)"(\s*:)?|[{}[\]]/g);
  let pendingKey: string | null = null;
  for (const m of tokens) {
    const tok = m[0];
    if (tok === "{") {
      stack.push(new Set());
      path.push(pendingKey ?? "");
      pendingKey = null;
    } else if (tok === "}") {
      stack.pop();
      path.pop();
    } else if (tok === "[" || tok === "]") {
      pendingKey = null;
    } else if (m[2] === undefined) {
      // 키가 아닌 문자열 값
    } else {
      const key = m[1] ?? "";
      const seen = stack.at(-1);
      if (seen?.has(key)) {
        dups.push([...path.filter(Boolean), key].join("."));
      }
      seen?.add(key);
      pendingKey = key;
    }
  }
  return dups;
}

describe("사전 JSON 에 중복 키가 없다", () => {
  for (const locale of ["ko", "en"]) {
    it(`${locale}.json`, () => {
      const text = readFileSync(join(DICT_DIR, `${locale}.json`), "utf8");
      expect(duplicateKeys(text)).toEqual([]);
    });
  }

  it("검사기가 실제로 중복을 잡는다(음성 대조)", () => {
    expect(duplicateKeys('{"app":{"a":{"x":"1"},"a":{"y":"2"}}}')).toEqual([
      "app.a",
    ]);
    // 값 속 중괄호·콜론은 구조가 아니다
    expect(duplicateKeys('{"a":"{n}점: {x}","b":"}{","c":"ok"}')).toEqual([]);
  });
});
