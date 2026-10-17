import { describe, expect, it } from "vitest";
import { classifyEngineError, summarizeEngineErrors } from "./engine-error-log";

describe("classifyEngineError", () => {
  it("엔진 상한 타임아웃 / 429 / 검색 결과 없음 / 그 밖", () => {
    expect(classifyEngineError("Engine chatgpt timed out after 60000ms")).toBe(
      "timeout"
    );
    expect(classifyEngineError("Request failed with status 429")).toBe(
      "rate_limit"
    );
    expect(classifyEngineError("rate_limit_exceeded")).toBe("rate_limit");
    expect(classifyEngineError("Daum/Kakao 검색 결과 없음")).toBe("empty");
    expect(classifyEngineError("boom")).toBe("error");
    expect(classifyEngineError(null)).toBe("error");
  });
});

describe("summarizeEngineErrors — 어느 엔진이 어떤 종류로 실패했나", () => {
  it("엔진별 개수와 사건 목록(질문 번호·종류·시간)을 만든다, 원문 문구는 싣지 않는다", () => {
    const out = summarizeEngineErrors([
      {
        engineId: "chatgpt",
        errorMessage: "Engine chatgpt timed out after 60000ms",
        durationMs: 60_000,
        promptIndex: 2,
        promptKind: "brand",
      },
      {
        engineId: "claude",
        errorMessage: "status 429 secret-body",
        promptIndex: 5,
        promptKind: "discovery",
      },
      {
        engineId: "daum",
        errorMessage: "Daum/Kakao 검색 결과 없음",
        promptIndex: 1,
      },
      { engineId: "gemini", errorMessage: null, promptIndex: 3 }, // 정상 칸은 안 센다
    ]);
    expect(out?.total).toBe(3);
    expect(out?.byEngine.chatgpt?.timeout).toBe(1);
    expect(out?.byEngine.claude?.rate_limit).toBe(1);
    expect(out?.byEngine.daum?.empty).toBe(1);
    expect(out?.byEngine.gemini).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("secret-body");
    expect(out?.events[0]).toEqual({
      durationMs: 60_000,
      engineId: "chatgpt",
      kind: "timeout",
      promptIndex: 2,
      promptKind: "brand",
      recovered: false,
    });
  });

  it("늦게 와서 반영된 칸은 '회복됨 타임아웃'으로 남는다", () => {
    const out = summarizeEngineErrors([
      {
        engineId: "chatgpt",
        errorMessage: null,
        lateCell: "resolved",
        promptIndex: 0,
      },
    ]);
    expect(out?.byEngine.chatgpt).toMatchObject({ recovered: 1, timeout: 1 });
    expect(out?.events[0]?.recovered).toBe(true);
  });

  it("오류가 하나도 없으면 null — 정상 회차 결과에는 키가 생기지 않는다", () => {
    expect(
      summarizeEngineErrors([
        { engineId: "chatgpt" },
        { engineId: "claude", errorMessage: "" },
      ])
    ).toBeNull();
    expect(summarizeEngineErrors([])).toBeNull();
  });

  it("사건 목록은 상한(60)에서 잘리고 개수는 전체", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      engineId: "perplexity",
      errorMessage: "x",
      promptIndex: i,
    }));
    const out = summarizeEngineErrors(rows);
    expect(out?.total).toBe(100);
    expect(out?.events).toHaveLength(60);
    expect(out?.truncated).toBe(true);
  });
});
