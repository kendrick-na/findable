import enDict from "@repo/internationalization/dictionaries/en.json";
import koDict from "@repo/internationalization/dictionaries/ko.json";
import { describe, expect, it } from "vitest";
import { responseVerdict } from "./response-verdict";

/** 라벨 문구는 사전에서 온다(2026-10-06). 한국어 화면 기준 + 영어도 「확정」을 말하지 않는지. */
const KO = koDict.app.promptResponses;
const EN = enDict.app.promptResponses;

describe("historical prompt response labels", () => {
  it("does not publish old mention booleans as verified brand mentions", () => {
    expect(
      responseVerdict({ brandMentioned: true, errorMessage: null }, KO).label
    ).toContain("재확인 필요");
  });

  it("does not label an old negative boolean as proven absence", () => {
    expect(
      responseVerdict({ brandMentioned: false, errorMessage: null }, KO).label
    ).toContain("미확인");
  });

  it("engine failures remain distinct from absence", () => {
    expect(
      responseVerdict({ brandMentioned: false, errorMessage: "quota" }, KO)
        .label
    ).toBe("응답 수집 실패");
  });

  it("영어판도 과거 값을 확정 언급으로 말하지 않는다", () => {
    expect(
      responseVerdict({ brandMentioned: true, errorMessage: null }, EN).label
    ).toMatch(/needs recheck/);
    expect(
      responseVerdict({ brandMentioned: false, errorMessage: null }, EN).label
    ).toMatch(/not confirmed/);
  });
});
