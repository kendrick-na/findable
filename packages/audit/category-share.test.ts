import { describe, expect, it } from "vitest";
import {
  buildCategoryReport,
  type CategoryAnswer,
  categoryReportFromAuditResult,
} from "./category-share";
import type { DemandQuestion } from "./demand-prompts";

const Q_REC: DemandQuestion = {
  text: "PDRN 앰플 추천해줘",
  lang: "ko",
  market: "KR",
  topic: "제품 추천",
  keyword: "PDRN앰플",
  volume: 19_330,
  source: "naver",
  expanded: false,
};
const Q_CONCERN: DemandQuestion = {
  text: "주름에 좋은 앰플 추천해줘",
  lang: "ko",
  market: "KR",
  topic: "피부고민",
  keyword: "주름앰플",
  volume: 2000,
  source: "naver",
  expanded: false,
};
const Q_NOT_ASKED: DemandQuestion = {
  ...Q_REC,
  text: "가성비 좋은 PDRN 앰플 추천해줘",
  topic: "가격·가성비",
  keyword: "PDRN앰플가격",
  volume: 400,
};

const answers: CategoryAnswer[] = [
  {
    engineId: "chatgpt",
    promptKind: "discovery",
    promptText: Q_REC.text,
    brandMentioned: true,
    rawResponse:
      "추천 목록입니다.\n1. **메디큐브** - PDRN 핑크 앰플\n2. **프란츠** - PDRN 앰플\n3. **메디큐브** - 다른 제품(같은 답변 안 중복)",
  },
  {
    engineId: "claude",
    promptKind: "discovery",
    promptText: Q_REC.text,
    brandMentioned: false,
    rawResponse: "1. **메디큐브** - 대표 제품\n2. **닥터지** - 무난함",
  },
  {
    engineId: "perplexity",
    promptKind: "discovery",
    promptText: Q_CONCERN.text,
    brandMentioned: true,
    rawResponse:
      "1. **Medicube** - wrinkle ampoule\n2. **프란츠** - 줄기세포 앰플",
  },
  // 아래는 모두 세지 않는다
  {
    engineId: "naver",
    promptKind: "discovery",
    promptText: Q_REC.text,
    rawResponse: "1. **닥터지** - 검색 결과",
  },
  {
    engineId: "gemini",
    promptKind: "discovery",
    promptText: Q_REC.text,
    errorMessage: "timeout",
    rawResponse: "",
  },
  {
    engineId: "chatgpt",
    promptKind: "brand",
    promptText: "프란츠는 어떤 브랜드야?",
    brandMentioned: true,
    rawResponse: "1. **닥터지** - 비교",
  },
];

const input = {
  brandName: "프란츠",
  brandVariants: ["Franz"],
  knownCompetitors: [{ name: "메디큐브", aliases: ["Medicube"] }],
  answers,
  questions: [Q_REC, Q_CONCERN, Q_NOT_ASKED],
};

describe("category report — share, topic winners, question list", () => {
  const report = buildCategoryReport(input);

  it("counts AI discovery answers only, once per brand per answer", () => {
    expect(report.category_share).toEqual({
      answers: 3,
      questions: 2,
      examples: [Q_REC.text, Q_CONCERN.text],
      note: expect.stringContaining("번호 목록"),
      brands: [
        { name: "메디큐브", mentions: 3, pct: 100 },
        { name: "프란츠", mentions: 2, pct: 66.7, self: true },
        { name: "닥터지", mentions: 1, pct: 33.3 },
      ],
    });
  });

  it("ranks top 3 per topic and reports our rank", () => {
    expect(report.topic_winners).toEqual([
      {
        topic: "제품 추천",
        question: Q_REC.text,
        top: ["메디큐브", "닥터지", "프란츠"],
        self_rank: 3,
      },
      {
        topic: "피부고민",
        question: Q_CONCERN.text,
        top: ["메디큐브", "프란츠"],
        self_rank: 2,
      },
    ]);
  });

  it("lists only questions that were actually asked, in generated order", () => {
    expect(report.category_questions).toEqual([Q_REC.text, Q_CONCERN.text]);
  });

  it("uses the verdict (brandMentioned) for self — a name hit judged as another entity is not counted", () => {
    const judgedOther = buildCategoryReport({
      ...input,
      answers: [
        {
          engineId: "chatgpt",
          promptKind: "discovery",
          promptText: Q_REC.text,
          brandMentioned: false,
          rawResponse:
            "1. **프란츠** - 오스트리아 작곡가\n2. **메디큐브** - 앰플",
        },
      ],
    });
    expect(judgedOther.category_share?.brands).toEqual([
      { name: "메디큐브", mentions: 1, pct: 100 },
    ]);
    expect(judgedOther.topic_winners[0]?.self_rank).toBeNull();
  });

  it("returns an empty share when no discovery answers exist", () => {
    expect(buildCategoryReport({ ...input, answers: [] })).toEqual({
      category_share: null,
      topic_winners: [],
      category_questions: [],
    });
  });

  it("reads a stored AuditJob.result (promptDemand on rows + demandQuestionSet)", () => {
    const fromResult = categoryReportFromAuditResult({
      brandName: "프란츠",
      brandVariants: ["Franz"],
      registeredCompetitors: [{ name: "메디큐브", aliases: ["Medicube"] }],
      engineResponses: answers.map((a) => ({
        ...a,
        promptDemand: a.promptText === Q_CONCERN.text ? Q_CONCERN : undefined,
      })),
      measurementContext: {
        demandQuestionSet: { questions: { KR: [Q_REC], US: [] } },
      },
    });
    expect(fromResult).toEqual(report);
    expect(categoryReportFromAuditResult(null)).toBeNull();
  });
});
