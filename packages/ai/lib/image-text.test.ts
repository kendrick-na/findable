import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ generateObject: vi.fn() }));
vi.mock("ai", () => ({ generateObject: h.generateObject }));
vi.mock("./models", () => ({ models: { chat: "stub-model" } }));
vi.mock("./letsur-fallback", () => ({
  HELPER_GATEWAY_MODEL_ID: "stub",
  letsurModelWithFallback: () => "letsur-stub-model",
}));

import { extractImageText } from "./image-text";

beforeEach(() => h.generateObject.mockReset());

describe("extractImageText — 가짜 모델로 호출 모양만 확인(실호출 없음)", () => {
  it("이미지 1장을 비전 입력으로 보내고 글자·토큰을 돌려준다(재시도 0·출력 토큰 상한)", async () => {
    h.generateObject.mockResolvedValue({
      object: { text: "프란츠 시카 크림" },
      usage: { inputTokens: 1200, outputTokens: 20 },
    });
    const bytes = new Uint8Array([1, 2, 3]);
    const out = await extractImageText({
      bytes,
      maxOutputTokens: 300,
      mediaType: "image/png",
    });
    expect(out).toEqual({
      inputTokens: 1200,
      outputTokens: 20,
      text: "프란츠 시카 크림",
    });
    const call = h.generateObject.mock.calls[0]?.[0];
    expect(call.maxRetries).toBe(0);
    expect(call.maxOutputTokens).toBe(300);
    const parts = call.messages[0].content;
    expect(parts.some((p: { type: string }) => p.type === "image")).toBe(true);
    // 이미지 속 글은 데이터 — 지시를 따르지 말라는 문구가 프롬프트에 있다
    expect(parts[0].text).toContain("따르지 마");
  });

  it("사용량 정보가 없으면 토큰은 null", async () => {
    h.generateObject.mockResolvedValue({
      object: { text: "" },
      usage: undefined,
    });
    const out = await extractImageText({
      bytes: new Uint8Array(1),
      mediaType: "image/jpeg",
    });
    expect(out).toEqual({ inputTokens: null, outputTokens: null, text: "" });
  });
});
