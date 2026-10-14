/**
 * 질문 유형별 노출 카드(2026-10-14) — 메인 점수는 건드리지 않고, 이름 있는 질문과 이름 없이 추천을 묻는 질문을 나눠 센다.
 *
 * @vitest-environment jsdom
 */
import koDict from "@repo/internationalization/dictionaries/ko.json";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { QuestionTypeCard } from "../app/(authenticated)/components/question-type-card";
import {
  baselineStateOf,
  type QuestionTypeBreakdown,
  questionTypeBreakdown,
} from "../lib/brand/question-type-breakdown";

afterEach(cleanup);

const list = "추천:\n1. 라운드랩 - 크림\n2. 토리든 - 세럼\n3. 아누아 - 토너\n";
const brand = { name: "프롬맘" };
const row = (over: Record<string, unknown>) => ({
  engineId: "chatgpt",
  excerpt: "설명만 있는 답변입니다.",
  promptKind: "brand",
  promptText: "프롬맘이 뭐 하는 회사야?",
  brandMentioned: false,
  ...over,
});

/** 운영 실측 모양(2026-10-14 프롬맘 1회): AI 4곳 × (이름 질문 2 · 이름 없는 질문 6), 이름 질문은 8답변 중 4 노출, 이름 없는 질문은 24답변 중 0 노출. */
const productionShape = () => {
  const rows: unknown[] = [];
  const named = {
    chatgpt: [false, false],
    claude: [false, true],
    gemini: [true, true],
    perplexity: [false, true],
  };
  for (const [engineId, flags] of Object.entries(named)) {
    for (const [i, brandMentioned] of flags.entries()) {
      rows.push(
        row({ engineId, brandMentioned, promptText: `이름 질문 ${i}` })
      );
    }
  }
  for (const engineId of ["chatgpt", "claude", "gemini", "perplexity"]) {
    for (let i = 0; i < 6; i++) {
      rows.push(
        row({
          engineId,
          promptKind: "discovery",
          promptText: `추천 질문 ${i}`,
          excerpt: list,
        })
      );
    }
  }
  // 검색 엔진·실패·스텁은 세지 않는다.
  rows.push(
    row({
      engineId: "naver",
      promptKind: "discovery",
      promptText: "추천 질문 0",
    })
  );
  rows.push(
    row({
      engineId: "daum",
      promptKind: "discovery",
      promptText: "추천 질문 0",
    })
  );
  rows.push(
    row({
      engineId: "claude",
      promptKind: "discovery",
      promptText: "추천 질문 0",
      errorMessage: "429",
    })
  );
  rows.push(
    row({
      engineId: "gemini",
      promptKind: "discovery",
      promptText: "추천 질문 0",
      isStub: true,
    })
  );
  return {
    engineResponses: rows,
    measurementContext: { questionSetKey: "qs-A" },
  };
};

describe("questionTypeBreakdown", () => {
  it("운영 실측 모양: 이름 질문 8중 4(50%) · 이름 없는 질문 24중 0(0%)", () => {
    const b = questionTypeBreakdown(productionShape(), brand);
    expect(b?.named).toEqual({ answers: 8, mentioned: 4, ratePct: 50 });
    expect(b?.nameless).toEqual({ answers: 24, mentioned: 0, ratePct: 0 });
    expect(b?.questionSetKey).toBe("qs-A");
  });

  it("이름 없는 질문에서 AI 가 나열한 다른 브랜드의 평균 수(질문별)", () => {
    const b = questionTypeBreakdown(productionShape(), brand);
    expect(b?.competitorsListedAvg).toBeGreaterThanOrEqual(3);
  });

  it("이름 없는 질문 답변이 없으면 0/null", () => {
    const b = questionTypeBreakdown({ engineResponses: [row({})] }, brand);
    expect(b?.nameless).toEqual({ answers: 0, mentioned: 0, ratePct: null });
    expect(b?.competitorsListedAvg).toBeNull();
  });

  it("모양이 이상한 결과는 null(던지지 않는다)", () => {
    for (const bad of [
      null,
      undefined,
      "x",
      [],
      {},
      { engineResponses: "x" },
    ]) {
      expect(questionTypeBreakdown(bad, brand)).toBeNull();
    }
  });
});

describe("baselineStateOf — 같은 질문 세트일 때만 숫자를 비교한다", () => {
  const mk = (ratePct: number, key: string | null): QuestionTypeBreakdown => ({
    competitorsListedAvg: 3,
    named: { answers: 8, mentioned: 4, ratePct: 50 },
    nameless: { answers: 24, mentioned: 0, ratePct },
    questionSetKey: key,
  });
  it("첫 측정이거나 같은 측정이면 first", () => {
    expect(baselineStateOf(mk(0, "a"), null, true)).toEqual({ kind: "first" });
    expect(baselineStateOf(mk(0, "a"), mk(0, "a"), true)).toEqual({
      kind: "first",
    });
  });
  it("같은 질문 세트면 처음 대비 변화", () => {
    expect(baselineStateOf(mk(10, "a"), mk(0, "a"), false)).toEqual({
      kind: "same",
      fromPct: 0,
      toPct: 10,
    });
  });
  it("질문 세트가 다르거나 열쇠가 없으면 비교하지 않는다", () => {
    expect(baselineStateOf(mk(10, "b"), mk(0, "a"), false)).toEqual({
      kind: "changed",
    });
    expect(baselineStateOf(mk(10, null), mk(0, null), false)).toEqual({
      kind: "changed",
    });
  });
});

describe("QuestionTypeCard 화면", () => {
  const t = koDict.app.questionTypeCard;
  const data = questionTypeBreakdown(
    productionShape(),
    brand
  ) as QuestionTypeBreakdown;

  it("두 줄(이름 있는 질문 · 이름 없는 질문)과 개수·경쟁사 평균·기준선 문구를 보인다", () => {
    const s = render(
      <QuestionTypeCard
        baseline={{ kind: "first" }}
        baselineDate={null}
        data={data}
        t={t}
      />
    );
    s.getByText("우리 이름을 넣은 질문");
    s.getByText("이름 없이 추천을 묻는 질문");
    s.getByText("AI 답변 8개 중 4개에서 나옴");
    s.getByText("AI 답변 24개 중 0개에서 나옴");
    s.getByText(/다른 브랜드는 평균/);
    s.getByText(/이번이 첫 기준선이에요/);
  });

  it("처음 측정 대비 변화 / 질문이 바뀐 경우 문구", () => {
    const a = render(
      <QuestionTypeCard
        baseline={{ kind: "same", fromPct: 0, toPct: 8 }}
        baselineDate="2026-10-15"
        data={data}
        t={t}
      />
    );
    a.getByText("처음 측정(2026-10-15) 대비 이름 없는 질문 노출 0% → 8%");
    cleanup();
    const b = render(
      <QuestionTypeCard
        baseline={{ kind: "changed" }}
        baselineDate={null}
        data={data}
        t={t}
      />
    );
    b.getByText(/질문이 바뀌어서 처음 측정과 숫자로 비교할 수 없어요/);
  });
});
