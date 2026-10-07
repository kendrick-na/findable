// 네이버·다음 검색 API 결과 원문은 어떤 LLM 프롬프트에도 들어가지 않는다
// (2026-10-07 👤 대표 결정 · 네이버 검색 API 약관 2026-09-07 시행 · 카카오 약관 제5조 제30호).
//
// 이 테스트는 crew 의 **실제 LLM 호출 직전 프롬프트를 전부 가로채** 검색 행의 원문 표식이
// 하나라도 들어가면 실패한다. 새 프롬프트 조립 지점이 가드를 빼먹어도 여기서 잡힌다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCopilotSystemPrompt } from "./crew/copilot";
import {
  buildAlexPrompt,
  buildMinjiPrompt,
  buildSujinPrompt,
  type CrewInput,
  runCrewDiagnose,
} from "./crew/orchestrator";
import type { AuditMetrics, EngineResponse } from "./engines";
import {
  formatSearchApiRowSummary,
  isSearchResultEngine,
  summarizeSearchApiRows,
  topCitedDomainsWithoutSearchRows,
  withoutSearchApiRows,
} from "./search-api-rows";

const h = vi.hoisted(() => ({ prompts: [] as string[] }));

vi.mock("./crew/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./crew/agents")>();
  const fakeAgent = {
    generate: (messages: Array<{ content: string }>) => {
      for (const m of messages) {
        h.prompts.push(m.content);
      }
      return Promise.resolve({ text: "" });
    },
  };
  return {
    ...actual,
    CREW_AGENTS: {
      minji: fakeAgent,
      alex: fakeAgent,
      sujin: fakeAgent,
      junho: fakeAgent,
    },
    rewriterAgent: fakeAgent,
  };
});

/** 검색 행에만 심는 표식 — 어느 프롬프트에서든 보이면 실패. */
const SEARCH_MARKERS = [
  "NAVER_RAW_BODY_MARKER",
  "NAVER_TITLE_MARKER",
  "NAVER_SNIPPET_MARKER",
  "naver-only-domain.example",
  "DAUM_RAW_BODY_MARKER",
  "DAUM_TITLE_MARKER",
  "daum-only-domain.example",
];

function row(overrides: Partial<EngineResponse>): EngineResponse {
  return {
    engineId: "chatgpt",
    rawResponse: "",
    brandMentioned: false,
    mentionPosition: null,
    mentionListSize: null,
    citedSources: [],
    sentiment: null,
    shareOfVoice: null,
    durationMs: 1,
    errorMessage: null,
    isStub: false,
    ...overrides,
  };
}

const fixtures: EngineResponse[] = [
  row({
    engineId: "naver",
    rawResponse: "1. NAVER_TITLE_MARKER — NAVER_RAW_BODY_MARKER 인디고차일드",
    brandMentioned: true,
    mentionQuality: "confirmed",
    sentiment: "positive",
    citedSources: [
      {
        domain: "naver-only-domain.example",
        url: "https://naver-only-domain.example/post/1",
        title: "NAVER_TITLE_MARKER",
        snippet: "NAVER_SNIPPET_MARKER",
      },
    ],
  }),
  row({
    engineId: "naver",
    rawResponse: "NAVER_RAW_BODY_MARKER 다른 글",
    brandMentioned: true,
    mentionQuality: "unverified",
  }),
  row({
    engineId: "daum",
    rawResponse: "DAUM_RAW_BODY_MARKER",
    brandMentioned: false,
    citedSources: [
      {
        domain: "daum-only-domain.example",
        url: "https://daum-only-domain.example/a",
        title: "DAUM_TITLE_MARKER",
      },
    ],
  }),
  row({ engineId: "daum", errorMessage: "timeout" }),
  row({
    engineId: "chatgpt",
    rawResponse: "ChatGPT 답변: 인디고차일드는 AI 에이전시입니다.",
    brandMentioned: true,
    mentionQuality: "confirmed",
    citedSources: [
      {
        domain: "indigochild.kr",
        url: "https://indigochild.kr",
        title: "AI_ENGINE_TITLE_OK",
      },
    ],
  }),
];

const metrics = {
  sov: 40,
  averageMentionPosition: 2,
  enginesCovered: ["naver", "naver", "daum", "daum", "chatgpt"],
  enginesWithMention: ["naver", "chatgpt"],
  sentimentDistribution: { positive: 1, neutral: 0, negative: 0 },
  // 저장된 metrics 는 검색 행 도메인까지 섞어 센다 — 프롬프트에 그대로 나가면 안 된다.
  topCitedDomains: [
    { domain: "naver-only-domain.example", count: 1 },
    { domain: "daum-only-domain.example", count: 1 },
    { domain: "indigochild.kr", count: 1 },
  ],
  stubCount: 0,
  errors: [],
} as unknown as AuditMetrics;

const input: CrewInput = {
  brandName: "인디고차일드",
  domain: "indigochild.kr",
  engineResponses: fixtures,
  metrics,
  language: "both",
};

/** 프롬프트에 섞여 들어간 검색 행 표식 목록(비어 있어야 정상). */
function leakedMarkers(text: string): string[] {
  return SEARCH_MARKERS.filter((marker) => text.includes(marker));
}

describe("search-api-rows 가드", () => {
  it("naver·daum 만 검색 API 행으로 본다(naver-briefing 은 아님)", () => {
    expect(isSearchResultEngine("naver")).toBe(true);
    expect(isSearchResultEngine("daum")).toBe(true);
    expect(isSearchResultEngine("naver-briefing")).toBe(false);
    expect(isSearchResultEngine(undefined)).toBe(false);
  });

  it("withoutSearchApiRows 는 검색 행을 뺀다", () => {
    expect(withoutSearchApiRows(fixtures).map((r) => r.engineId)).toEqual([
      "chatgpt",
    ]);
    expect(withoutSearchApiRows(null)).toEqual([]);
  });

  it("집계는 건수만 담고 글자를 담지 않는다", () => {
    const summary = summarizeSearchApiRows(fixtures);
    expect(summary).toEqual([
      { engineId: "naver", measured: 2, failed: 0, exposed: 2, confirmed: 1 },
      { engineId: "daum", measured: 1, failed: 1, exposed: 0, confirmed: 0 },
    ]);
    const text = formatSearchApiRowSummary(summary);
    expect(leakedMarkers(text)).toEqual([]);
    expect(text).toContain("정상 측정 2건 중 이름 노출 2건");
  });

  it("인용 도메인 집계는 검색 행을 뺀 뒤 센다", () => {
    expect(topCitedDomainsWithoutSearchRows(fixtures, 10)).toEqual([
      { domain: "indigochild.kr", count: 1 },
    ]);
  });
});

describe("crew 프롬프트 — 검색 API 원문 미포함", () => {
  it("민지·Alex·수진 프롬프트에 검색 원문·제목·스니펫·도메인이 없다", () => {
    for (const prompt of [
      buildMinjiPrompt(input),
      buildAlexPrompt(input),
      buildSujinPrompt(input),
    ]) {
      expect(leakedMarkers(prompt)).toEqual([]);
    }
  });

  it("민지는 네이버·다음 건수 집계를 받는다", () => {
    const prompt = buildMinjiPrompt(input);
    expect(prompt).toContain("한국 검색 노출 집계");
    expect(prompt).toContain("같은 회사 확정 노출 1건");
  });

  it("AI 엔진 행의 데이터는 그대로 쓴다(가드가 과하게 지우지 않음)", () => {
    expect(buildAlexPrompt(input)).toContain("ChatGPT 답변");
    expect(buildSujinPrompt(input)).toContain("AI_ENGINE_TITLE_OK");
  });

  describe("runCrewDiagnose 전 구간(실제 generate 직전 가로채기)", () => {
    beforeEach(() => {
      h.prompts.length = 0;
      vi.stubEnv("AI_GATEWAY_API_KEY", "test-key-not-real");
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("모든 에이전트 호출 프롬프트에 검색 원문이 없다", async () => {
      await runCrewDiagnose(input);
      // 민지·Alex·수진·준호 4회 (재작성은 준호 결과가 없어 생략)
      expect(h.prompts.length).toBe(4);
      for (const prompt of h.prompts) {
        expect(leakedMarkers(prompt)).toEqual([]);
      }
    });
  });
});

describe("코파일럿 시스템 프롬프트", () => {
  it("분석 결과·지표 요약 외에 검색 행이 들어갈 통로가 없다", () => {
    const prompt = buildCopilotSystemPrompt({
      brandName: "인디고차일드",
      domain: "indigochild.kr",
      metricsSummary: `상위 인용 도메인: ${topCitedDomainsWithoutSearchRows(
        fixtures,
        5
      )
        .map((d) => d.domain)
        .join(", ")}`,
      analysts: [],
      strategist: null,
    });
    expect(leakedMarkers(prompt)).toEqual([]);
  });
});
