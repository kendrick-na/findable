/**
 * 실제 판정 함수 기준 '닫힘' — 이상한 입력은 숫자를 내보내지 않는다(가짜 판정 없이). @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { toMcpResult } from "@/lib/mcp/result";

const base = {
  completedAt: new Date(),
  createdAt: new Date(),
  domain: "brand.example",
};

describe("toMcpResult — 실제 판정(isPublishableAuditResult)과 함께", () => {
  it.each([
    [null],
    [undefined],
    [{}],
    [{ metrics: {} }],
    ["문자열"],
    [{ metrics: { enginesCovered: ["chatgpt"], enginesWithMention: [] } }],
  ])("표시 조건을 못 갖춘 결과(%j)는 null", (result) => {
    expect(toMcpResult({ ...base, result }, null, "claude")).toBeNull();
  });
});
