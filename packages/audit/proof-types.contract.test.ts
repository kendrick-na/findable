import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type EvidenceEnvelope,
  type Known,
  MCP_READONLY_TOOL_NAMES,
  type McpReadonlyResponse,
  NOT_COMPARABLE_REASONS,
  PROOF_LANGUAGES,
  UNAVAILABLE_REASONS,
  type UnavailableReason,
} from "./proof-types";

// K0 계약 시험: 타입만 있는 파일이라는 규칙(함수·class·enum·any·비-type import 0개)과
// 컴파일 타임 모양을 확인한다. 로직 시험이 아니다.
const source = readFileSync(
  join(import.meta.dirname, "proof-types.ts"),
  "utf8"
);
// 주석 줄 제거 후 검사
const code = source
  .split("\n")
  .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
  .join("\n");

describe("proof-types.ts 계약 규칙", () => {
  it("함수·class·enum 키워드가 없다", () => {
    expect(code).not.toMatch(/\bfunction\b/);
    expect(code).not.toMatch(/=>/);
    expect(code).not.toMatch(/\bclass\s+\w/);
    expect(code).not.toMatch(/\benum\s+\w/);
  });

  it("any 타입이 없다", () => {
    expect(code).not.toMatch(/:\s*any\b|<any>|\bas any\b/);
  });

  it("import 는 모두 import type 이다", () => {
    const imports = code.match(/^import\s.+$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) {
      expect(line).toMatch(/^import type\s/);
    }
  });

  it("환경변수·zod·DB·네트워크 참조가 없다", () => {
    expect(code).not.toMatch(
      /process\.env|from "zod"|prisma|@repo\/database|fetch\(/i
    );
  });

  it("export const 는 as const 튜플뿐이다", () => {
    const consts = code.match(/^export const .+$/gm) ?? [];
    expect(consts.length).toBe(4);
    for (const block of source.matchAll(
      /^export const \w+ = \[[\s\S]*?\] as const;/gm
    )) {
      expect(block[0]).toContain("as const");
    }
    expect(source.match(/^export const /gm)?.length).toBe(
      source.match(/^export const \w+ = \[[\s\S]*?\] as const;/gm)?.length
    );
  });
});

describe("proof-types.ts 값 목록", () => {
  it("열거 값이 계약 문서와 같다", () => {
    expect(UNAVAILABLE_REASONS).toHaveLength(8);
    expect(NOT_COMPARABLE_REASONS).toHaveLength(12);
    expect([...PROOF_LANGUAGES]).toEqual(["ko", "en"]);
    expect([...MCP_READONLY_TOOL_NAMES]).toEqual([
      "get_brand_measurement_summary",
      "get_answer_verdict_breakdown",
      "check_official_facts",
    ]);
  });

  it("start_* 도구가 없다(읽기 전용)", () => {
    for (const name of MCP_READONLY_TOOL_NAMES) {
      expect(name.startsWith("start_")).toBe(false);
    }
  });
});

// 컴파일 타임 확인(실행 시에는 아무 일도 하지 않음)
describe("proof-types.ts 컴파일 타임 모양", () => {
  it("미측정(unavailable)과 0(known)을 구분해 쓸 수 있다", () => {
    const zero: Known<number> = { as_of: null, status: "known", value: 0 };
    const reason: UnavailableReason = "not_collected";
    const missing: Known<number> = {
      as_of: null,
      detail_ko: "확인 필요",
      reason,
      status: "unavailable",
    };
    expect(zero.status).not.toBe(missing.status);
  });

  it("응답 유니온이 status 로 좁혀진다", () => {
    const narrow = (
      res: McpReadonlyResponse<{ n: number }>
    ): EvidenceEnvelope => (res.status === "ok" ? res.evidence : res.evidence);
    expect(typeof narrow).toBe("function");
  });
});
