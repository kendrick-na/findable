import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/database", () => ({ database: {} }));
vi.mock("@repo/observability/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@repo/ai/lib/engines", () => ({
  costOf: () => ({ krw: 0, basis: "test" }),
}));

const { replayPayloadMismatch, toStorableText } = await import("./tracking");

const base = {
  rawResponse: "answer",
  engineId: "chatgpt",
  promptId: "p1",
  shareOfVoice: 0.25,
  inputTokens: 10,
  outputTokens: 5,
  costKrw: 11.15,
  costBasis: "token",
  brandId: "b1",
  trackedAt: new Date("2026-10-04T15:32:48.858Z"),
};

describe("toStorableText", () => {
  it("replaces lone surrogates the way Postgres UTF-8 stores them", () => {
    expect(toStorableText("cut \uD83D")).toBe("cut �");
    expect(toStorableText("\uDE00 tail")).toBe("� tail");
  });

  it("keeps complete surrogate pairs and strips NUL", () => {
    expect(toStorableText("ok 😀")).toBe("ok 😀");
    expect(toStorableText("a\u0000b")).toBe("ab");
  });
});

describe("replayPayloadMismatch", () => {
  it("treats undefined and null as the same stored value", () => {
    expect(
      replayPayloadMismatch(
        { ...base, shareOfVoice: undefined },
        { ...base, shareOfVoice: null }
      )
    ).toEqual([]);
  });

  it("names the differing fields without their values", () => {
    expect(
      replayPayloadMismatch(base, {
        ...base,
        shareOfVoice: 0.5,
        trackedAt: new Date(base.trackedAt.getTime() + 1),
      })
    ).toEqual(["shareOfVoice", "trackedAt"]);
  });
});
