import { describe, expect, it } from "vitest";
import { responseVerdict } from "./response-verdict";

describe("historical prompt response labels", () => {
  it("does not publish old mention booleans as verified brand mentions", () => {
    expect(
      responseVerdict({ brandMentioned: true, errorMessage: null }).label
    ).toContain("재확인 필요");
  });

  it("does not label an old negative boolean as proven absence", () => {
    expect(
      responseVerdict({ brandMentioned: false, errorMessage: null }).label
    ).toContain("미확인");
  });

  it("engine failures remain distinct from absence", () => {
    expect(
      responseVerdict({ brandMentioned: false, errorMessage: "quota" }).label
    ).toBe("응답 수집 실패");
  });
});
