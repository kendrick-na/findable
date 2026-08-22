/**
 * 🔬 **액션 가이드 전수조사**(N-45 · 👤 *"실제 진단 및 향상 액션 가이드가 명확히
 * 잘 작동하는지 전수조사해"*).
 *
 * 배경: `/actions` 는 이 제품의 **핵심 가치**다(경쟁사 1위 불만 = *"진단만 하고 처방 없음"*).
 * 그런데 액션 5종이 **각 상황에서 맞게 나오는지** 검증하는 테스트가 없었다
 * (기존 테스트 2개는 시장적합·완료키만 본다).
 *
 * 이 파일이 검사하는 것 — **읽는 사람 기준**:
 *   ① 상황에 맞는 액션이 나오는가(0건 · 일부 · 전부 인지)
 *   ② 그 문장이 **행동 가능한가**(무엇을·어디에·왜)
 *   ③ **근거가 붙는가**(이 저장소는 근거 없는 숫자를 금지한다)
 *   ④ 숫자가 **입력과 일치하는가**(지어내지 않는가)
 */

import { buildGeoActions } from "@repo/audit/actions";
import { describe, expect, it } from "vitest";

type Input = Parameters<typeof buildGeoActions>[0];

const base: Input = {
  averageMentionPosition: 2.5,
  brandName: "설화수",
  enginesMeasured: 7,
  enginesMentioned: 7,
  prompts: [
    { hit: 7, text: "설화수 추천해줘", total: 7 },
    { hit: 6, text: "설화수와 같은 카테고리 인기 브랜드 5가지", total: 7 },
  ],
  sourceMix: { community: 40, media: 10, other: 5, owned: 2, reference: 3 },
  topDomains: [
    { count: 40, domain: "blog.naver.com", owned: false },
    { count: 2, domain: "sulwhasoo.com", owned: true },
  ],
};

describe("액션 가이드 — 상황별로 맞는 처방이 나온다", () => {
  it("🔴 **아무도 모를 때**: 「모른다」는 사실을 말하고 처방을 준다", () => {
    const actions = buildGeoActions({
      ...base,
      averageMentionPosition: null,
      enginesMentioned: 0,
      prompts: [{ hit: 0, text: "설화수 추천해줘", total: 7 }],
    });
    expect(actions.length).toBeGreaterThan(0);
    const first = actions[0];
    // 0건일 때 「문장 품질을 높이세요」라고 하면 헛다리다 — 읽히지도 않는 상태다.
    expect(first?.evidence).toMatch(/어디도|인지하지 못/);
    // ⛔ 숫자를 지어내지 않는다: 분모는 입력값이어야 한다.
    expect(first?.evidence).toContain("7곳");
  });

  it("🔴 **전부 알 때**: 인지 단계가 아니라 **문장 품질**로 넘어간다", () => {
    const actions = buildGeoActions(base);
    const content = actions.find((a) => /근거 문장|인용/.test(a.title));
    expect(content, "전부 인지하는데 문장 품질 액션이 없다").toBeTruthy();
    expect(content?.evidence).toContain("7곳 중 7곳");
  });

  it("🔴 **질문별 갭**: 놓치는 질문을 **그 질문 문구로** 짚는다", () => {
    const actions = buildGeoActions(base);
    const gap = actions.find((a) => a.kind === "prompt_gap");
    expect(gap, "언급 6/7 인 질문이 있는데 갭 액션이 없다").toBeTruthy();
    // 어느 질문인지 그대로 보여야 고객이 찾아갈 수 있다.
    expect(gap?.title).toContain("같은 카테고리 인기 브랜드");
    // 놓친 비율이 실제 계산과 맞아야 한다(7 중 6 → 14%).
    expect(gap?.title).toMatch(/14%/);
  });

  it("⛔ **빠짐없는 질문은 갭으로 만들지 않는다** (없는 문제를 만들지 않는다)", () => {
    const actions = buildGeoActions({
      ...base,
      prompts: [{ hit: 7, text: "설화수 추천해줘", total: 7 }],
    });
    const gaps = actions.filter((a) => a.kind === "prompt_gap");
    expect(gaps, "전부 언급된 질문을 갭이라 부른다").toHaveLength(0);
  });

  it("🔴 **출처 편중**: 도메인을 **이름으로** 짚는다 (「커뮤니티 50%」로 뭉개지 않는다)", () => {
    const actions = buildGeoActions(base);
    const portfolio = actions.find((a) => a.kind === "source_portfolio");
    expect(portfolio, "출처가 편중인데 포트폴리오 액션이 없다").toBeTruthy();
    // 고객이 바로 가서 확인할 수 있어야 한다.
    expect(
      `${portfolio?.title}${portfolio?.how}${portfolio?.evidence}`
    ).toContain("blog.naver.com");
  });

  it("🔴 **하지 말 것**이 항상 있다 (효과 없는 통설을 막는다)", () => {
    const actions = buildGeoActions(base);
    const avoid = actions.find((a) => a.kind === "avoid");
    expect(avoid, "「하지 마세요」 액션이 없다").toBeTruthy();
    // 이 저장소는 llms.txt·키워드반복을 **효과 없음**으로 판정했다(실측 근거 보유).
    expect(`${avoid?.how}`).toMatch(/llms\.txt|키워드/);
  });

  it("⛔ **모든 액션에 근거가 붙는다** (근거 없는 숫자 금지)", () => {
    for (const input of [
      base,
      { ...base, enginesMentioned: 0, averageMentionPosition: null },
      { ...base, sourceMix: undefined, topDomains: undefined },
    ] as Input[]) {
      for (const a of buildGeoActions(input)) {
        expect(a.evidence, `근거 없는 액션: ${a.title}`).toBeTruthy();
        expect(a.evidence.length).toBeGreaterThan(5);
        // 처방이 비면 "그래서 뭘 하라고?"에 답하지 못한다.
        expect(a.how, `처방 없는 액션: ${a.title}`).toBeTruthy();
        expect(a.how.length).toBeGreaterThan(10);
      }
    }
  });

  it("⛔ **입력이 부실해도 죽지 않는다** (신규 고객은 데이터가 없다)", () => {
    const actions = buildGeoActions({
      averageMentionPosition: null,
      brandName: "테스트",
      enginesMeasured: 0,
      enginesMentioned: 0,
    });
    // 빈 배열이어도 괜찮다 — 던지지만 않으면 된다.
    expect(Array.isArray(actions)).toBe(true);
  });

  it("⛔ 액션이 **너무 많지 않다** (다 하라면 아무것도 안 한다)", () => {
    const actions = buildGeoActions({
      ...base,
      prompts: Array.from({ length: 20 }, (_, i) => ({
        hit: 1,
        text: `질문${i}`,
        total: 7,
      })),
    });
    expect(actions.length).toBeLessThanOrEqual(6);
  });
});
