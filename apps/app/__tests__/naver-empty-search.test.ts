/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Naver 검색 결과 없음", () => {
  it("정상 200 빈 결과는 엔진 실패가 아니라 미언급 측정값으로 저장한다", async () => {
    vi.stubEnv("NAVER_CLIENT_ID", "test-client-id");
    vi.stubEnv("NAVER_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("CLOVA_STUDIO_API_KEY", "test-clova-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [] }),
        } as Response)
      )
    );

    const { naverAdapter } = await import(
      "@repo/ai/lib/engines/korean-adapters"
    );
    const result = await naverAdapter({
      engineId: "naver",
      language: "ko",
      prompt: "존재하지 않는 검색어",
    });

    expect(result.errorMessage).toBeNull();
    expect(result.brandMentioned).toBe(false);
    expect(result.isStub).toBe(false);
  });

  it("인증·HTTP 실패는 미언급으로 숨기지 않고 엔진 실패로 남긴다", async () => {
    vi.stubEnv("NAVER_CLIENT_ID", "test-client-id");
    vi.stubEnv("NAVER_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("CLOVA_STUDIO_API_KEY", "test-clova-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 401 } as Response))
    );

    const { naverAdapter } = await import(
      "@repo/ai/lib/engines/korean-adapters"
    );
    const result = await naverAdapter({
      engineId: "naver",
      language: "ko",
      prompt: "TechDD",
    });

    expect(result.errorMessage).toContain("HTTP 401");
  });
});
