import { describe, expect, it } from "vitest";
import { filterStoredGeoActions } from "./action-display-filter";
import { engineDisplayName } from "./engine-labels";

describe("저장된 crawl_access 카드 표시 투영", () => {
  it("옛 절대 문구를 표시 시점에만 교정하고 원본 객체는 바꾸지 않는다", () => {
    const legacy = {
      kind: "crawl_access",
      evidence:
        "공식 사이트가 출처로 인용된 적이 한 번도 없습니다. 봇이 페이지를 못 읽는 상태라면 다른 처방은 효과가 없습니다.",
      guide: {
        effectLag:
          "고친 즉시 봇이 읽을 수 있게 됩니다. 인용은 그 뒤 재수집 시점에 따라 다릅니다.",
        failCondition:
          "소스 보기에 본문이 없거나 robots.txt 가 봇을 막고 있으면 실패입니다 — 고칠 때까지 다른 처방보다 먼저 하세요.",
      },
    };

    const filtered = filterStoredGeoActions([legacy]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.evidence).toContain("인용의 전제 조건");
    expect(filtered[0]?.evidence).not.toContain("다른 처방은 효과가 없습니다");
    expect(filtered[0]?.guide).toMatchObject({
      effectLag: expect.stringContaining("보장되지 않습니다"),
      failCondition: expect.stringContaining("다음 측정으로 확인"),
    });
    expect(legacy.evidence).toContain("다른 처방은 효과가 없습니다");
    expect(legacy.guide.effectLag).toContain("고친 즉시");
  });
});

describe("저장된 네이버 카드 표시 보존", () => {
  it("옛 네이버·브리핑·HyperCLOVA 범위는 저장 카드에서 소급 변경하지 않는다", () => {
    const legacy = {
      kind: "naver_blog",
      title: "네이버 블로그에 한 주제로 꾸준히 글을 올리세요",
      evidence: "기존 측정 근거",
      how: "기존 실행 방법",
      verification:
        "다음 측정에서 네이버·네이버 AI 브리핑·HyperCLOVA X 답변이 우리를 알아봤는지 보세요.",
      source: "근거 약함 · 기존 출처",
      guide: {
        engines: ["naver", "naver-briefing", "hyperclova"],
        notGuaranteed:
          "매주(주 1회) 올리면 네이버 AI 브리핑이나 HyperCLOVA X 가 우리를 인용·언급한다는 근거는 없습니다. 인용 272건 한 사례의 분포일 뿐입니다.",
        effectLag: "게시 후 몇 주~몇 달",
        remeasureMetric: "AI가 제대로 알아본 답변 수 (지금 22건 중 5건)",
        failCondition:
          "Findable 내부 기준으로 3개월(글 12편 안팎) 뒤에도 네이버 계열 답변에서 알아본 답변이 0건이면, 주제를 더 좁히거나 질문 문구를 고객 표현으로 바꾸세요.",
      },
    };

    const filtered = filterStoredGeoActions([legacy]);
    expect(filtered[0]?.verification).toContain("같은 질문에 네이버 검색 노출");
    expect(filtered[0]?.guide).toMatchObject({
      engines: ["naver"],
      notGuaranteed: expect.stringContaining("네이버 검색 노출이나 AI 답변"),
      remeasureMetric: "같은 질문에서 네이버 검색 노출이 확인된 질문 수",
      failCondition: expect.stringContaining("노출이 확인된 질문 수"),
    });
    expect(engineDisplayName(filtered[0]?.guide?.engines[0] ?? "")).toBe(
      "네이버 검색 노출"
    );
    expect(legacy.verification).toContain("HyperCLOVA");
    expect(legacy.guide.remeasureMetric).toContain("AI가 제대로 알아본");
    expect(legacy.guide.notGuaranteed).toContain("네이버 AI 브리핑");
  });
});
