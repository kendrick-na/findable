import { summarizeAnswerBuckets } from "@repo/audit/answer-buckets";
import { askedDiscoveryQuestionCount } from "@repo/audit/question-coverage";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../packages/internationalization/dictionaries/en.json";
import ko from "../../../packages/internationalization/dictionaries/ko.json";
import { AnswerBucketBoard } from "../app/[locale]/audit/[jobId]/components/answer-buckets";

// 이름 없는 질문이 질문 시작 마감으로 잘렸을 때의 한 줄(2026-10-06 · 문구 승인 대기).

const discoveryRow = (promptIndex: number, engineId = "chatgpt") => ({
  engineId,
  promptIndex,
  promptText: `discovery-${promptIndex}`,
  promptKind: "discovery" as const,
  brandMentioned: true,
  mentionQuality: "confirmed",
  errorMessage: null,
  isStub: false,
});

const render = (
  rows: ReturnType<typeof discoveryRow>[],
  planned: number,
  copy = ko.web.audit.discoveryCoverage,
  isKo = true
) =>
  renderToStaticMarkup(
    <AnswerBucketBoard
      discoveryAskedCount={askedDiscoveryQuestionCount(rows)}
      discoveryCoverageCopy={copy}
      discoveryPromptCount={planned}
      isKo={isKo}
      summary={summarizeAnswerBuckets(rows)}
    />
  );

describe("discovery truncation line", () => {
  it("counts asked questions, not engine answers", () => {
    expect(
      askedDiscoveryQuestionCount([
        discoveryRow(5),
        discoveryRow(5, "claude"),
        discoveryRow(6),
        { engineId: "chatgpt", promptIndex: 1, promptKind: "brand" },
      ])
    ).toBe(2);
  });

  it("says how many of the planned questions were measured when some were cut", () => {
    const html = render([discoveryRow(6), discoveryRow(6, "claude")], 2);
    expect(html).toContain("이름 없이 물었을 때 추천됨 2/2");
    expect(html).toContain("질문 2개 중 1개만 측정했어요.");
  });

  it("keeps the line when none were measured", () => {
    const html = render([], 2);
    expect(html).toContain("이름 없이 물었을 때 추천됨");
    expect(html).toContain("이번에는 측정하지 못했어요.");
  });

  it("adds nothing when every planned question ran", () => {
    const html = render([discoveryRow(6), discoveryRow(7)], 2);
    expect(html).not.toContain("측정했어요");
    expect(html).not.toContain("측정하지 못했어요");
  });

  it("uses the English dictionary copy", () => {
    const html = render(
      [discoveryRow(6)],
      2,
      en.web.audit.discoveryCoverage,
      false
    );
    expect(html).toContain("Only 1 of 2 questions were measured.");
    expect(render([], 1, en.web.audit.discoveryCoverage, false)).toContain(
      "Not measured this time."
    );
  });
});
