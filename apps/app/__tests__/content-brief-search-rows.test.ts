/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// 콘텐츠 초안 브리프는 generateContentDraft(LLM) 프롬프트로 그대로 들어간다.
// 네이버·다음 검색 API 결과의 링크·도메인·제목은 AI 입력 금지(2026-10-07 👤 대표 결정 · 검색 API 약관).
const h = vi.hoisted(() => ({
  rows: [] as unknown[],
}));

vi.mock("@/lib/db/scoped", () => ({
  scopedLatestRunTracking: () => Promise.resolve(h.rows),
}));
vi.mock("@repo/database", () => ({
  database: {
    prompt: {
      findMany: () =>
        Promise.resolve([
          { id: "p1", text: "AI 도입 컨설팅 업체 추천" },
          { id: "p2", text: "GEO 진단 회사" },
        ]),
    },
  },
}));

import { latestContentBrief } from "../lib/content/latest-brief";

const brand = {
  name: "인디고차일드",
  domain: "indigochild.kr",
  entityVariants: [],
  competitors: [],
};
const trackedAt = new Date("2026-10-07T00:00:00Z");
const base = { brand, brandId: "b1", trackedAt, errorMessage: null };

beforeEach(() => {
  h.rows = [
    {
      ...base,
      promptId: "p1",
      engineId: "naver",
      brandMentioned: true,
      rawResponse: "인디고차일드 NAVER_RAW_BODY_MARKER",
      citedSources: [
        {
          domain: "naver-only-domain.example",
          url: "https://naver-only-domain.example/인디고차일드",
          title: "인디고차일드 NAVER_TITLE_MARKER",
        },
      ],
    },
    {
      ...base,
      promptId: "p2",
      engineId: "daum",
      brandMentioned: true,
      rawResponse: "인디고차일드 DAUM_RAW_BODY_MARKER",
      citedSources: [
        {
          domain: "daum-only-domain.example",
          url: "https://daum-only-domain.example/인디고차일드",
          title: "인디고차일드 DAUM_TITLE_MARKER",
        },
      ],
    },
    {
      ...base,
      promptId: "p1",
      engineId: "chatgpt",
      brandMentioned: true,
      rawResponse: "인디고차일드는 AI 에이전시입니다.",
      citedSources: [
        {
          domain: "wiki.example",
          url: "https://wiki.example/인디고차일드",
          title: "인디고차일드",
        },
      ],
    },
    {
      ...base,
      promptId: "p2",
      engineId: "chatgpt",
      brandMentioned: false,
      rawResponse: "다른 회사들을 추천합니다.",
      citedSources: [],
    },
  ];
});

describe("latestContentBrief — search API rows", () => {
  it("never hands naver/daum citation domains or titles to the draft LLM", async () => {
    const brief = await latestContentBrief("b1");
    const serialized = JSON.stringify(brief);
    for (const marker of [
      "naver-only-domain.example",
      "daum-only-domain.example",
      "NAVER_TITLE_MARKER",
      "DAUM_TITLE_MARKER",
      "NAVER_RAW_BODY_MARKER",
      "DAUM_RAW_BODY_MARKER",
    ]) {
      expect(serialized).not.toContain(marker);
    }
    expect(brief).not.toBeNull();
    if (brief) {
      expect(brief.measurement.sourceDomains).not.toContain(
        "naver-only-domain.example"
      );
    }
  });
});
