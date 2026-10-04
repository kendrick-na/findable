/** @vitest-environment jsdom */

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@repo/analytics", () => ({
  analytics: { capture: vi.fn() },
}));
vi.mock("@repo/analytics/funnel", () => ({
  trackAuditCompleted: vi.fn(),
  trackCrewTriggered: vi.fn(),
  trackReportViewed: vi.fn(),
}));
vi.mock("@repo/design-system/components/ui/button", () => ({
  Button: ({
    asChild: _asChild,
    children,
    ...props
  }: { asChild?: boolean; children?: ReactNode }) =>
    <button {...props}>{children}</button>,
}));
vi.mock(
  "../app/[locale]/audit/[jobId]/components/answer-buckets",
  () => ({
    AnswerBucketBoard: () => <div />,
    AnswerBucketPill: () => <div />,
    BrandNameMismatchNotice: () => null,
    QuestionEngineMatrix: () => <div />,
  })
);
vi.mock(
  "../app/[locale]/audit/[jobId]/components/competitor-benchmark",
  () => ({ CompetitorBenchmark: () => <div /> })
);
vi.mock(
  "../app/[locale]/audit/[jobId]/components/naver-vs-ai-gap",
  () => ({ NaverVsAiGap: () => <div /> })
);
vi.mock(
  "../app/[locale]/audit/[jobId]/components/provisional-evidence-view",
  () => ({ ProvisionalEvidenceView: () => <div /> })
);
vi.mock(
  "../app/[locale]/audit/[jobId]/components/truth-mirror",
  () => ({ TruthMirror: () => <div /> })
);

import { AuditResultView } from "../app/[locale]/audit/[jobId]/components/audit-result";

const newAction = {
  evidence: "현재 측정에서 네이버 검색 노출이 확인되지 않았습니다.",
  guide: {
    evidenceGrade: "medium",
    engines: ["naver"],
    effectLag: "게시 후 며칠~몇 주",
    effortHours: { min: 2, max: 4, per: "total" },
    remeasureMetric: "같은 질문에서 네이버 검색 노출이 확인된 질문 수",
    failCondition: "다음 측정에서도 노출이 확인되지 않으면 재점검",
    notGuaranteed: "게시한다고 네이버 검색 노출이 보장되지는 않습니다.",
    sources: [{ label: "출처 A", url: "https://example.com/a" }],
  },
  how: "질문에 답하는 페이지를 게시하세요.",
  kind: "naver_blog",
  priority: 3,
  source: "Findable 측정",
  title: "네이버 검색에 잡힐 글을 올리세요",
  verification: "같은 질문에 네이버 검색 노출이 있었는지 확인하세요.",
  where: "네이버 블로그(회사 공식 계정)",
};

const storedLegacyAction = {
  kind: "naver_blog",
  title: "네이버 블로그에 꾸준히 글을 올리세요",
  evidence: "기존 측정 근거",
  how: "기존 실행 방법",
  verification:
    "다음 측정에서 네이버·네이버 AI 브리핑·HyperCLOVA X 답변이 우리를 알아봤는지 보세요.",
  source: "근거 약함 · 기존 출처",
  priority: 2,
  guide: {
    evidenceGrade: "weak",
    engines: ["naver", "naver-briefing", "hyperclova"],
    effectLag: "게시 후 몇 주~몇 달",
    effortHours: { min: 1, max: 2, per: "week" },
    remeasureMetric: "AI가 제대로 알아본 답변 수",
    failCondition: "네이버 계열 답변에서 알아본 답변이 0건이면 재점검",
    notGuaranteed: "매주 올리면 네이버 AI 브리핑에 인용된다는 근거는 없습니다.",
    sources: [{ label: "기존 출처", url: "https://example.com/legacy" }],
  },
};

const response = {
  completedAt: "2026-10-04T00:00:00.000Z",
  createdAt: "2026-10-04T00:00:00.000Z",
  crewCompletedAt: null,
  crewResult: null,
  crewStartedAt: null,
  crewStatus: "not_requested",
  domain: "example.com",
  emailDomain: null,
  emailMasked: null,
  errorMessage: null,
  history: null,
  isWorkspaceAudit: false,
  jobId: "fixture-job",
  language: "both",
  pdfOutdated: false,
  pdfUrl: null,
  result: {
    brandName: "Example",
    domain: "example.com",
    mentionVerdictVersion: 2,
    engineResponses: [
      ...Array.from({ length: 10 }, (_, index) => ({
        engineId: "chatgpt",
        brandMentioned: true,
        mentionPosition: 1,
        sentiment: "neutral" as const,
        sov: 1,
        durationMs: 10,
        isStub: false,
        errorMessage: null,
        excerpt: "Example is a brand.",
        mentionQuality: "confirmed",
        promptIndex: index,
        promptKind: "brand" as const,
        promptText: `What is Example ${index}?`,
      })),
      {
        engineId: "naver",
        brandMentioned: false,
        mentionPosition: null,
        sentiment: null,
        sov: null,
        durationMs: 10,
        isStub: false,
        errorMessage: null,
        excerpt: "검색 결과가 없습니다.",
        promptIndex: 0,
        promptKind: "brand",
        promptText: "Example 추천",
      },
    ],
    geoActions: [newAction, storedLegacyAction],
    metrics: {
      answerBuckets: undefined,
      averageMentionPosition: 1,
      enginesCovered: ["chatgpt", "naver"],
      enginesWithMention: ["chatgpt"],
      errors: [],
      sentimentDistribution: { positive: 0, neutral: 1, negative: 0 },
      sov: 50,
      stubCount: 0,
      topCitedDomains: [],
      unverifiedCount: 0,
      verifiedCount: 1,
    },
    promptsCount: 2,
    topRecommendations: [],
  },
  status: "completed",
};

let root: ReturnType<typeof createRoot> | undefined;

async function waitForText(container: HTMLElement, text: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (container.textContent?.includes(text)) {
      return;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  vi.restoreAllMocks();
});

describe("실제 AuditResultView의 API 응답→액션 카드 렌더", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      )
    );
  });

  it("네이버 검색 노출을 무료 업셀의 AI 엔진 수에 넣지 않는다", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(() => {
      root?.render(<AuditResultView jobId="fixture-job" locale="ko" />);
    });
    await waitForText(container, "네이버 검색에 잡힐 글을 올리세요");
    expect(container.textContent).toContain(
      "이번 측정에서 AI 1곳 모두가 우리를 알아봤어요"
    );
    expect(container.textContent).not.toContain("AI 2곳 중 1곳");
  });

  it.each([
    ["ko", "적용 채널", "네이버 검색 노출", "수정 위치", "검증 방법", "근거 보통"],
    ["en", "Measurement channels", "Naver search exposure", "Where to change", "How to verify", "Evidence: medium"],
  ])(
    "%s에서 신규·저장 action data가 실제 카드로 매핑된다",
    async (locale, channelLabel, naverLabel, whereLabel, verifyLabel, gradeLabel) => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root?.render(<AuditResultView jobId="fixture-job" locale={locale} />);
      });
      await waitForText(container, "네이버 검색에 잡힐 글을 올리세요");
      const html = container.textContent ?? "";
      const actionSection = Array.from(container.querySelectorAll("section")).find(
        (section) =>
          section.textContent?.includes("그래서 뭘 하면 되나") ||
          section.textContent?.includes("What to actually do")
      );
      const actionHtml = actionSection?.textContent ?? "";
      expect(html).toContain("네이버 검색에 잡힐 글을 올리세요");
      expect(actionSection).toBeTruthy();
      expect(actionHtml).toContain("네이버 블로그에 꾸준히 글을 올리세요");
      expect(actionHtml).toContain(channelLabel);
      expect(actionHtml).toContain(naverLabel);
      expect(actionHtml).toContain(whereLabel);
      expect(actionHtml).toContain(verifyLabel);
      expect(actionHtml).toContain(gradeLabel);
      expect(actionHtml).toMatch(/do not prove an effect|효과를 입증하지 않습니다/);
      expect(actionHtml).not.toContain("Naver AI Briefing");
      expect(actionHtml).not.toContain("HyperCLOVA X");
    }
  );
});
