import { expect, it } from "vitest";
import { extractPerplexitySources } from "./utils";
import { parseAnthropicMessages } from "./global-adapters";

it("keeps Claude search results separate from citations attached to answer text", () => {
  expect(
    parseAnthropicMessages({
      content: [
        {
          type: "web_search_tool_result",
          content: [{ url: "https://namesake.example/" }],
        },
        {
          type: "text",
          text: "The official product",
          citations: [{ url: "https://official.example/" }],
        },
      ],
    })
  ).toEqual({
    text: "The official product",
    sources: [
      { sourceType: "url", url: "https://official.example/", title: undefined },
    ],
  });
});

it("does not promote search candidates to citations", () => {
  expect(
    extractPerplexitySources({
      search_results: [{ url: "https://namesake.example/" }],
    })
  ).toEqual([]);
});
it("uses citation URLs and only enriches their matching metadata", () => {
  expect(
    extractPerplexitySources({
      citations: ["https://official.example/"],
      search_results: [
        { url: "https://namesake.example/", title: "Unrelated" },
        { url: "https://official.example/", title: "Official" },
      ],
    })
  ).toEqual([
    {
      url: "https://official.example/",
      domain: "official.example",
      title: "Official",
    },
  ]);
});
