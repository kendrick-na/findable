/**
 * @vitest-environment jsdom
 *
 * 근거 등급 6칸 카드(2026-09-28) — 등급이 **글자로** 보이고 6칸이 전부 렌더되는지.
 * 문구 자체가 아니라 `EVIDENCE_GRADE_LABEL`·입력값이 화면에 나오는지(계약)를 본다.
 */
import {
  type ActionGuide,
  DONT_LIST,
  EVIDENCE_GRADE_LABEL,
} from "@repo/audit/action-rules";
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ActionEvidenceGuide,
  DontList,
} from "../app/(authenticated)/features/analysis/action-evidence";

afterEach(cleanup);

const guide: ActionGuide = {
  evidenceGrade: "medium",
  sources: [{ label: "출처 A", url: "https://example.com/a" }],
  engines: ["google", "gemini"],
  effortHours: { min: 2, max: 4, per: "total" },
  effectLag: "며칠~몇 주",
  remeasureMetric: "다른 회사로 착각한 답변 수 (지금 22건 중 8건)",
  failCondition: "두 번 재도 20% 이상이면 실패",
  quotes: [{ engineId: "chatgpt", excerpt: "노우버스는 에듀테크 브랜드로…" }],
};
const naverGuide = { ...guide, engines: ["naver"] };

describe("ActionEvidenceGuide", () => {
  it("6칸과 착각 인용, 출처 링크가 모두 보인다", () => {
    const { container } = render(<ActionEvidenceGuide guide={guide} />);
    const view = within(container);
    expect(view.getByText(EVIDENCE_GRADE_LABEL.medium.label)).toBeTruthy();
    expect(view.getByText("Google 검색(AI 개요), Gemini")).toBeTruthy();
    expect(view.getByText("예상 작업 시간")).toBeTruthy();
    expect(view.getByText("약 2~4시간")).toBeTruthy();
    expect(view.getByText("재측정 권장 시점")).toBeTruthy();
    expect(view.getByText(guide.effectLag)).toBeTruthy();
    expect(view.getByText(guide.remeasureMetric)).toBeTruthy();
    expect(view.getByText("재점검 조건")).toBeTruthy();
    expect(view.getByText(guide.failCondition)).toBeTruthy();
    expect(container.textContent).toContain(
      "Findable 내부 운영 기준·추정이며 효과를 입증하지 않습니다"
    );
    expect(container.textContent).toContain("노우버스는 에듀테크");
    const link = container.querySelector("a[href='https://example.com/a']");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("네이버는 AI가 아니라 검색 노출 채널로 표시한다", () => {
    const { container } = render(<ActionEvidenceGuide guide={naverGuide} />);
    expect(container.textContent).toContain("적용 채널");
    expect(container.textContent).toContain("네이버 검색 노출");
    expect(container.textContent).not.toContain("적용되는 AI");
  });

  it("채널 목록이 비면 '측정 채널 전체', 주간 작업은 '매주'", () => {
    const { container } = render(
      <ActionEvidenceGuide
        guide={{
          ...guide,
          engines: [],
          effortHours: { min: 2, max: 4, per: "week" },
        }}
      />
    );
    expect(container.textContent).toContain("측정 채널 전체");
    expect(container.textContent).toContain("매주 약 2~4시간");
  });
});

describe("DontList", () => {
  it("5건 모두 '근거 없음' 글자 배지와 출처가 있다", () => {
    const { container } = render(<DontList donts={DONT_LIST} />);
    const items = container.querySelectorAll("li > div");
    expect(items.length).toBe(DONT_LIST.length);
    expect(
      within(container).getAllByText(EVIDENCE_GRADE_LABEL.none.label)
    ).toHaveLength(DONT_LIST.length);
    expect(container.querySelectorAll("a[href^='https://']").length).toBe(
      DONT_LIST.length
    );
  });
});
