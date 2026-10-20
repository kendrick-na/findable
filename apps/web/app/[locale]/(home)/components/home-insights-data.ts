// 홈 「Findable Insights」 칸의 데이터 읽기. (2026-10-20)
//
// DB 조회가 실패하면(예: 미리보기 빌드의 DATABASE_URL 무효 → P1000) 홈 prerender 전체가 멈췄다.
// LiveCounter(landing.live_counter.query_failed)와 같은 방식으로: 실패하면 빈 목록을 돌려주고 반드시 로그를 남긴다.
// ⚠️ 실패를 캐시 안에서 삼키지 않는다 — unstable_cache 안에서 빈 목록을 돌려주면 그 빈 목록이 30분 캐시된다.
//    그래서 캐시 함수는 그대로 던지게 두고, 바깥(loadHomeInsights)에서만 잡는다(다음 요청에서 다시 시도).
// 정상일 때 동작(최신 3개, 30분 재검증)은 바꾸지 않는다. listPublishedContent 의 다른 호출처(사이트맵·RSS·인사이트 페이지 등)는 그대로다.

import { log } from "@repo/observability/log";
import { unstable_cache } from "next/cache";
import { listPublishedContent } from "@/lib/content";

type HomeInsightPost = Awaited<ReturnType<typeof listPublishedContent>>[number];

export const getHomeInsights = unstable_cache(
  async (locale: string) =>
    (await listPublishedContent(locale, "findable")).slice(0, 3),
  ["landing-insights"],
  { revalidate: 1800 }
);

export async function loadHomeInsights(
  locale: string,
  loader: (locale: string) => Promise<HomeInsightPost[]> = getHomeInsights
): Promise<HomeInsightPost[]> {
  try {
    return await loader(locale);
  } catch (error) {
    log.error("landing.home_insights.query_failed", {
      error: error instanceof Error ? error.message : String(error),
      locale,
    });
    return [];
  }
}
