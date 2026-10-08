// 유튜브 존재감 (2026-10-06, 측정 알고리즘 v3 — 국내·해외 출처)
//
// 왜: AI 답변은 유튜브를 출처로 자주 인용한다. 「이 브랜드를 다룬 영상이 시장별로 얼마나 있고,
//   누가(공식 채널/외부 크리에이터) 올렸고, 얼마나 봤나」는 AI 가 참고할 재료가 있는지의 척도다.
//   예: franz skincare(미국) — 외부 크리에이터 리뷰 4.7만·15.9만 회인데 AI 는 메신저 앱을 소개했다.
// 공식 API: YouTube Data API v3. 키는 YOUTUBE_API_KEY(없으면 null = 기능 꺼짐).
// ⚠️ 한도: search.list 는 「검색 질의」 버킷에서 기본 **하루 100회** → 진단 1건에 시장당 1회만 쓴다.
//   videos.list 는 1유닛(일 10,000). 약관상 저장 데이터는 30일 안에 갱신·삭제한다.

const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const FETCH_TIMEOUT_MS = 8000;

export interface YoutubeVideo {
  channelTitle: string;
  title: string;
  videoId: string;
  views: number;
}

export interface YoutubePresence {
  query: string;
  region: string;
  /** API 가 추정하는 전체 결과 수(대략값). */
  totalResults: number;
  videos: YoutubeVideo[];
}

async function getJson(url: URL, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

interface SearchJson {
  items?: Array<{ id?: { videoId?: string } }>;
  pageInfo?: { totalResults?: number };
}
interface VideosJson {
  items?: Array<{
    id?: string;
    snippet?: { channelTitle?: string; title?: string };
    statistics?: { viewCount?: string };
  }>;
}

/** 검색 1회(+영상 통계 1회). 키가 없거나 실패하면 null. */
export async function resolveYoutubePresence(
  query: string,
  region: string,
  options: { apiKey?: string; maxResults?: number; signal?: AbortSignal } = {}
): Promise<YoutubePresence | null> {
  const key = options.apiKey ?? process.env.YOUTUBE_API_KEY;
  if (!key) {
    return null;
  }
  const search = new URL(SEARCH_URL);
  search.search = new URLSearchParams({
    part: "snippet",
    q: query,
    type: "video",
    maxResults: String(options.maxResults ?? 10),
    regionCode: region,
    key,
  }).toString();
  const found = (await getJson(search, options.signal)) as SearchJson | null;
  if (!found) {
    return null;
  }
  const ids = (found.items ?? [])
    .map((item) => item.id?.videoId)
    .filter((id): id is string => Boolean(id));
  const stats = new URL(VIDEOS_URL);
  stats.search = new URLSearchParams({
    part: "statistics,snippet",
    id: ids.join(","),
    key,
  }).toString();
  const videos = ids.length
    ? ((await getJson(stats, options.signal)) as VideosJson | null)
    : null;
  return {
    query,
    region,
    totalResults: found.pageInfo?.totalResults ?? 0,
    videos: (videos?.items ?? []).map((item) => ({
      videoId: item.id ?? "",
      title: item.snippet?.title ?? "",
      channelTitle: item.snippet?.channelTitle ?? "",
      views: Number(item.statistics?.viewCount ?? 0),
    })),
  };
}

/** 공식 채널 영상과 외부 크리에이터 영상을 나눈다(채널명에 브랜드 표기가 들어 있으면 공식으로 본다). */
export function splitOfficialVideos(
  videos: YoutubeVideo[],
  brandNames: string[]
): { external: YoutubeVideo[]; official: YoutubeVideo[] } {
  const names = brandNames
    .map((n) => n.toLowerCase().replace(/\s+/g, ""))
    .filter(Boolean);
  const isOfficial = (v: YoutubeVideo) => {
    const channel = v.channelTitle.toLowerCase().replace(/\s+/g, "");
    return names.some((n) => channel.includes(n));
  };
  return {
    official: videos.filter(isOfficial),
    external: videos.filter((v) => !isOfficial(v)),
  };
}
