import { generateObject } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyMention } from "./mention-verdict";

vi.mock("ai", () => ({ generateObject: vi.fn() }));

const input = {
  brandName: "인디고차일드",
  brandDomain: "indigochild.kr",
  officialSite: { title: "Indigochild" },
  text: "인디고차일드의 공식 사이트 indigochild.kr에 따르면 마케팅 회사를 운영합니다.",
  stringMatched: true,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(generateObject).mockReset();
});

describe("mention verification provider failure", () => {
  it("uses an independent Google model when the primary verifier is rate limited", async () => {
    vi.stubEnv("LETSUR_API_KEY", "test-key");
    vi.stubEnv("GOOGLE_API_KEY", "test-google-key");
    vi.mocked(generateObject)
      .mockRejectedValueOnce({ lastError: { statusCode: 429 } })
      .mockResolvedValueOnce({ object: { quality: "confirmed" } } as never);

    expect(await verifyMention(input)).toEqual({
      counted: true,
      quality: "confirmed",
      via: "llm",
    });
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("marks a failed verification as unverified, never as unknown brand", async () => {
    vi.stubEnv("LETSUR_API_KEY", "test-key");
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.mocked(generateObject).mockRejectedValue({
      lastError: { statusCode: 429 },
    });

    expect(await verifyMention(input)).toEqual({
      counted: false,
      quality: "unverified",
      via: "skipped",
    });
  });
});
