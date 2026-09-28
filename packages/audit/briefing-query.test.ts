import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { briefingCandidatePrompts } from "./briefing-query";

function siteOf(id: string) {
  return JSON.parse(
    readFileSync(
      join(import.meta.dirname, "__fixtures__", "public-audits", `${id}.json`),
      "utf8"
    )
  ).result.measurementContext.officialSiteIdentity;
}

describe("네이버 AI 브리핑 질의 — 업종별", () => {
  it("🔴 B2B 서비스(노우버스)에는 「효과」를 묻지 않는다", () => {
    const prompts = briefingCandidatePrompts("노우버스", "ko", {
      site: siteOf("b7f319e1-1d96-4875-a1e1-e7f5e0e814c9"),
    });
    expect(prompts).toEqual([
      "노우버스 서비스",
      "노우버스 가격",
      "노우버스 후기",
    ]);
    expect(prompts.join(" ")).not.toContain("효과");
  });
  it("뷰티·건강은 기존 질의 그대로(실측으로 브리핑이 뜨는 질의)", () => {
    expect(
      briefingCandidatePrompts("설화수", "ko", { industry: "뷰티·화장품" })
    ).toEqual(["설화수 효과", "설화수 후기", "설화수 장단점"]);
  });
  it("업종 칸이 사이트 문구보다 먼저다", () => {
    expect(
      briefingCandidatePrompts("노우버스", "ko", {
        industry: "건강기능식품",
        site: siteOf("b7f319e1-1d96-4875-a1e1-e7f5e0e814c9"),
      })[0]
    ).toBe("노우버스 효과");
  });
  it("단서가 없으면 기존 동작 그대로(바꿀 근거가 없다)", () => {
    expect(
      briefingCandidatePrompts("인디고차일드", "ko", {
        site: siteOf("fcccedb7-a7de-4578-b1be-f42bd162f341"),
      })
    ).toEqual([
      "인디고차일드 효과",
      "인디고차일드 후기",
      "인디고차일드 장단점",
    ]);
  });
  it("영어도 같은 규칙", () => {
    expect(
      briefingCandidatePrompts("Findable", "en", {
        site: siteOf("00e40b02-cf16-48c8-bb61-ace0c1da692f"),
      })
    ).toEqual(["Findable services", "Findable pricing", "Findable review"]);
  });
});
