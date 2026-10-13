import { describe, expect, it } from "vitest";
import {
  COMPETITOR_CANDIDATE_LIMIT,
  competitorCandidatesFromResult,
} from "./competitor-extract";

const answer = (engineId: string, names: string[], extra = {}) => ({
  engineId,
  rawResponse: names.map((n, i) => `${i + 1}. ${n} - 설명`).join("\n"),
  ...extra,
});
const result = (rows: unknown[]) => ({ engineResponses: rows });
const brand = { name: "프란츠", variants: ["FRANZ"] };

describe("competitorCandidatesFromResult — 같이 자주 언급된 브랜드를 후보로 (제안일 뿐)", () => {
  it("2회 이상 등장한 브랜드만 후보가 된다(한 번은 우연)", () => {
    const r = result([
      answer("chatgpt", ["라운드랩", "토리든", "아누아"]),
      answer("claude", ["라운드랩", "토리든", "메디힐"]),
      answer("gemini", ["라운드랩", "마녀공장", "아누아"]),
    ]);
    const { candidates, answersRead } = competitorCandidatesFromResult(
      r,
      brand
    );
    expect(answersRead).toBe(3);
    expect(candidates.map((c) => c.name)).toEqual(
      expect.arrayContaining(["라운드랩", "토리든", "아누아"])
    );
    expect(candidates.map((c) => c.name)).not.toContain("메디힐"); // 1회
    expect(candidates.map((c) => c.name)).not.toContain("마녀공장"); // 1회
    expect(candidates.every((c) => c.mentions >= 2)).toBe(true);
  });

  it("우리 브랜드(이름·별칭)는 후보가 아니다", () => {
    const r = result([
      answer("chatgpt", ["프란츠", "라운드랩"]),
      answer("claude", ["FRANZ", "라운드랩"]),
    ]);
    const names = competitorCandidatesFromResult(r, brand).candidates.map(
      (c) => c.name
    );
    expect(names).toContain("라운드랩");
    expect(names).not.toContain("프란츠");
    expect(names.map((n) => n.toLowerCase())).not.toContain("franz");
  });

  it("이미 등록한 경쟁사(이름·별칭)는 후보에서 뺀다", () => {
    const r = result([
      answer("chatgpt", ["라운드랩", "토리든"]),
      answer("claude", ["Round Lab", "토리든"]),
    ]);
    const names = competitorCandidatesFromResult(r, brand, [
      { name: "라운드랩", aliases: ["Round Lab"] },
    ]).candidates.map((c) => c.name);
    expect(names).toContain("토리든");
    expect(names).not.toContain("라운드랩");
    expect(names).not.toContain("Round Lab");
  });

  it("검색 노출·브리핑·실패·스텁 답변은 읽지 않는다", () => {
    const r = result([
      answer("naver", ["가짜브랜드", "토리든"]),
      answer("naver-briefing", ["가짜브랜드", "토리든"]),
      answer("chatgpt", ["가짜브랜드", "토리든"], { errorMessage: "429" }),
      answer("claude", ["가짜브랜드", "토리든"], { isStub: true }),
    ]);
    expect(competitorCandidatesFromResult(r, brand)).toEqual({
      answersRead: 0,
      candidates: [],
    });
  });

  it("후보는 상한(5개) 안으로 자른다", () => {
    const names = ["가", "나", "다", "라", "마", "바", "사"].map(
      (n) => `${n}브랜드`
    );
    const r = result([answer("chatgpt", names), answer("claude", names)]);
    expect(competitorCandidatesFromResult(r, brand).candidates).toHaveLength(
      COMPETITOR_CANDIDATE_LIMIT
    );
  });

  it("모양이 이상한 결과는 빈 후보(throw 하지 않는다)", () => {
    for (const bad of [
      null,
      undefined,
      "x",
      [],
      {},
      { engineResponses: "x" },
    ]) {
      expect(competitorCandidatesFromResult(bad, brand)).toEqual({
        answersRead: 0,
        candidates: [],
      });
    }
  });
});
