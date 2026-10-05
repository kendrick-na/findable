// 카카오(다음) 검색 — 웹문서·블로그·카페 언급량 (2026-10-06, 측정 알고리즘 v3 — 국내 출처)
//
// 왜: 네이버 밖의 한국어 웹(티스토리·다음 카페·일반 웹문서)에 브랜드 글이 얼마나 있나.
//   AI 엔진이 긁는 한국어 웹은 네이버 바깥이 더 크다 → 네이버 건수만 보면 한쪽만 본다.
// 공식 API: dapi.kakao.com/v2/search/{web,blog,cafe} (헤더 Authorization: KakaoAK <REST 키>).
//   2026-10-06 실호출로 meta.total_count 확인(「프란츠 앰플」 블로그 1,141 · 웹 117 · 카페 9).
// 건수·비율만 돌려준다(원문 저장 안 함). 키(KAKAO_REST_API_KEY)가 없으면 null.

import { brandRelevance } from "./naver-openapi";

const BASE = "https://dapi.kakao.com/v2/search";
const FETCH_TIMEOUT_MS = 8000;
const SAMPLE_SIZE = 20;

const CHANNELS = ["web", "blog", "cafe"] as const;
export type DaumChannel = (typeof CHANNELS)[number];

export interface DaumMentions {
  query: string;
  /** 블로그 상위 결과 중 브랜드가 실제로 언급된 비율. */
  relevance: number | null;
  totals: Record<DaumChannel, number | null>;
}

interface DaumJson {
  documents?: Array<{ contents?: string; title?: string }>;
  meta?: { total_count?: number };
}

async function getJson(
  url: string,
  key: string,
  signal?: AbortSignal
): Promise<DaumJson | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, {
      headers: { Authorization: `KakaoAK ${key}` },
      signal: controller.signal,
    });
    // 오류 본문은 읽지 않는다(키 관련 문구가 섞일 수 있음).
    return response.ok ? ((await response.json()) as DaumJson) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** 채널 3개 동시 호출(3회). 키가 없으면 null. */
export async function fetchDaumMentions(
  query: string,
  brandNames: string[],
  options: { apiKey?: string; signal?: AbortSignal } = {}
): Promise<DaumMentions | null> {
  const key = options.apiKey ?? process.env.KAKAO_REST_API_KEY;
  if (!key) {
    return null;
  }
  const results = await Promise.all(
    CHANNELS.map((channel) =>
      getJson(
        `${BASE}/${channel}?size=${SAMPLE_SIZE}&query=${encodeURIComponent(query)}`,
        key,
        options.signal
      )
    )
  );
  const [web, blog, cafe] = results;
  return {
    query,
    totals: {
      web: web?.meta?.total_count ?? null,
      blog: blog?.meta?.total_count ?? null,
      cafe: cafe?.meta?.total_count ?? null,
    },
    relevance: brandRelevance(
      (blog?.documents ?? []).map((d) => ({
        title: d.title,
        description: d.contents,
      })),
      brandNames
    ),
  };
}
