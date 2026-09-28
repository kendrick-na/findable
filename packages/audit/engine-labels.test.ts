import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { engineDisplayName, engineNote } from "./engine-labels";

describe("엔진 표시 이름 — 실제로 잰 것을 부른다", () => {
  it("🔴 naver 는 네이버의 AI 답이 아니다 — 검색 노출이라고 부른다", () => {
    expect(engineDisplayName("naver")).toBe("네이버 검색 노출");
    expect(engineDisplayName("naver", false)).toBe("Naver search exposure");
    // 「네이버 AI」라는 말은 브리핑에만 쓴다
    expect(engineDisplayName("naver")).not.toContain("AI");
    expect(engineDisplayName("naver-briefing")).toBe("네이버 AI 브리핑");
  });
  it("daum 은 검색 노출, chatgpt 는 웹검색 없음, hyperclova 는 이전 측정 표시용", () => {
    expect(engineDisplayName("daum")).toBe("다음 검색 노출");
    expect(engineDisplayName("chatgpt")).toBe("ChatGPT (웹검색 없음)");
    expect(engineDisplayName("hyperclova")).toBe("HyperCLOVA X (이전 측정)");
    expect(engineNote("chatgpt")).toContain("웹검색 없이");
    expect(engineNote("naver")).toContain("네이버가 직접 한 답이 아니에요");
  });
});

describe("⛔ 화면·PDF 가 엔진 이름 지도를 따로 두지 않는다", () => {
  // 따로 두면 한쪽만 「Naver」로 남는다(실제로 5곳에 복제돼 있었다).
  const root = join(import.meta.dirname, "..", "..");
  const files = [
    "apps/web/app/[locale]/audit/[jobId]/components/audit-result.tsx",
    "apps/web/app/[locale]/audit/[jobId]/components/truth-mirror.tsx",
    "apps/web/app/[locale]/audit/[jobId]/components/naver-vs-ai-gap.tsx",
    "apps/web/app/[locale]/audit/[jobId]/components/answer-buckets.tsx",
    "apps/app/app/(authenticated)/features/analysis/truth-mirror-section.tsx",
    "apps/app/app/(authenticated)/features/analysis/sources-board.tsx",
    "packages/audit/pdf-template.ts",
  ];
  // 주석을 걷고 코드만 본다(주석에 옛 이름을 남겨도 가드가 오탐하지 않게).
  const code = (raw: string) =>
    raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const file of files) {
    it(`${file} — naver 를 「Naver」·「네이버」 한 단어로 부르는 지도가 없다`, () => {
      const src = code(readFileSync(join(root, file), "utf8"));
      expect(src).not.toMatch(/\bnaver:\s*"(Naver|네이버)"/);
      expect(src).toContain("engineDisplayName");
    });
  }
});
