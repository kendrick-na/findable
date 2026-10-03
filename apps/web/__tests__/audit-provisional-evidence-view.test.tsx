import { summarizeAnswerBuckets } from "@repo/audit/answer-buckets";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("../app/[locale]/audit/[jobId]/components/answer-buckets", () => ({
  AnswerBucketBoard: () => <div data-testid="answer-bucket-board" />,
  QuestionEngineMatrix: ({ rows }: { rows: unknown[] }) => (
    <div data-testid="question-engine-matrix">원문 {rows.length}행</div>
  ),
}));

import { ProvisionalEvidenceView } from "../app/[locale]/audit/[jobId]/components/provisional-evidence-view";

it("shows brand AI and search counts separately without a mixed provisional score", () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, index) => ({
      engineId: "chatgpt",
      promptText: `brand-${index}`,
      promptKind: "brand" as const,
      brandMentioned: false,
      mentionQuality: "absent",
      errorMessage: null,
      isStub: false,
      excerpt: "synthetic AI answer",
    })),
    ...Array.from({ length: 14 }, (_, index) => ({
      engineId: index % 2 === 0 ? "naver" : "daum",
      promptText: `brand-${index}`,
      promptKind: "brand" as const,
      brandMentioned: false,
      mentionQuality: "absent",
      errorMessage: null,
      isStub: false,
      excerpt: "synthetic search result",
    })),
  ];
  const html = renderToStaticMarkup(
    <ProvisionalEvidenceView
      brandName="Synthetic"
      discoveryPromptCount={0}
      domain="example.test"
      isKo
      rows={rows as never}
      summary={summarizeAnswerBuckets(rows)}
    />
  );

  expect(html).toContain("브랜드 질문 AI 확정 답변 8건");
  expect(html).toContain("검색 노출 14건");
  expect(html).toContain("원문 22행");
  expect(html).not.toContain("확정 답변 22건");
  expect(html).not.toContain("참고 · GEO 종합 점수");
  expect(html).not.toContain("잠정 점수");
});

it("explains incomplete questions and an unverifiable historical plan without publishing a score", () => {
  for (const [issue, explanation] of [
    ["incomplete_execution", "질문 측정이 미완료됐습니다"],
    ["question_plan_unverified", "질문 계획을 확인할 수 없어"],
  ] as const) {
    const html = renderToStaticMarkup(
      <ProvisionalEvidenceView
        brandName="Synthetic"
        domain="example.test"
        isKo
        issue={issue}
        rows={[]}
        summary={summarizeAnswerBuckets([])}
      />
    );
    expect(html).toContain(explanation);
    expect(html).toContain("점수 보류");
  }
});
