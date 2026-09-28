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

describe("네이버 = 검색 노출 (2026-09-29 · HyperCLOVA 합성 폐지)", () => {
  it("🔴 CLOVA 키 없이도 재고, 검색 결과 원문을 그대로 근거로 쓴다(합성 호출 0회)", async () => {
    vi.stubEnv("NAVER_CLIENT_ID", "test-client-id");
    vi.stubEnv("NAVER_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("CLOVA_STUDIO_API_KEY", "");
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                title: "<b>노우버스</b> AI 기술실사",
                description: "노우버스는 CTO 구독 서비스를 제공",
                link: `https://www.knowverse.net/${url.length}`,
              },
            ],
          }),
      } as Response)
    );
    vi.stubGlobal("fetch", fetchMock);
    const { naverAdapter } = await import(
      "@repo/ai/lib/engines/korean-adapters"
    );
    const result = await naverAdapter({
      engineId: "naver",
      language: "ko",
      prompt: "노우버스는 어떤 브랜드야?",
      brandName: "노우버스",
    });
    expect(result.isStub).toBe(false);
    expect(result.errorMessage).toBeNull();
    expect(result.brandMentioned).toBe(true);
    expect(result.rawResponse).toContain("출처: https://www.knowverse.net/");
    const called = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(
      called.every((u) => u.startsWith("https://openapi.naver.com/"))
    ).toBe(true);
  });

  it("⛔ 기본 측정 엔진에 hyperclova 가 없다(서비스 종료)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        calls.push(String(url));
        return Promise.resolve({ ok: false, status: 500 } as Response);
      })
    );
    vi.stubEnv("CLOVA_STUDIO_API_KEY", "test-clova-key");
    const { queryAllEngines } = await import("@repo/ai/lib/engines");
    const rows = await queryAllEngines({ prompt: "x", language: "ko" });
    expect(rows.map((r) => r.engineId)).not.toContain("hyperclova");
    expect(calls.some((u) => u.includes("clovastudio"))).toBe(false);
  });
});
