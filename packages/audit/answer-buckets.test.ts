import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  answerBucketHeadline,
  answerReason,
  answerShareOfVoice,
  classifyAnswer,
  summarizeAnswerBuckets,
} from "./answer-buckets";
import { withRecomputedAuditMetrics } from "./normalize-stored-metrics";

// 공개 API 응답 원본(2026-09-29 수집) — `/api/audit/<id>` 그대로. 개인정보 없음.
const FIXTURES = join(import.meta.dirname, "__fixtures__", "public-audits");

interface Fixture {
  domain: string;
  result: {
    brandName: string;
    engineResponses: Array<Record<string, unknown> & { engineId: string }>;
    metrics: Record<string, unknown>;
  };
}

function load(id: string): Fixture {
  return JSON.parse(readFileSync(join(FIXTURES, `${id}.json`), "utf8"));
}

/** API 가 실제로 타는 경로(저장 행 → 재계산)로 되살린다 = 오프라인 재생. */
function replay(id: string) {
  const fixture = load(id);
  return withRecomputedAuditMetrics(fixture.result) as Fixture["result"] & {
    metrics: { answerBuckets: ReturnType<typeof summarizeAnswerBuckets> };
  };
}

describe("답변 4분류 — 공개 JSON 재생", () => {
  // (2026-09-29 대표 결정) AI 분모 = ChatGPT·Claude·Perplexity·Gemini 4곳뿐.
  //   네이버·다음 = 검색 노출(따로) · HyperCLOVA X = 서비스 종료(과거 행이라도 전부 제외).
  it("🔴 노우버스(b7f319e1): 과거 HyperCLOVA 행이 있어도 분모는 AI 4곳 16개", () => {
    const { metrics } = replay("b7f319e1-1d96-4875-a1e1-e7f5e0e814c9");
    const raw = load("b7f319e1-1d96-4875-a1e1-e7f5e0e814c9").result
      .engineResponses;
    expect(
      raw.filter((r) => r.engineId === "hyperclova").length,
      "픽스처 전제: 과거 HyperCLOVA 행 2개"
    ).toBe(2);
    const { ai, search, searchByEngine, engines } = metrics.answerBuckets;
    expect(ai).toMatchObject({
      confirmed: 5,
      differentEntity: 5,
      unknown: 5,
      engineError: 0,
      unverified: 1,
      adjudicated: 15,
      total: 16,
    });
    expect(ai.confirmedRate).toBe(33);
    // 엔진 기준: AI 4곳 중 제대로 안 곳 2(gemini·perplexity)
    expect(engines).toEqual({ measured: 4, confirmed: 2 });
    // 검색 노출: 과거 네이버 합성 요약은 판정하지 않고 공식 도메인 노출만 — 0/2
    expect(searchByEngine.naver).toMatchObject({
      confirmed: 0,
      differentEntity: 0,
      unknown: 2,
    });
    expect(searchByEngine.daum).toMatchObject({ unknown: 2, total: 2 });
    expect(search?.total).toBe(4);
    // 점수(SoV) 분모에서도 HyperCLOVA 제외: 브랜드 질문 성공·판정 끝난 답 = AI 15 + 검색 4
    expect(
      (metrics as unknown as { verifiedCount: number }).verifiedCount
    ).toBe(19);
  });

  it("과거 네이버 합성 행: 공식 도메인이 검색 결과에 있으면 노출됨(합성 문장의 판정은 무시)", () => {
    const summary = summarizeAnswerBuckets(
      [
        {
          engineId: "naver",
          brandMentioned: false,
          mentionQuality: "different_entity",
          citedSources: [
            { domain: "www.knowverse.net", url: "https://www.knowverse.net/a" },
          ],
        },
        {
          engineId: "naver",
          brandMentioned: true,
          mentionQuality: "confirmed",
          citedSources: [
            { domain: "blog.naver.com", url: "https://blog.naver.com/x" },
          ],
        },
        {
          engineId: "naver",
          naverSource: "search_results",
          brandMentioned: false,
          mentionQuality: "different_entity",
        },
      ],
      { brandDomain: "knowverse.net" }
    );
    // 합성 행 2 → 노출됨 1 · 없음 1 / 새 방식(검색 원문) 행은 판정 그대로
    expect(summary.searchByEngine.naver).toMatchObject({
      confirmed: 1,
      unknown: 1,
      differentEntity: 1,
    });
  });

  it("인디고차일드(d5dd90b4): Perplexity 한도 초과 4건은 「측정 실패」 — 분모에서 빠진다", () => {
    const { ai } = replay("d5dd90b4-1bf3-4022-bfa6-76de64ab8496").metrics
      .answerBuckets;
    expect(ai.engineError).toBe(4);
    expect(ai.adjudicated).toBe(ai.confirmed + ai.differentEntity + ai.unknown);
    expect(ai).toMatchObject({
      confirmed: 2,
      differentEntity: 4,
      unknown: 4,
      total: 16,
    });
  });

  it("인디고차일드(fcccedb7) 재생 수치", () => {
    const { ai } = replay("fcccedb7-a7de-4578-b1be-f42bd162f341").metrics
      .answerBuckets;
    expect(ai).toMatchObject({
      confirmed: 4,
      differentEntity: 1,
      unknown: 4,
      engineError: 0,
      unverified: 7,
      total: 16,
    });
  });

  it("다른 회사·모름 답변의 답변별 sov 는 0 으로 내보낸다(저장 원본 1 → 0)", () => {
    const raw = load("b7f319e1-1d96-4875-a1e1-e7f5e0e814c9").result
      .engineResponses;
    const rawDifferent = raw.find(
      (r) =>
        r.engineId === "chatgpt" &&
        r.mentionQuality === "different_entity" &&
        r.sov === 1
    );
    expect(
      rawDifferent,
      "픽스처 전제: 저장 원본에 sov 1 인 다른 회사 답변"
    ).toBeTruthy();
    const replayed = replay("b7f319e1-1d96-4875-a1e1-e7f5e0e814c9");
    for (const row of replayed.engineResponses) {
      const bucket = classifyAnswer(row as never);
      if (bucket === "confirmed") {
        continue;
      }
      expect(row.sov === 0 || row.sov === null).toBe(true);
    }
    const confirmed = replayed.engineResponses.filter(
      (r) => classifyAnswer(r as never) === "confirmed"
    );
    expect(confirmed.some((r) => typeof r.sov === "number" && r.sov > 0)).toBe(
      true
    );
  });
});

describe("classifyAnswer — 경계", () => {
  it("🔴 측정 실패 행에 판정기가 absent 를 찍어도 「모름」이 아니라 「측정 실패」", () => {
    expect(
      classifyAnswer({
        engineId: "perplexity",
        brandMentioned: false,
        mentionQuality: "absent",
        errorMessage: "You exceeded your current quota",
      })
    ).toBe("engine_error");
  });
  it("brandMentioned=true 여도 판정이 different_entity 면 제대로 앎이 아니다", () => {
    expect(
      classifyAnswer({
        engineId: "claude",
        brandMentioned: true,
        mentionQuality: "different_entity",
      })
    ).toBe("different_entity");
  });
  it("구 회차(판정 없음)의 언급은 제대로 앎으로 읽는다", () => {
    expect(classifyAnswer({ engineId: "gemini", brandMentioned: true })).toBe(
      "confirmed"
    );
  });
});

describe("이름 없는 질문·검색 노출은 헤드라인 분모 밖", () => {
  const rows = [
    { engineId: "chatgpt", brandMentioned: true, mentionQuality: "confirmed" },
    { engineId: "chatgpt", brandMentioned: false, mentionQuality: "absent" },
    {
      engineId: "chatgpt",
      brandMentioned: false,
      mentionQuality: "absent",
      promptKind: "discovery" as const,
    },
    {
      engineId: "claude",
      brandMentioned: true,
      mentionQuality: "confirmed",
      promptKind: "discovery" as const,
    },
    { engineId: "daum", brandMentioned: true, mentionQuality: "confirmed" },
    { engineId: "naver-briefing", brandMentioned: true },
  ];
  it("discovery 2건은 추천됨 1/2 로 따로, daum 은 검색 노출로 따로", () => {
    const summary = summarizeAnswerBuckets(rows);
    expect(summary.ai).toMatchObject({ confirmed: 1, unknown: 1, total: 2 });
    expect(summary.discovery).toMatchObject({
      asked: 2,
      adjudicated: 2,
      recommended: 1,
    });
    expect(summary.search).toMatchObject({ confirmed: 1, total: 1 });
    expect(summary.engines).toEqual({ measured: 1, confirmed: 1 });
  });
  it("검색 엔진의 discovery 응답은 검색 노출률이나 AI discovery 추천률에 섞지 않는다", () => {
    const summary = summarizeAnswerBuckets([
      {
        engineId: "naver",
        naverSource: "search_results",
        brandMentioned: true,
        mentionQuality: "confirmed",
        promptKind: "brand",
      },
      {
        engineId: "naver",
        naverSource: "search_results",
        brandMentioned: true,
        mentionQuality: "confirmed",
        promptKind: "discovery",
      },
      {
        engineId: "chatgpt",
        brandMentioned: true,
        mentionQuality: "confirmed",
        promptKind: "discovery",
      },
    ]);
    expect(summary.search).toMatchObject({ confirmed: 1, total: 1 });
    expect(summary.discovery).toMatchObject({ asked: 1, recommended: 1 });
  });
  it("discovery 가 없는 회차는 null(「0/0」을 말하지 않는다)", () => {
    expect(summarizeAnswerBuckets(rows.slice(0, 2)).discovery).toBeNull();
  });
  it("재계산(점수)도 discovery 행을 분모에 넣지 않는다", () => {
    const recomputed = withRecomputedAuditMetrics({
      domain: "example.com",
      mentionVerdictVersion: 2,
      metrics: {},
      engineResponses: rows,
    }) as unknown as { metrics: { verifiedCount: number; sov: number } };
    // 브랜드 질문 chatgpt 2 + daum 1 = 3 (discovery 2·브리핑 제외)
    expect(recomputed.metrics.verifiedCount).toBe(3);
  });
});

describe("answerShareOfVoice", () => {
  it("제대로 안 답변만 추정값을 유지한다", () => {
    expect(
      answerShareOfVoice(
        {
          engineId: "naver",
          brandMentioned: false,
          mentionQuality: "different_entity",
        },
        1
      )
    ).toBe(0);
    expect(
      answerShareOfVoice(
        {
          engineId: "gemini",
          brandMentioned: true,
          mentionQuality: "confirmed",
        },
        0.39
      )
    ).toBe(0.39);
    expect(
      answerShareOfVoice({ engineId: "perplexity", errorMessage: "429" }, 1)
    ).toBeNull();
  });
});

describe("문구", () => {
  it("헤드라인은 다른 회사로 앎 수를 그대로 말한다", () => {
    const summary = replay("b7f319e1-1d96-4875-a1e1-e7f5e0e814c9").metrics
      .answerBuckets;
    const text = answerBucketHeadline("노우버스", summary, true);
    expect(text).toContain("15개 중 5개만 우리를 제대로 알아요");
    expect(text).toContain("5개는 다른 회사로 알고 있어요");
    expect(text).toContain("5개는 우리를 몰라요");
  });
  it("사유: 한도 초과 · 429 · 공식 근거 없음", () => {
    expect(
      answerReason(
        {
          engineId: "perplexity",
          errorMessage: "You exceeded your current quota",
        },
        true
      )
    ).toContain("한도");
    expect(
      answerReason(
        { engineId: "chatgpt", errorMessage: "Last error: Too Many Requests" },
        true
      )
    ).toContain("429");
    expect(
      answerReason(
        {
          engineId: "claude",
          brandMentioned: false,
          mentionQuality: "unknown_brand",
          verdictReason: "official_evidence_missing",
        },
        true
      )
    ).toContain("공식 사이트 근거");
  });
});
