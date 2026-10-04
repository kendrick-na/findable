import { summarizeAnswerBuckets } from "@repo/audit/answer-buckets";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { QuestionEngineMatrix } from "../app/[locale]/audit/[jobId]/components/answer-buckets";

it("does not give an unbranded search result an AI verdict badge", () => {
  const html = renderToStaticMarkup(
    <QuestionEngineMatrix
      isKo
      rows={[
        {
          brandMentioned: true,
          engineId: "naver",
          errorMessage: null,
          excerpt: "Example brand appears in a search result",
          isStub: false,
          mentionQuality: "confirmed",
          naverSource: "search_results",
          promptKind: "discovery",
          promptText: "추천 서비스를 알려줘",
        },
      ]}
    />
  );

  expect(html).toContain("집계 제외 · 이름 없는 검색");
  expect(html).not.toContain('data-bucket="confirmed"');
  expect(html).not.toContain("제대로 앎");
});

it("uses official-domain exposure, not mention text, for a legacy Naver row", () => {
  const row = {
    brandMentioned: true,
    citedSources: [{ domain: "other.example", url: "https://other.example" }],
    engineId: "naver",
    errorMessage: null,
    excerpt: "Example brand appears in Findable's historical synthesis",
    isStub: false,
    mentionQuality: "confirmed",
    naverSource: null,
    promptKind: "brand" as const,
    promptText: "Example은 무엇인가요?",
  };
  const summary = summarizeAnswerBuckets([row], {
    brandDomain: "example.test",
  });
  const html = renderToStaticMarkup(
    <QuestionEngineMatrix brandDomain="example.test" isKo rows={[row]} />
  );

  expect(summary.search?.confirmed).toBe(0);
  expect(summary.search?.unknown).toBe(1);
  expect(html).toContain("검색 노출: 공식 도메인 없음");
  expect(html).not.toContain('data-bucket="confirmed"');
  expect(html).not.toContain("제대로 앎");
});
