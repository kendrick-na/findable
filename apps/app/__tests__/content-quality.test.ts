import { checkContentQuality } from "@repo/audit/content-quality";
import { describe, expect, it } from "vitest";

const groundedBody = `최근 측정에서 AI 엔진 7곳 중 4곳이 브랜드를 언급했습니다. 이 수치는 2026-08-22 측정 표본에만 해당합니다.

## 측정 근거

Findable 측정 데이터가 근거이며 시장 전체 결과로 일반화하지 않습니다. 같은 질문과 엔진을 사용해야 다음 측정과 비교할 수 있습니다.

## 무엇을 고쳐야 하나

독자가 묻는 질문에 첫 문단에서 직접 답하고, 확인 가능한 수치와 조건을 이어서 적습니다. 제품 범위와 예외를 함께 밝히면 정보가 잘못 인용될 가능성을 줄일 수 있습니다.

## 실행 순서

공식 소개 페이지의 핵심 문장을 먼저 정리합니다. 주장마다 측정일과 원출처를 붙입니다. 여러 페이지에서 서로 다른 설명을 쓰고 있다면 최신 사실을 기준으로 통일합니다. 검색 순위 상승을 보장하는 표현은 쓰지 않습니다.

## 다음 측정

발행 후 같은 질문을 다시 실행해 언급 엔진 수와 인용 출처가 달라졌는지 확인합니다. 결과가 달라지지 않으면 글의 길이를 늘리는 대신 답변의 명확성, 근거의 원출처, 독자가 확인할 수 있는 조건을 다시 검토합니다. 이 과정을 반복해 어떤 변경이 실제 가시성 변화와 함께 나타났는지 기록합니다.`;

describe("content quality gate", () => {
  it("passes evidence-led structured content", () => {
    const result = checkContentQuality({
      title: "AI 검색 가시성을 높이는 근거 중심 콘텐츠",
      bodyMarkdown: groundedBody.repeat(2),
      sourceEvidence: { measuredAt: "2026-08-22" },
    });
    expect(result.status).toBe("passed");
    expect(Object.values(result.checks).every(Boolean)).toBe(true);
  });

  it("blocks thin content without immutable evidence", () => {
    const result = checkContentQuality({
      title: "짧은 글",
      bodyMarkdown: "## 소개\n\n근거 없는 짧은 글입니다.",
    });
    expect(result.status).toBe("failed");
    expect(result.checks.bodyLength).toBe(false);
    expect(result.checks.evidencePresent).toBe(false);
  });

  it("blocks repeated AI filler and empty evidence objects", () => {
    const filler =
      "이 결과가 말해주는 핵심은 단순히 숫자가 아니라 전략의 전환입니다. ";
    const result = checkContentQuality({
      title: "AI 검색 가시성 전략",
      bodyMarkdown: `## 분석\n\n${filler.repeat(35)}`,
      sourceEvidence: {},
    });
    expect(result.status).toBe("failed");
    expect(result.checks.evidenceSpecific).toBe(false);
    expect(result.checks.originality).toBe(false);
  });

  it("allows a research article to cite more than twelve sources", () => {
    const links = Array.from(
      { length: 13 },
      (_, index) =>
        `[원출처 ${index + 1}](https://example.com/source-${index + 1})`
    ).join("\n");
    const result = checkContentQuality({
      title: "AI 검색 가시성 연구",
      bodyMarkdown: `${groundedBody.repeat(2)}\n\n## 원출처\n\n${links}`,
      sourceEvidence: { measuredAt: "2026-08-22", sources: links },
    });
    expect(result.checks.linkCount).toBe(true);
    expect(result.status).toBe("passed");
  });
});
