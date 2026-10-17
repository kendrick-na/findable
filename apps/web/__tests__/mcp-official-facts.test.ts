/**
 * MCP 커넥터 — 공식 사실·AI 크롤러 점검. @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/audit/public-url-security", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@repo/audit/public-url-security")>();
  return {
    ...real,
    // DNS 조회 없이 호스트 이름만 본다: 'private.test' 는 사설, 나머지는 공개.
    assertPublicUrl: vi.fn(async (url: URL) => {
      if (url.hostname === "private.test" || url.hostname === "localhost") {
        throw new Error("URL_PRIVATE");
      }
    }),
  };
});

import {
  AI_CRAWLERS,
  blockedAiCrawlers,
  checkOfficialFacts,
  jsonLdTypes,
} from "@/lib/mcp/official-facts";

function res(status: number, body = "", headers: Record<string, string> = {}) {
  return new Response(body, { status, headers });
}

function fakeFetch(map: Record<string, Response | (() => Response)>) {
  return vi.fn(async (input: string | URL | Request) => {
    const key = typeof input === "string" ? input : input.toString();
    const hit = map[key];
    if (!hit) {
      return res(404);
    }
    return typeof hit === "function" ? hit() : hit.clone();
  }) as unknown as typeof fetch;
}

describe("robots.txt AI 크롤러 판정", () => {
  it("전체 허용이면 막힌 크롤러가 없다", () => {
    expect(blockedAiCrawlers("User-agent: *\nDisallow:\n")).toEqual([]);
  });

  it("GPTBot 만 막으면 GPTBot 만 막힌 것으로 본다", () => {
    expect(
      blockedAiCrawlers(
        "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\n"
      )
    ).toEqual(["GPTBot"]);
  });

  it("와일드카드 전체 차단이면 지정 없는 크롤러 전부 막힌 것이다", () => {
    expect(blockedAiCrawlers("User-agent: *\nDisallow: /\n").sort()).toEqual(
      [...AI_CRAWLERS].sort()
    );
  });

  it("와일드카드 차단이어도 특정 크롤러를 허용(Allow) 그룹으로 따로 지정하면 그 크롤러는 막힘에서 뺀다", () => {
    const robots =
      "User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n";
    expect(blockedAiCrawlers(robots)).not.toContain("GPTBot");
    expect(blockedAiCrawlers(robots)).toContain("ClaudeBot");
  });

  it("주석·빈 줄·대소문자·여러 user-agent 묶음을 처리한다", () => {
    const robots =
      "# 설명\nUSER-AGENT: ClaudeBot\nuser-agent: PerplexityBot\nDISALLOW: /  # 전체\n";
    expect(blockedAiCrawlers(robots).sort()).toEqual([
      "ClaudeBot",
      "PerplexityBot",
    ]);
  });
});

describe("JSON-LD 타입 추출", () => {
  it("중첩·배열·@graph 를 모두 훑는다", () => {
    const html = `<html><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":["WebSite","Brand"]}]}</script></html>`;
    expect(jsonLdTypes(html).sort()).toEqual([
      "Brand",
      "Organization",
      "WebSite",
    ]);
  });

  it("깨진 JSON-LD 는 없음으로 취급한다", () => {
    expect(
      jsonLdTypes(`<script type="application/ld+json">{깨짐</script>`)
    ).toEqual([]);
  });
});

describe("checkOfficialFacts", () => {
  const FIXED = new Date("2026-10-17T00:00:00Z");

  it("llms.txt·robots·JSON-LD·sitemap 이 있으면 4개 모두 양호", async () => {
    const f = fakeFetch({
      "https://brand.example/": res(
        200,
        `<script type="application/ld+json">{"@type":"Organization"}</script>`
      ),
      "https://brand.example/llms.txt": res(200, "# Brand\n> 소개"),
      "https://brand.example/robots.txt": res(
        200,
        "User-agent: *\nDisallow:\n"
      ),
      "https://brand.example/sitemap.xml": res(200, "<urlset></urlset>"),
    });
    const out = await checkOfficialFacts("brand.example", f, () => FIXED);
    expect(out.checked_url).toBe("https://brand.example");
    expect(out.checked_at).toBe("2026-10-17T00:00:00.000Z");
    expect(out.items.map((i) => [i.key, i.status])).toEqual([
      ["llms_txt", "found"],
      ["robots_ai_crawlers", "allowed"],
      ["json_ld", "found"],
      ["sitemap", "found"],
    ]);
    expect(out.summary_ko).toContain("4개 항목 중 4개");
    expect(out.limits_ko).toMatch(/공개된 페이지만/);
  });

  it("소프트 404(HTML 오류 페이지)를 llms.txt 로 오인하지 않는다", async () => {
    const f = fakeFetch({
      "https://brand.example/": res(200, "<html></html>"),
      "https://brand.example/llms.txt": res(
        200,
        "<!doctype html><html>없음</html>"
      ),
    });
    const out = await checkOfficialFacts("https://brand.example", f);
    expect(out.items.find((i) => i.key === "llms_txt")?.status).toBe("missing");
  });

  it("확인하지 못한 항목은 '없음'이 아니라 error/unknown 으로 구분한다", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    const out = await checkOfficialFacts("brand.example", f);
    const byKey = Object.fromEntries(out.items.map((i) => [i.key, i.status]));
    expect(byKey).toEqual({
      llms_txt: "error",
      robots_ai_crawlers: "unknown",
      json_ld: "error",
      sitemap: "error",
    });
  });

  it("사설 주소는 요청 전에 거절한다(fetch 를 부르지 않는다)", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    await expect(checkOfficialFacts("http://private.test", f)).rejects.toThrow(
      "URL_PRIVATE"
    );
    await expect(checkOfficialFacts("localhost", f)).rejects.toThrow(
      "URL_PRIVATE"
    );
    expect(f).not.toHaveBeenCalled();
  });

  it("사설 주소로 가는 리다이렉트는 따라가지 않는다(SSRF)", async () => {
    const f = fakeFetch({
      "https://brand.example/": () =>
        res(302, "", { location: "http://private.test/secret" }),
      "https://brand.example/llms.txt": res(404),
      "https://brand.example/robots.txt": res(404),
      "https://brand.example/sitemap.xml": res(404),
    });
    const out = await checkOfficialFacts("brand.example", f);
    expect(out.items.find((i) => i.key === "json_ld")?.status).toBe("error");
    const calls = (
      f as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("private.test"))).toBe(false);
  });

  it("위험한 입력(스크립트 스킴·계정 포함·비표준 포트)은 요청 전에 거절한다", async () => {
    const never = vi.fn() as unknown as typeof fetch;
    await expect(
      checkOfficialFacts("javascript:alert(1)", never)
    ).rejects.toThrow("URL_INVALID");
    await expect(
      checkOfficialFacts("https://user:pw@brand.example", never)
    ).rejects.toThrow("URL_UNSAFE");
    await expect(
      checkOfficialFacts("brand.example:8080", never)
    ).rejects.toThrow("URL_UNSAFE");
    expect(never).not.toHaveBeenCalled();
    await expect(
      checkOfficialFacts("   ", vi.fn() as unknown as typeof fetch)
    ).rejects.toThrow("URL_REQUIRED");
  });
});
