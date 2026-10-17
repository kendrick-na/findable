import { describe, expect, it } from "vitest";
import { classifyAnswer } from "./answer-buckets";
import { makeAuditCheckpoint, readAuditCheckpoint } from "./checkpoint";
import { classifyEngineError, summarizeEngineErrors } from "./engine-error-log";

const scope = {
  brandId: "b",
  domain: "example.com",
  language: "ko" as const,
  organizationId: "o",
};
const context = {
  brandName: "Example",
  brandVariants: [],
  identityGrounded: true,
  officialSiteIdentity: {
    description: null,
    finalUrl: "https://example.com",
    h1: null,
    siteName: null,
    title: "Example",
  },
};

describe("U1 — 빈 응답·격리는 측정 못 함(engine_error)으로 센다", () => {
  const row = (errorMessage: string) => ({
    brandMentioned: false,
    engineId: "claude",
    errorMessage,
    isStub: false,
    mentionQuality: undefined,
  });
  it("빈 응답 오류와 격리 오류는 absent/unknown 이 아니라 engine_error", () => {
    expect(classifyAnswer(row("Engine claude returned an empty answer"))).toBe(
      "engine_error"
    );
    expect(
      classifyAnswer(row("Engine claude paused: consecutive failures"))
    ).toBe("engine_error");
  });
  it("오류 분류: paused 추가, 빈 응답은 empty, 기존 분류 불변", () => {
    expect(
      classifyEngineError("Engine claude paused: consecutive failures")
    ).toBe("paused");
    expect(classifyEngineError("Engine claude returned an empty answer")).toBe(
      "empty"
    );
    expect(classifyEngineError("Engine x timed out after 60000ms")).toBe(
      "timeout"
    );
    expect(classifyEngineError("429 too many requests")).toBe("rate_limit");
    expect(classifyEngineError("boom")).toBe("error");
  });
  it("paused 키는 격리가 있을 때만 생기고 기존 4종 키는 그대로", () => {
    const plain = summarizeEngineErrors([
      { engineId: "claude", errorMessage: "boom" },
    ]);
    expect(plain?.byEngine.claude).toEqual({
      empty: 0,
      error: 1,
      rate_limit: 0,
      recovered: 0,
      timeout: 0,
    });
    const paused = summarizeEngineErrors([
      {
        engineId: "claude",
        errorMessage: "Engine claude paused: consecutive failures",
      },
    ]);
    expect(paused?.byEngine.claude.paused).toBe(1);
  });
});

describe("U1 — checkpoint 호환(N5): 필드 추가 없음, 새 응답 필드는 기준 파서가 읽는다", () => {
  it("retryAttempts·합산 usage 가 든 행도 기준 커밋의 readAuditCheckpoint 가 통과시키고 planKey 는 같다", () => {
    const prompts = [
      { kind: "brand" as const, lang: "ko" as const, text: "q" },
    ];
    const empty = makeAuditCheckpoint(scope, context, prompts);
    const engines = empty.enginePlan[0];
    const rows = engines.map((engineId) => ({
      brandMentioned: false,
      citedSources: [],
      durationMs: 5,
      engineId,
      errorMessage: "fetch failed",
      isStub: false,
      mentionListSize: null,
      mentionPosition: null,
      rawResponse: "",
      retryAttempts: 2,
      sentiment: null,
      shareOfVoice: null,
      usage: { costModel: "token", inputTokens: 220, outputTokens: 50 },
    }));
    const withRows = { ...empty, responses: [rows] };
    const read = readAuditCheckpoint(
      JSON.parse(JSON.stringify(withRows)),
      scope
    );
    expect(read?.responses[0][0]).toMatchObject({ retryAttempts: 2 });
    expect(read?.planKey).toBe(empty.planKey);
  });

  it("플래그 꺼짐 상태의 기존 checkpoint 는 저장 JSON 이 바이트 동일(새 키 없음)", () => {
    const prompts = [
      { kind: "brand" as const, lang: "ko" as const, text: "q" },
    ];
    const cp = makeAuditCheckpoint(
      scope,
      context,
      prompts,
      "2026-10-01T00:00:00.000Z"
    );
    const text = JSON.stringify(cp);
    expect(JSON.stringify(readAuditCheckpoint(JSON.parse(text), scope))).toBe(
      text
    );
    expect(text).not.toContain("retryAttempts");
  });
});
