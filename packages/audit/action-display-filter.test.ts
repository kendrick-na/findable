import { describe, expect, it } from "vitest";
import { filterStoredGeoActions } from "./action-display-filter";

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
      verification: "네이버·네이버 AI 브리핑·HyperCLOVA X 답변을 확인",
      source: "근거 약함 · 기존 출처",
      guide: {
        engines: ["naver", "naver-briefing", "hyperclova"],
        effectLag: "게시 후 몇 주~몇 달",
        failCondition: "기존 조건",
      },
    };

    expect(filterStoredGeoActions([legacy])).toEqual([legacy]);
  });
});
