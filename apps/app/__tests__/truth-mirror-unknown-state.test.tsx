/**
 * 「모름」 카드 0 결과 3요소 회귀 테스트 (2026-08-16 세션N-34 · H번 축소판).
 *
 * ⭐ 템플릿 = Scrunch f038: **①상태 이름 ②이유 ③행동**.
 *   경쟁사 4곳이 전부 0 결과에 침묵하는 자리라 우리 차별점이 된다(v4 §6).
 *
 * 🔬 **실측이 범위를 좁혔다**(완료 회차 95건 **전수**):
 *   · "측정 성공했는데 언급 0곳" 회차 = **0건** → 전면 0결과 화면은 만들지 않았다
 *   · 「모름」 카드는 **8회차(9%)에 10장** 뜬다. 그중 **6장이 daum**
 *   · 🔴 **8/8 회차에서 다른 엔진은 알고 있었다** → *"이 AI만 모른다"* 가 사실
 *
 * 🔴 **문구 하드코딩이 아니라 계약을 검사한다**: 3요소가 다 있는가 ·
 *   `knownCount 0` 일 때 **거짓말(다른 AI가 안다)을 하지 않는가**.
 *
 * @vitest-environment jsdom
 */

import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TruthMirror } from "../../web/app/[locale]/audit/[jobId]/components/truth-mirror";

afterEach(cleanup);

interface Row {
  brandMentioned: boolean;
  engineId: string;
  errorMessage: string | null;
  excerpt: string;
  isStub: boolean;
  mentionPosition: number | null;
  sentiment: "positive" | "neutral" | "negative" | null;
}

const row = (over: Partial<Row> & { engineId: string }): Row => ({
  brandMentioned: false,
  errorMessage: null,
  excerpt: "",
  isStub: false,
  mentionPosition: null,
  sentiment: null,
  ...over,
});

/** 실측 최빈 형태: daum 만 모르고 나머지는 안다(10장 중 6장이 daum). */
const REALISTIC = [
  row({
    engineId: "chatgpt",
    brandMentioned: true,
    excerpt: "메디큐브는…",
    sentiment: "positive",
  }),
  row({
    engineId: "claude",
    brandMentioned: true,
    excerpt: "메디큐브…",
    sentiment: "positive",
  }),
  row({
    engineId: "naver",
    brandMentioned: true,
    excerpt: "메디큐브…",
    sentiment: "neutral",
  }),
  row({ engineId: "daum" }),
];

describe("「모름」 카드 — 0 결과 3요소", () => {
  it("①상태 이름 ②이유 ③행동을 모두 준다", () => {
    const { container } = render(
      <TruthMirror brandName="메디큐브" engineResponses={REALISTIC} isKo />
    );
    const el = within(container);
    // ① 상태 — 점수가 아니라 상태를 말한다
    expect(el.getAllByText(/아직 우리를 모릅니다/).length).toBeGreaterThan(0);
    // ② 이유 — 다른 AI 3곳이 안다는 사실
    expect(
      el.getAllByText(/다른 AI 3곳은 이미 우리를 알고 있어요/).length
    ).toBeGreaterThan(0);
    // ③ 행동 — 다음에 뭘 볼지
    expect(el.getAllByText(/무엇부터 손볼지/).length).toBeGreaterThan(0);
  });

  it("🔴 아는 엔진이 0곳이면 '다른 AI가 안다'고 말하지 않는다", () => {
    // 실측상 안 생기는 조합이지만, 생기면 **거짓말**이 되므로 코드로 막는다.
    const allUnknown = [row({ engineId: "daum" }), row({ engineId: "naver" })];
    const { container } = render(
      <TruthMirror brandName="메디큐브" engineResponses={allUnknown} isKo />
    );
    const el = within(container);
    expect(el.getAllByText(/아직 우리를 모릅니다/).length).toBeGreaterThan(0);
    // 🔴 핵심: 없는 사실을 붙이지 않는다
    expect(container.textContent).not.toMatch(/다른 AI \d+곳은 이미/);
  });

  it("🔴 죽은 링크를 만들지 않는다 — 결과 페이지에 처방 앵커가 없다", () => {
    // `#actions` 앵커는 존재하지 않는다(`id=` 는 g-good·g-warn·g-bad 뿐).
    const { container } = render(
      <TruthMirror brandName="메디큐브" engineResponses={REALISTIC} isKo />
    );
    expect(container.querySelector('a[href="#actions"]')).toBeNull();
    expect(container.querySelector('a[href="#"]')).toBeNull();
  });

  it("🔴 `인용` 을 등장 뜻으로 쓰지 않는다 — 한 화면 안 용어 충돌", () => {
    // 이 배지는 `brandMentioned`(**답변 본문에 이름이 나왔나**)를 그리는데
    // 「인용됨」이라 부르고 있었다. 같은 페이지의 `naver-vs-ai-gap:240` 은
    // *"「인용」은 출처 링크를 뜻해 다른 지표"* 라며 그 단어를 금지한다.
    // 📕 정의는 `metric-dictionary.ts`(METRICS.sov vs METRICS.citation)가 단독으로 갖는다.
    const { container } = render(
      <TruthMirror brandName="메디큐브" engineResponses={REALISTIC} isKo />
    );
    expect(container.textContent).not.toMatch(/인용/);
    // 등장은 등장이라고 부른다.
    expect(container.textContent).toMatch(/말함/);
  });

  it("순위 배지도 `인용` 이 아니라 등장으로 말한다", () => {
    const ranked = [
      row({
        engineId: "chatgpt",
        brandMentioned: true,
        excerpt: "…",
        mentionPosition: 1,
      }),
      row({ engineId: "daum" }),
    ];
    const { container } = render(
      <TruthMirror brandName="메디큐브" engineResponses={ranked} isKo />
    );
    expect(container.textContent).toMatch(/1번째로 말함/);
    expect(container.textContent).not.toMatch(/1위 인용/);
  });

  it("아는 엔진 카드는 원문을 그대로 보여준다(모름 문구가 새지 않는다)", () => {
    const { container } = render(
      <TruthMirror brandName="메디큐브" engineResponses={REALISTIC} isKo />
    );
    // 모름 카드는 daum 1장뿐 → 상태 문구도 1번만 나와야 한다
    const hits = container.textContent?.match(/아직 우리를 모릅니다/g) ?? [];
    expect(hits).toHaveLength(1);
  });
});
