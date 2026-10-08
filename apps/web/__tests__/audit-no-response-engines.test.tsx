import { summarizeAnswerBuckets } from "@repo/audit/answer-buckets";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ko from "../../../packages/internationalization/dictionaries/ko.json";
import { AnswerBucketBoard } from "../app/[locale]/audit/[jobId]/components/answer-buckets";

// 늦은 엔진 반영(2026-10-07 · 설계 B) — 다시 물어도 끝내 답이 없던 칸은 분모에서 빠지고
// (「측정 실패」 칸), 화면이 **어느 AI 가 답하지 않았는지 이름으로** 말한다.

const answered = (engineId: string, promptIndex: number) => ({
  engineId,
  promptIndex,
  promptKind: "brand" as const,
  brandMentioned: true,
  mentionQuality: "confirmed",
  errorMessage: null,
  isStub: false,
  excerpt: "synthetic answer",
});

const rows = [
  answered("chatgpt", 0),
  answered("claude", 0),
  {
    ...answered("gemini", 0),
    brandMentioned: false,
    errorMessage: "Engine gemini timed out after 200000ms",
    lateCell: "final_failed",
  },
  // 검색 노출·이름 없는 질문의 실패는 AI 이름 줄에 넣지 않는다(4칸과 같은 범위).
  { ...answered("daum", 0), errorMessage: "daum failed" },
  {
    ...answered("perplexity", 1),
    promptKind: "discovery" as const,
    errorMessage: "429 Too Many Requests",
  },
];

const render = (copy?: string) =>
  renderToStaticMarkup(
    <AnswerBucketBoard
      isKo
      noResponseCopy={copy}
      noResponseRows={rows}
      summary={summarizeAnswerBuckets(rows)}
    />
  );

describe("no-response engines line", () => {
  it("names the AI engine that never answered", () => {
    const html = render(ko.web.audit.noResponseEngines);
    expect(html).toContain('data-testid="no-response-engines"');
    expect(html).toContain("답을 받지 못한 AI: Gemini");
    expect(html).not.toContain("Perplexity");
    expect(html).not.toContain("답을 받지 못한 AI: 다음");
  });

  it("stays silent without the dictionary copy or without failures", () => {
    expect(render()).not.toContain("no-response-engines");
    const html = renderToStaticMarkup(
      <AnswerBucketBoard
        isKo
        noResponseCopy={ko.web.audit.noResponseEngines}
        noResponseRows={[answered("chatgpt", 0)]}
        summary={summarizeAnswerBuckets([answered("chatgpt", 0)])}
      />
    );
    expect(html).not.toContain("no-response-engines");
  });
});
