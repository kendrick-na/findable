import { afterEach, describe, expect, it, vi } from "vitest";
import { naverAdapter } from "./korean-adapters";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Naver search evidence sampling", () => {
  it("does not let ten blog hits hide available news and web results", async () => {
    vi.stubEnv("NAVER_CLIENT_ID", "local-test-id");
    vi.stubEnv("NAVER_CLIENT_SECRET", "local-test-secret");
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      let channel = "webkr";
      if (url.includes("/blog.")) {
        channel = "blog";
      } else if (url.includes("/news.")) {
        channel = "news";
      }
      return {
        ok: true,
        json: async () => ({
          items: Array.from({ length: 10 }, (_, index) => ({
            title: `${channel} result ${index}`,
            description: "local fixture",
            link: `https://${channel}.example.invalid/${index}`,
          })),
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await naverAdapter({
      engineId: "naver",
      language: "ko",
      prompt: "파인더블 검색",
      brandName: "파인더블",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.errorMessage).toBeNull();
    expect(result.citedSources).toHaveLength(10);
    expect(
      result.citedSources.filter(
        ({ domain }) => domain === "blog.example.invalid"
      )
    ).toHaveLength(4);
    expect(result.citedSources.map(({ domain }) => domain)).toContain(
      "news.example.invalid"
    );
    expect(result.citedSources.map(({ domain }) => domain)).toContain(
      "webkr.example.invalid"
    );
  });
});
