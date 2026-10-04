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
