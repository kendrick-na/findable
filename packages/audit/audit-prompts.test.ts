import { expect, it } from "vitest";
import { generateAuditPrompts } from "./audit-prompts";

it("asks English prompts with the English name and Korean prompts with the Korean name", () => {
  const prompts = generateAuditPrompts(
    { ko: "노우버스", en: "KNOWVERSE" },
    "both"
  );
  const english = prompts.filter((p) => p.lang === "en");
  const korean = prompts.filter((p) => p.lang === "ko");
  expect(english).toHaveLength(2);
  for (const p of english) {
    expect(p.text).toContain("KNOWVERSE");
    expect(p.text).not.toContain("노우버스");
  }
  for (const p of korean) {
    expect(p.text).toContain("노우버스");
  }
  expect(english[0]?.text).toBe(
    "What does KNOWVERSE offer, and who is it for?"
  );
});

// ── 이름 없는 질문(discovery, 2026-09-29) ─────────────────────────────
import { readFileSync as readFixture } from "node:fs";
import { join as joinPath } from "node:path";
import {
  generateDiscoveryPrompts,
  MAX_DISCOVERY_PROMPTS,
} from "./audit-prompts";
import { RUNNER_PROMPT_LIMIT as RUNNER_PROMPT_LIMIT_FOR_TEST } from "./prompt-limits";

function siteOf(id: string) {
  const data = JSON.parse(
    readFixture(
      joinPath(
        import.meta.dirname,
        "__fixtures__",
        "public-audits",
        `${id}.json`
      ),
      "utf8"
    )
  );
  return data.result.measurementContext.officialSiteIdentity;
}

it("노우버스: 사이트 제목·설명으로 이름 없는 한국어 질문 2개를 만든다", () => {
  const prompts = generateDiscoveryPrompts(
    { ko: "노우버스", en: "KNOWVERSE", variants: ["KNOWVERSE", "knowverse"] },
    siteOf("b7f319e1-1d96-4875-a1e1-e7f5e0e814c9"),
    "both"
  );
  expect(prompts.map((p) => p.text)).toEqual([
    "AI 전략, CTO 구독 서비스를 하는 곳 추천해줘",
    "기업의 기술 의사결정과 AI 전환을 도와주는 서비스 어디 있어?",
  ]);
  for (const p of prompts) {
    expect(p.kind).toBe("discovery");
    expect(p.text).not.toMatch(/노우버스|knowverse/i);
  }
});

it("업종 단서가 없는 사이트(Indigochild · We Create the Future)는 질문을 지어내지 않는다", () => {
  expect(
    generateDiscoveryPrompts(
      { ko: "인디고차일드", en: "인디고차일드" },
      siteOf("fcccedb7-a7de-4578-b1be-f42bd162f341"),
      "both"
    )
  ).toEqual([]);
});

it("슬로건·성분명·오탈자 브랜드 조각은 이름 없는 질문의 업종으로 쓰지 않는다", () => {
  expect(
    generateDiscoveryPrompts(
      { ko: "멜트헤일로", en: "Melt Halo" },
      {
        title: "멜트헤일로 | 만져지는 변화, NAD+ / Metl Halo",
        description: "멜트헤일로 스킨케어 | NAD 마스크, 재생 크림, 톤업크림",
      },
      "ko"
    )
  ).toEqual([]);
});

it("영어 질문은 사이트가 영어로 쓴 조각이 있을 때만 — 한글 조각을 번역하지 않는다", () => {
  const en = generateDiscoveryPrompts(
    { ko: "노우버스", en: "KNOWVERSE" },
    siteOf("b7f319e1-1d96-4875-a1e1-e7f5e0e814c9"),
    "en"
  );
  expect(en).toEqual([]);
  const findable = generateDiscoveryPrompts(
    { ko: "Findable", en: "Findable" },
    siteOf("00e40b02-cf16-48c8-bb61-ace0c1da692f"),
    "en"
  );
  expect(findable[0]?.text).toBe(
    "What are the best AI search and GEO brand visibility audit services?"
  );
});

it("브랜드 질문 + 이름 없는 질문 합계가 러너 상한(8)을 넘지 않는다", () => {
  for (const language of ["ko", "en", "both"] as const) {
    const total =
      generateAuditPrompts({ ko: "노우버스", en: "KNOWVERSE" }, language)
        .length +
      generateDiscoveryPrompts(
        { ko: "노우버스", en: "KNOWVERSE" },
        siteOf("b7f319e1-1d96-4875-a1e1-e7f5e0e814c9"),
        language
      ).length;
    expect(total).toBeLessThanOrEqual(RUNNER_PROMPT_LIMIT_FOR_TEST);
  }
  expect(MAX_DISCOVERY_PROMPTS).toBeLessThanOrEqual(2);
});
