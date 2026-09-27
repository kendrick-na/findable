import { buildGeoActions } from "@repo/audit/actions";
import { describe, expect, it } from "vitest";

describe("action guide execution contract", () => {
  it("names a measured page to change and a way to verify the outcome", () => {
    const actions = buildGeoActions({
      averageMentionPosition: null,
      brandDomain: "indigochild.kr",
      brandName: "인디고차일드",
      enginesMeasured: 7,
      enginesMentioned: 3,
      ownedCitationUrls: ["https://indigochild.kr/about"],
      prompts: [
        {
          hit: 0,
          text: "인디고차일드는 어떤 마케팅 회사야?",
          total: 7,
        },
      ],
    });
    const gap = actions.find((action) => action.kind === "prompt_gap");

    expect(gap).toBeTruthy();
    expect(gap && "where" in gap).toBe(true);
    expect(gap && "verification" in gap).toBe(true);
    expect(gap?.where).toContain("https://indigochild.kr/about");
    expect(gap?.verification).toContain("같은 질문");
  });
});
