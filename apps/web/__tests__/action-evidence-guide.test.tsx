import { createElement } from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActionGuide } from "@repo/audit/action-rules";
import { ActionEvidenceGuide } from "../app/[locale]/audit/[jobId]/components/action-evidence-guide";
import {
  ActionDetails,
  ActionLead,
} from "../app/[locale]/audit/[jobId]/components/action-teaser-cards";

const guide: ActionGuide = {
  evidenceGrade: "medium",
  sources: [{ label: "출처 A", url: "https://example.com/a" }],
  engines: ["google"],
  effortHours: { min: 2, max: 4, per: "total" },
  effectLag: "며칠~몇 주",
  remeasureMetric: "공식 사이트 인용 수",
  failCondition: "다음 측정으로 확인",
};
const naverGuide = { ...guide, engines: ["naver"] };
const action = {
  evidence: "측정 근거",
  guide,
  how: "한 문장 실행 방법",
  kind: "naver_blog",
  priority: 3 as const,
  source: "근거 약함 · 출처",
  title: "네이버 검색에 잡힐 글을 올리세요",
  verification: "같은 질문에 네이버 검색 노출이 있었는지 확인하세요.",
  where: "네이버 블로그(회사 공식 계정)",
};

describe("웹 ActionEvidenceGuide", () => {
  it("SSR에 내부 기준·추정 각주와 새 라벨을 표시한다", () => {
    const html = renderToStaticMarkup(
      createElement(ActionEvidenceGuide, { guide })
    );
    expect(html).toContain("예상 작업 시간");
    expect(html).toContain("재점검 조건");
    expect(html).toContain(
      "Findable 내부 운영 기준·추정이며 효과를 입증하지 않습니다"
    );
    expect(html).toContain("며칠~몇 주");
  });

  it("무료 결과의 lead/rest가 locale을 가이드에 전달한다", () => {
    const resultSource = readFileSync(
      fileURLToPath(
        new URL(
          "../app/[locale]/audit/[jobId]/components/audit-result.tsx",
          import.meta.url
        )
      ),
      "utf8"
    );
    expect(resultSource).toContain(
      "<TeaserActionLead action={lead} isKo={isKo} />"
    );
    expect(resultSource).toContain(
      "<TeaserActionDetails"
    );
  });

  it("영어 locale에서 가이드의 UI chrome을 영어로 렌더한다", () => {
    const html = renderToStaticMarkup(
      createElement(ActionEvidenceGuide, { guide, isKo: false })
    );
    expect(html).toContain("Estimated work time");
    expect(html).toContain("Recheck condition");
    expect(html).toContain("Work time, remeasurement timing");
    expect(html).toContain("Google Search (AI features)");
    expect(html).toContain("about 2-4 hours");
    expect(html).toContain("Stored Korean rule: 며칠~몇 주");
    expect(html).not.toContain("예상 작업 시간");
  });

  it("네이버를 AI가 아닌 검색 노출 채널로 실제 렌더한다", () => {
    const ko = renderToStaticMarkup(
      createElement(ActionEvidenceGuide, { guide: naverGuide })
    );
    const en = renderToStaticMarkup(
      createElement(ActionEvidenceGuide, { guide: naverGuide, isKo: false })
    );
    expect(ko).toContain("적용 채널");
    expect(ko).toContain("네이버 검색 노출");
    expect(ko).not.toContain("적용되는 AI");
    expect(en).toContain("Measurement channels");
    expect(en).toContain("Naver search exposure");
  });

  it("실제 lead/rest 컴포넌트가 ko/en 모두 위치·검증·가이드를 렌더한다", () => {
    for (const isKo of [true, false]) {
      const leadHtml = renderToStaticMarkup(
        createElement(ActionLead, { action, isKo })
      );
      const restHtml = renderToStaticMarkup(
        createElement(ActionDetails, { action, index: 2, isKo })
      );
      for (const html of [leadHtml, restHtml]) {
        expect(html).toContain(isKo ? "수정 위치" : "Where to change");
        expect(html).toContain(isKo ? "검증 방법" : "How to verify");
        expect(html).toContain(isKo ? "예상 작업 시간" : "Estimated work time");
        expect(html).toContain("네이버 검색");
      }
    }
  });
});
