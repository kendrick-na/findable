import { afterEach, describe, expect, it, vi } from "vitest";
import { engineDisplayName, engineNote } from "./engine-labels";
import { engineSourceState } from "./market-scope";

afterEach(() => vi.unstubAllEnvs());

describe("engine labels — api-search-v1 set (owner-approval strings)", () => {
  it("flag off: every old label and note is unchanged", () => {
    expect(engineDisplayName("chatgpt")).toBe("ChatGPT (웹검색 없음)");
    expect(engineDisplayName("chatgpt", false)).toBe("ChatGPT (no web search)");
    expect(engineDisplayName("gemini")).toBe("Gemini");
    expect(engineDisplayName("claude")).toBe("Claude");
    expect(engineNote("chatgpt")).toContain("웹검색 없이 모델 지식만으로");
    expect(engineNote("gemini")).toBeNull();
  });

  it("flag on (server var): chatgpt/gemini renamed, claude and others unchanged", () => {
    vi.stubEnv("FINDABLE_ENGINE_SET", "api-search-v1");
    expect(engineDisplayName("chatgpt")).toBe("ChatGPT (웹검색)");
    expect(engineDisplayName("chatgpt", false)).toBe("ChatGPT (web search)");
    expect(engineDisplayName("gemini")).toBe("Gemini (구글 검색 연동)");
    expect(engineDisplayName("gemini", false)).toBe(
      "Gemini (Google Search grounding)"
    );
    expect(engineDisplayName("claude")).toBe("Claude");
    expect(engineDisplayName("naver")).toBe("네이버 검색 노출");
    expect(engineDisplayName("chatgpt-web")).toBe("ChatGPT (웹)");
    expect(engineNote("chatgpt")).toBe(
      "ChatGPT는 웹검색을 켜고, 소비자 화면과 비슷한 길이로 답하도록 맞춰 측정했어요."
    );
    expect(engineNote("chatgpt", false)).toContain("web search on");
    // other notes stay
    expect(engineNote("daum")).toContain("다음 검색");
  });

  it("flag on via the public mirror variable (client components)", () => {
    vi.stubEnv("NEXT_PUBLIC_FINDABLE_ENGINE_SET", "api-search-v1");
    expect(engineDisplayName("chatgpt")).toBe("ChatGPT (웹검색)");
  });

  it("explicit context wins over the process flag (stored runs keep their own label)", () => {
    vi.stubEnv("FINDABLE_ENGINE_SET", "api-search-v1");
    expect(engineDisplayName("chatgpt", true, { engineSet: null })).toBe(
      "ChatGPT (웹검색 없음)"
    );
    vi.unstubAllEnvs();
    expect(
      engineDisplayName("gemini", true, { engineSet: "api-search-v1" })
    ).toBe("Gemini (구글 검색 연동)");
    expect(
      engineNote("chatgpt", true, { engineSet: "api-search-v1" })
    ).toContain("웹검색을 켜고");
  });
});

describe("engineSourceState — api-search-v1 set", () => {
  it("flag off: chatgpt stays 'not_collected', gemini depends on grounding", () => {
    expect(engineSourceState("chatgpt", false)).toBe("not_collected");
    expect(engineSourceState("chatgpt", true)).toBe("not_collected");
    expect(engineSourceState("gemini", false)).toBe("not_collected");
    expect(engineSourceState("gemini", true)).toBe("collected");
    expect(engineSourceState("claude", false)).toBe("not_collected");
  });

  it("flag on: chatgpt/gemini/claude are 'collected' even with grounding flag off", () => {
    vi.stubEnv("FINDABLE_ENGINE_SET", "api-search-v1");
    expect(engineSourceState("chatgpt", false)).toBe("collected");
    expect(engineSourceState("gemini", false)).toBe("collected");
    expect(engineSourceState("claude", false)).toBe("collected");
  });

  it("flag on never rescues engines that have no citations at all", () => {
    vi.stubEnv("FINDABLE_ENGINE_SET", "api-search-v1");
    expect(engineSourceState("hyperclova", true)).toBe("never");
  });

  it("explicit engineSet argument (stored-run context) overrides the process flag", () => {
    vi.stubEnv("FINDABLE_ENGINE_SET", "api-search-v1");
    expect(engineSourceState("chatgpt", false, null)).toBe("not_collected");
    expect(engineSourceState("chatgpt", false, "api-search-v1")).toBe(
      "collected"
    );
  });
});
