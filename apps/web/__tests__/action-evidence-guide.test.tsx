import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActionGuide } from "@repo/audit/action-rules";
import { ActionEvidenceGuide } from "../app/[locale]/audit/[jobId]/components/action-evidence-guide";

const guide: ActionGuide = {
  evidenceGrade: "medium",
  sources: [{ label: "출처 A", url: "https://example.com/a" }],
  engines: ["google"],
  effortHours: { min: 2, max: 4, per: "total" },
  effectLag: "며칠~몇 주",
  remeasureMetric: "공식 사이트 인용 수",
  failCondition: "다음 측정으로 확인",
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
});
