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
