/**
 * @vitest-environment jsdom
 *
 * 「네이버 AI 브리핑 × 글로벌 AI」 카드 (2026-09-29) — 국내 쪽은 네이버가 직접 만든 AI 답
 * (브리핑)뿐이다. 종료된 HyperCLOVA X 를 「국내 AI 채널」로 내세우면 사실 오류다.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NaverVsAiGap } from "../../web/app/[locale]/audit/[jobId]/components/naver-vs-ai-gap";

afterEach(cleanup);

const row = (
  engineId: string,
  brandMentioned: boolean,
  errorMessage: string | null = null
) => ({
  engineId,
  brandMentioned,
  errorMessage,
  isStub: false,
  mentionPosition: null,
  mentionListSize: null,
});

const global = [
  row("chatgpt", false),
  row("claude", false),
  row("gemini", true),
  row("perplexity", true),
];

describe("NaverVsAiGap", () => {
  it("🔴 브리핑 답이 없으면 카드를 그리지 않는다 — 과거 HyperCLOVA 행이 있어도", () => {
    const { container } = render(
      <NaverVsAiGap
        engineResponses={[
          ...global,
          row("hyperclova", false),
          row("naver", false),
        ]}
        isKo
      />
    );
    expect(container.textContent).toBe("");
  });

  it("브리핑이 미노출(오류)이면 비교할 답이 없어 숨긴다", () => {
    const { container } = render(
      <NaverVsAiGap
        engineResponses={[
          ...global,
          row(
            "naver-briefing",
            false,
            "AI 브리핑 미노출 — 이 질의에는 표시되지 않습니다"
          ),
        ]}
        isKo
      />
    );
    expect(container.textContent).toBe("");
  });

  it("브리핑 답이 있으면 국내 쪽은 「네이버 AI 브리핑」이고 HyperCLOVA 는 나오지 않는다", () => {
    const { container } = render(
      <NaverVsAiGap
        engineResponses={[
          ...global,
          row("naver-briefing", false),
          row("hyperclova", true),
        ]}
        isKo
      />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("네이버 AI 브리핑");
    expect(text).not.toMatch(/HyperCLOVA|하이퍼클로바/);
    expect(text).toContain("언급 0 / 측정 1");
  });
});
