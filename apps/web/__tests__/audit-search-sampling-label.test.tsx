import { summarizeAnswerBuckets } from "@repo/audit/answer-buckets";
import { searchSamplingVersionOf } from "@repo/audit/search-sampling-version";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AnswerBucketBoard,
  QuestionEngineMatrix,
} from "../app/[locale]/audit/[jobId]/components/answer-buckets";

function naverRow(version?: string) {
  return {
    brandMentioned: false,
    engineId: "naver",
    errorMessage: null,
    excerpt: "검색 결과",
    isStub: false,
    mentionQuality: "absent",
    naverSource: "search_results",
    promptKind: "brand" as const,
    promptText: "Example 추천",
    ...(version ? { naverSamplingVersion: version } : {}),
  };
}

describe("Naver search sampling version label", () => {
  it("labels new search exposure as sample v2 next to the value and in the legend", () => {
    const rows = [naverRow("interleave-v1")];
    const summary = summarizeAnswerBuckets(rows, {
      brandDomain: "example.com",
    });
    const html = renderToStaticMarkup(
      <>
        <AnswerBucketBoard
          isKo
          searchSamplingVersion={searchSamplingVersionOf({
            engineResponses: rows,
          })}
          summary={summary}
        />
        <QuestionEngineMatrix isKo rows={rows} />
      </>
    );
    expect(html).toContain('data-testid="search-sampling-label"');
    expect(html).toContain("검색 표본 v2");
    expect(html).toContain(
      "표본 방식이 다른 회차와는 검색 노출 수를 비교하지 않아요"
    );
  });

  it("labels unmarked rows as the previous method (v1), not as v2", () => {
    const rows = [naverRow()];
    const summary = summarizeAnswerBuckets(rows, {
      brandDomain: "example.com",
    });
    const html = renderToStaticMarkup(
      <AnswerBucketBoard
        isKo={false}
        searchSamplingVersion={searchSamplingVersionOf({
          engineResponses: rows,
        })}
        summary={summary}
      />
    );
    expect(html).toContain("Search sample v1");
    expect(html).not.toContain("Search sample v2");
  });
});
