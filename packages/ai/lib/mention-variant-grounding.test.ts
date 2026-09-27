import { describe, expect, it } from "vitest";
import { __internal } from "./mention-verdict";

describe("brand variant grounding", () => {
  it("tells the verifier which registered spelling actually appeared", () => {
    const prompt = __internal.buildVerdictPrompt({
      brandName: "인디고차일드",
      brandVariants: ["Indigo Child", "INDIGOCHILD"],
      brandDomain: "indigochild.kr",
      text: "Indigo Child is a Korean marketing company.",
    });

    expect(prompt).toContain(
      "등록된 공식 표기: 인디고차일드 · Indigo Child · INDIGOCHILD"
    );
    expect(prompt).toContain("답변에서 감지된 표기: Indigo Child");
  });
});
