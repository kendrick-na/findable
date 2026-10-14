import { describe, expect, it } from "vitest";
import { classifyDomain } from "./domain-type";
import { answerRowsOf, buildGapAnalysis } from "./gap-analysis";

const resp = (over: Record<string, unknown>) => ({
  promptIndex: 0,
  promptText: "AI 검색 가시성 도구 추천해줘",
  promptKind: "discovery",
  engineId: "chatgpt",
  excerpt: "본문",
  brandMentioned: false,
  citedSources: [],
  isStub: false,
  ...over,
});

describe("answerRowsOf", () => {
  it("검색 노출·스텁·실패·본문 없는 행을 빼고 같은 (질문,엔진)은 마지막만 남긴다", () => {
    const rows = answerRowsOf({
      engineResponses: [
        resp({}),
        resp({ engineId: "naver" }),
        resp({ engineId: "gemini", isStub: true }),
        resp({ engineId: "claude", errorMessage: "429" }),
        resp({ engineId: "perplexity", excerpt: "" }),
        resp({ excerpt: "두번째" }),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.excerpt).toBe("두번째");
  });
  it("모양이 이상하면 빈 배열", () => {
    expect(answerRowsOf(null)).toEqual([]);
    expect(answerRowsOf({ engineResponses: "x" })).toEqual([]);
  });
});

describe("buildGapAnalysis", () => {
  const own = {
    name: "Findable",
    variants: ["파인더블"],
    domain: "findable.co.kr",
  };
  const rows = answerRowsOf({
    engineResponses: [
      resp({
        promptIndex: 0,
        engineId: "chatgpt",
        citedSources: [
          {
            domain: "www.blog.naver.com",
            url: "https://blog.naver.com/a",
            title: "후기",
          },
          { domain: "findable.co.kr", url: "https://findable.co.kr" },
        ],
      }),
      resp({ promptIndex: 0, engineId: "claude" }),
      resp({
        promptIndex: 1,
        promptText: "AI 검색 순위 올리는 법",
        engineId: "chatgpt",
        brandMentioned: true,
        citedSources: [
          { domain: "tistory.com", url: "https://x.tistory.com/1" },
        ],
      }),
    ],
  });
  const brands = new Map<string, string[]>([
    ["0|chatgpt", ["Profound", "프로파운드", "Peec AI"]],
    ["0|claude", ["Profound"]],
    ["1|chatgpt", ["Findable", "Profound"]],
  ]);
  const out = buildGapAnalysis({
    rows,
    brandsByKey: brands,
    own,
    competitors: [{ name: "Profound", aliases: ["프로파운드"] }],
  });

  it("브랜드 보드: 별칭을 합치고 자사는 뺀다, 등록 여부 표시", () => {
    expect(out.brandBoard[0]).toMatchObject({
      name: "Profound",
      answers: 3,
      isRegistered: true,
    });
    expect(out.brandBoard.find((b) => b.name === "Peec AI")?.isRegistered).toBe(
      false
    );
    expect(out.brandBoard.some((b) => b.name === "Findable")).toBe(false);
  });
  it("질문 빈틈: 우리가 한 번도 안 나온 질문만", () => {
    expect(out.questionGaps).toHaveLength(1);
    expect(out.questionGaps[0]?.promptText).toContain("가시성");
  });
  it("출처 빈틈: 우리가 빠진 답변에서만 인용된 외부 사이트, 자사 도메인·우리가 나온 답변의 출처는 제외", () => {
    expect(out.sourceGaps.map((s) => s.domain)).toEqual(["blog.naver.com"]);
    expect(out.sourceGaps[0]?.type).toBe("blog");
  });
  it("아직 추출 안 한 답변은 분석 수에서 빠진다", () => {
    const partial = buildGapAnalysis({
      rows,
      brandsByKey: new Map([["0|chatgpt", ["Profound"]]]),
      own,
      competitors: [],
    });
    expect(partial).toMatchObject({ analyzed: 1, total: 3 });
  });
});

describe("classifyDomain", () => {
  it.each([
    ["blog.naver.com", "blog"],
    ["cafe.naver.com", "community"],
    ["coupang.com", "shop"],
    ["ko.wikipedia.org", "wiki"],
    ["youtube.com", "social"],
    ["kosis.go.kr", "public"],
    ["zdnet.co.kr", "news"],
    ["example-unknown.com", "other"],
  ])("%s → %s", (d, t) => expect(classifyDomain(d)).toBe(t));
  it("경쟁사 이름이 든 도메인은 공식 사이트", () => {
    expect(
      classifyDomain("profound.com", { competitorNames: ["Profound"] })
    ).toBe("official");
  });
});

describe("gapCsv", () => {
  it("구분 머리글 + 보드·질문·출처 행, 수식 시작 셀은 작은따옴표로 막는다", async () => {
    const { gapCsv } = await import("./gap-csv");
    const csv = gapCsv(
      {
        analyzed: 1,
        total: 1,
        brandBoard: [
          { name: "=HYPERLINK(x)", answers: 2, isRegistered: false },
        ],
        questionGaps: [
          {
            promptText: "질문, 하나",
            answers: 1,
            competitors: [{ name: "A", answers: 1 }],
          },
        ],
        sourceGaps: [],
      },
      {
        boardTitle: "보드",
        questionsTitle: "질문",
        sourcesTitle: "출처",
        csvSection: "구분",
        csvName: "이름",
        csvCount: "수",
        csvDetail: "상세",
        csvType: "유형",
      }
    );
    expect(csv.split("\r\n")).toEqual([
      "구분,이름,수,유형,상세",
      "보드,'=HYPERLINK(x),2,,",
      '질문,"질문, 하나",1,,A',
    ]);
  });
});

describe("자사 도메인 줄기", () => {
  it("영문 상표(도메인 줄기)로 나온 자사 이름은 경쟁사로 세지 않는다", () => {
    const rows = answerRowsOf({
      engineResponses: [resp({ engineId: "chatgpt" })],
    });
    const out = buildGapAnalysis({
      rows,
      brandsByKey: new Map([
        ["0|chatgpt", ["Nike", "Nike Air Max 270", "Adidas"]],
      ]),
      own: { name: "나이키", variants: [], domain: "nike.com" },
      competitors: [],
    });
    expect(out.brandBoard.map((b) => b.name)).toEqual(["Adidas"]);
  });
});
