/**
 * 홈 「Findable Insights」 칸 — DB 오류 시 빈 목록 + 로그, 정상 시 기존과 동일(최신 3개).
 * 실제 DB·네트워크 없음.
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const logError = vi.hoisted(() => vi.fn());
const findMany = vi.hoisted(() => vi.fn());

vi.mock("@repo/observability/log", () => ({
  log: { error: logError, info: vi.fn(), warn: vi.fn() },
}));
// unstable_cache 는 시험에서 그대로 통과시킨다(캐시 없이 원 함수 호출).
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));
vi.mock("@repo/database", () => ({
  database: { content: { findMany } },
}));

beforeEach(() => {
  logError.mockReset();
  findMany.mockReset();
});

const post = (id: string) => ({ id, slug: id, title: id });

describe("loadHomeInsights", () => {
  it("DB 오류(P1000 등)면 던지지 않고 빈 목록을 돌려주며 로그를 남긴다", async () => {
    findMany.mockRejectedValue(
      new Error("P1000: Authentication failed against database server")
    );
    const { loadHomeInsights } = await import(
      "@/app/[locale]/(home)/components/home-insights-data"
    );
    await expect(loadHomeInsights("ko")).resolves.toEqual([]);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]?.[0]).toBe(
      "landing.home_insights.query_failed"
    );
    expect(logError.mock.calls[0]?.[1]).toMatchObject({ locale: "ko" });
  });

  it("정상이면 기존과 같이 최신 3개를 그대로 돌려주고 로그를 남기지 않는다", async () => {
    findMany.mockResolvedValue(["a", "b", "c", "d"].map(post));
    const { loadHomeInsights } = await import(
      "@/app/[locale]/(home)/components/home-insights-data"
    );
    const out = await loadHomeInsights("en");
    expect(out.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(logError).not.toHaveBeenCalled();
  });

  it("목록이 비어 있으면 빈 목록(오류 아님, 로그 없음)", async () => {
    findMany.mockResolvedValue([]);
    const { loadHomeInsights } = await import(
      "@/app/[locale]/(home)/components/home-insights-data"
    );
    await expect(loadHomeInsights("ko")).resolves.toEqual([]);
    expect(logError).not.toHaveBeenCalled();
  });

  it("다른 호출처가 쓰는 listPublishedContent 자체는 오류를 그대로 던진다(동작 불변)", async () => {
    findMany.mockRejectedValue(new Error("P1000"));
    const { listPublishedContent } = await import("@/lib/content");
    await expect(listPublishedContent("ko", "findable")).rejects.toThrow(
      "P1000"
    );
  });
});
