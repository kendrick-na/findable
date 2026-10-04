/**
 * 근거 등급 규칙표 — 실제 공개 진단 2건으로 고정한다(2026-09-28).
 *   노우버스(b7f319e1…): 답 22건 중 8건이 동명 다른 회사 → 오인 규칙이 켜져야 한다.
 *   인디고차일드(fcccedb7…): 오인 1건(5%) → 오인 규칙은 꺼지고, 인지 낮음 규칙이 켜져야 한다.
 *
 * ⚠️ 문구를 하드코딩하지 않는다 — kind·건수·등급·출처 URL(계약)만 본다.
 *   (📕 「가드가 버그의 호위병이 된다」)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  crawlAccessAction,
  DONT_LIST,
  EVIDENCE_GRADE_LABEL,
  entityClarityAction,
  RULE_THRESHOLDS,
  summarizeVerdicts,
  type VerdictResponseLike,
  verdictRates,
} from "./action-rules";
import { type ActionInput, buildGeoActions } from "./actions";

interface Fixture {
  brandName: string;
  domain: string;
  engineResponses: VerdictResponseLike[];
  marketScope: "korea" | "global" | "both";
}

function load(name: string): Fixture {
  const path = fileURLToPath(
    new URL(`./__fixtures__/${name}`, import.meta.url)
  );
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

function inputOf(f: Fixture): ActionInput {
  const answered = f.engineResponses.filter(
    (r) => !(r.errorMessage || r.isStub)
  );
  return {
    averageMentionPosition: null,
    brandDomain: f.domain,
    brandName: f.brandName,
    enginesMeasured: new Set(answered.map((r) => r.engineId)).size,
    enginesMentioned: new Set(
      answered
        .filter((r) => r.mentionQuality === "confirmed")
        .map((r) => r.engineId)
    ).size,
    marketScope: f.marketScope,
    verdicts: summarizeVerdicts(f.engineResponses, {
      brandDomain: f.domain,
      brandName: f.brandName,
    }),
  };
}

const knowverse = load("audit-knowverse.json");
const indigo = load("audit-indigochild.json");

describe("summarizeVerdicts — 공개 진단 실측과 일치", () => {
  it("노우버스: 23건 = 답 22 + 오류 1, 확인 5 · 오인 8", () => {
    const { counts, differentEntityEngines } = summarizeVerdicts(
      knowverse.engineResponses,
      { brandDomain: knowverse.domain, brandName: knowverse.brandName }
    );
    expect(counts.total).toBe(23);
    expect(counts.engineError).toBe(1);
    expect(counts.answered).toBe(22);
    expect(counts.confirmed).toBe(5);
    expect(counts.differentEntity).toBe(8);
    expect(counts.unknownBrand + counts.absent).toBe(8);
    for (const engine of ["chatgpt", "claude", "perplexity", "naver"]) {
      expect(differentEntityEngines).toContain(engine);
    }
  });

  it("비율은 답을 받은 응답이 분모다(오류를 '모름'으로 세지 않는다)", () => {
    const { counts } = summarizeVerdicts(knowverse.engineResponses, {
      brandName: knowverse.brandName,
    });
    const rates = verdictRates(counts);
    expect(rates.misidentificationRate).toBeCloseTo(8 / 22);
    expect(rates.accurateRate).toBeCloseTo(5 / 22);
    expect(verdictRates({ ...counts, answered: 0 }).accurateRate).toBeNull();
  });
});

describe("노우버스 — 동명 오인 규칙", () => {
  const actions = buildGeoActions(inputOf(knowverse));
  const entity = actions.find((a) => a.kind === "entity_clarity");

  it("오인 카드가 켜지고 맨 앞에 온다", () => {
    expect(entity).toBeTruthy();
    expect(actions[0]?.kind).toBe("entity_clarity");
  });

  it("관측 건수를 그대로 말한다 (22건 중 8건)", () => {
    expect(entity?.title).toContain("22건 중 8건");
    expect(entity?.guide?.remeasureMetric).toContain("22건 중 8건");
  });

  it("착각한 답변 원문을 서로 다른 AI에서 최대 3개 인용한다", () => {
    const quotes = entity?.guide?.quotes ?? [];
    expect(quotes.length).toBe(RULE_THRESHOLDS.maxQuotes);
    expect(new Set(quotes.map((q) => q.engineId)).size).toBe(quotes.length);
    for (const q of quotes) {
      expect([
        "chatgpt",
        "claude",
        "perplexity",
        "naver",
        "hyperclova",
      ]).toContain(q.engineId);
      expect(q.excerpt).toContain("노우버스");
      expect(q.excerpt).not.toContain("**");
    }
  });

  it("근거 등급 medium · Google Organization 문서 · Google/Gemini 한정", () => {
    expect(entity?.guide?.evidenceGrade).toBe("medium");
    expect(entity?.guide?.sources.map((s) => s.url)).toContain(
      "https://developers.google.com/search/docs/appearance/structured-data/organization"
    );
    expect(entity?.guide?.engines).toEqual(["google", "gemini"]);
  });
});

describe("인디고차일드 — 오인은 꺼지고 인지 낮음이 켜진다", () => {
  const actions = buildGeoActions(inputOf(indigo));

  it("오인 1/22(5%)는 20% 미만 → 오인 카드 없음", () => {
    expect(actions.some((a) => a.kind === "entity_clarity")).toBe(false);
  });

  it("모른다 10건 > 알아봄 4건 → 네이버 블로그(한국 시장) 카드", () => {
    const naver = actions.find((a) => a.kind === "naver_blog");
    expect(naver).toBeTruthy();
    expect(naver?.evidence).toContain("22건");
    expect(naver?.guide?.sources[0]?.url).toBe(
      "https://seonews.co.kr/naver-ai-briefing-geo-202605/"
    );
    expect(naver?.guide?.engines).toEqual(["naver"]);
    expect(naver?.verification).not.toContain("HyperCLOVA");
    expect(naver?.verification).toContain("같은 질문에 네이버 검색 노출");
    expect(naver?.guide?.remeasureMetric).toContain("네이버 검색 노출");
    expect(naver?.guide?.failCondition).toContain("노출이 확인된 질문 수");
  });

  it("해외 시장이면 네이버 카드를 내지 않는다", () => {
    const global = buildGeoActions({
      ...inputOf(indigo),
      marketScope: "global",
    });
    expect(global.some((a) => a.kind === "naver_blog")).toBe(false);
  });
});

describe("크롤 접근성 카드 — 전제조건과 효과 보장을 분리한다", () => {
  it("봇 접근성은 인용의 전제조건일 뿐, 다른 처방의 효과를 단정하지 않는다", () => {
    const action = crawlAccessAction({
      brandDomain: "example.com",
      brandName: "예시회사",
      enginesMeasured: 7,
      enginesMentioned: 0,
      marketScope: "global",
      measuredLabel: "측정한 AI 7곳",
      ownedCitations: 0,
    });

    expect(action).toBeTruthy();
    expect(action?.evidence).toContain("인용의 전제 조건");
    expect(action?.evidence).not.toContain("다른 처방은 효과가 없습니다");
    expect(action?.guide?.notGuaranteed).toContain("인용이 생긴다는 보장은 없");
    expect(action?.guide?.effectLag).toContain("보장되지 않습니다");
    expect(action?.guide?.failCondition).toContain("다음 측정으로 확인");
    expect(action?.guide?.failCondition).not.toContain("다른 처방보다 먼저");
  });
});

describe("모든 카드의 6칸 계약", () => {
  for (const [label, f] of [
    ["노우버스", knowverse],
    ["인디고차일드", indigo],
  ] as const) {
    it(`${label}: 할 일 카드는 6칸이 다 차 있고, +41% 고정 카드는 없다`, () => {
      const actions = buildGeoActions(inputOf(f));
      for (const a of actions.filter((x) => x.kind !== "avoid")) {
        const g = a.guide;
        expect(g, `guide 없음: ${a.kind}`).toBeTruthy();
        expect(Object.keys(EVIDENCE_GRADE_LABEL)).toContain(g?.evidenceGrade);
        expect(g?.sources.length).toBeGreaterThan(0);
        for (const s of g?.sources ?? []) {
          expect(s.url).toMatch(/^https:\/\//);
        }
        expect(Array.isArray(g?.engines)).toBe(true);
        expect(g?.effortHours.max).toBeGreaterThanOrEqual(
          g?.effortHours.min ?? 0
        );
        expect(g?.effectLag.length).toBeGreaterThan(3);
        expect(g?.remeasureMetric.length).toBeGreaterThan(3);
        expect(g?.failCondition.length).toBeGreaterThan(3);
      }
      expect(JSON.stringify(actions)).not.toContain("+41%");
    });
  }

  it("「하지 마세요」 5건은 전부 근거 없음(none) + 출처 URL", () => {
    const avoid = buildGeoActions(inputOf(knowverse)).at(-1);
    expect(avoid?.kind).toBe("avoid");
    expect(avoid?.donts).toHaveLength(5);
    for (const d of DONT_LIST) {
      expect(d.evidenceGrade).toBe("none");
      expect(d.sources[0]?.url).toMatch(/^https:\/\//);
    }
  });
});

describe("경계값 — 뮤테이션이 무는 값", () => {
  const base = summarizeVerdicts(knowverse.engineResponses, {
    brandName: knowverse.brandName,
  });
  const at = (differentEntity: number, answered: number) =>
    entityClarityAction({
      brandName: "노우버스",
      enginesMeasured: 7,
      enginesMentioned: 3,
      marketScope: "korea",
      measuredLabel: "측정한 AI 7곳",
      ownedCitations: 1,
      verdicts: {
        ...base,
        counts: { ...base.counts, answered, differentEntity },
      },
    });

  it("정확히 20%(2/10)는 켜지고, 19%(19/100)는 꺼진다", () => {
    expect(at(2, 10)).not.toBeNull();
    expect(at(19, 100)).toBeNull();
  });
});
