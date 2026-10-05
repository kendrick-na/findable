// 네이버 오픈API — 블로그·카페·지식iN·뉴스 언급량, 지식iN 실제 질문, 데이터랩 추이
// (2026-10-06, 측정 알고리즘 v3 — 국내 출처)
//
// 왜: AI 답변(특히 네이버 AI 브리핑)은 블로그·카페·지식iN 글을 출처로 쓴다.
//   ① 「이 브랜드를 다룬 글이 얼마나 있나」 = AI 가 참고할 재료의 양
//   ② 지식iN 질문 제목 = 실제 사람이 묻는 말투 → 측정 질문을 자연스럽게 만드는 씨앗
//   ③ 데이터랩 = 브랜드·카테고리 관심이 오르는지 내리는지(상대값 0~100)
// 공식 API: openapi.naver.com/v1/search/{blog,cafearticle,kin,news}.json (하루 25,000회),
//   /v1/datalab/search (하루 1,000회). 2026-10-06 실호출로 응답 필드(total·items·results.data) 확인.
// ⚠️ 약관: 검색 결과 원문을 DB 에 쌓지 않는다. 여기서는 **건수·비율·질문 문장(메모리 안 사용)** 만 돌려준다.
// 키: 운영에 이미 있는 NAVER_CLIENT_ID/SECRET 을 먼저 쓰고, 없으면 NAVER_OPENAPI_* 를 쓴다.
//   둘 다 없으면 null = 기능이 꺼진 것이지 오류가 아니다.

const SEARCH_BASE = "https://openapi.naver.com/v1/search";
const DATALAB_URL = "https://openapi.naver.com/v1/datalab/search";
const FETCH_TIMEOUT_MS = 8000;
const SAMPLE_SIZE = 20;
const TAG_RE = /<[^>]+>/g;
const SPACE_RE = /\s+/g;
const ENTITY_RE = /&(amp|lt|gt|quot|#39|apos);/g;
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
};
const QUESTION_RE = /[?？]|추천|어떤|어디|뭐가|무엇|있나요|할까요|궁금|괜찮/;

export interface NaverOpenApiCredentials {
  clientId: string;
  clientSecret: string;
}

export function naverOpenApiCredentials(
  env: Record<string, string | undefined> = process.env
): NaverOpenApiCredentials | null {
  const clientId = env.NAVER_CLIENT_ID ?? env.NAVER_OPENAPI_CLIENT_ID;
  const clientSecret =
    env.NAVER_CLIENT_SECRET ?? env.NAVER_OPENAPI_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** 검색 결과 제목·요약의 <b> 태그와 HTML 엔티티를 걷어 낸다. */
export function plainText(value: string): string {
  return value
    .replace(TAG_RE, "")
    .replace(ENTITY_RE, (_m, name: string) => ENTITIES[name] ?? "")
    .replace(SPACE_RE, " ")
    .trim();
}

/**
 * 상위 결과 중 브랜드 표기가 실제로 들어 있는 비율(0~1).
 * 왜: 네이버 검색은 낱말을 나눠 찾기 때문에 「프란츠 앰플」 총 1,829건에는 다른 앰플 글도 섞인다.
 *   총건수만 보이면 부풀려지므로 표본 정확도를 함께 둔다. 표본이 없으면 null.
 */
export function brandRelevance(
  items: Array<{ description?: string; title?: string }>,
  brandNames: string[]
): number | null {
  const names = brandNames
    .map((n) => n.toLowerCase().replace(SPACE_RE, ""))
    .filter(Boolean);
  if (items.length === 0 || names.length === 0) {
    return null;
  }
  const hits = items.filter((item) => {
    const text = plainText(`${item.title ?? ""} ${item.description ?? ""}`)
      .toLowerCase()
      .replace(SPACE_RE, "");
    return names.some((n) => text.includes(n));
  }).length;
  return hits / items.length;
}

/** 지식iN 제목 중 질문 모양인 것만, 중복 없이. */
export function questionTitles(items: Array<{ title?: string }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const title = plainText(item.title ?? "");
    const key = title.replace(SPACE_RE, "");
    if (title && QUESTION_RE.test(title) && !seen.has(key)) {
      seen.add(key);
      out.push(title);
    }
  }
  return out;
}

async function getJson(
  url: string,
  credentials: NaverOpenApiCredentials,
  init: { body?: string; signal?: AbortSignal } = {}
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  init.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, {
      method: init.body ? "POST" : "GET",
      headers: {
        "X-Naver-Client-Id": credentials.clientId,
        "X-Naver-Client-Secret": credentials.clientSecret,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      body: init.body,
      signal: controller.signal,
    });
    // 오류 본문은 읽지 않는다(키 관련 문구가 섞일 수 있어 로그·화면에 남기지 않음).
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

interface SearchJson {
  items?: Array<{ description?: string; title?: string }>;
  total?: number;
}

const CHANNELS = {
  blog: "blog",
  cafe: "cafearticle",
  kin: "kin",
  news: "news",
} as const;
export type NaverChannel = keyof typeof CHANNELS;

export interface NaverMentions {
  query: string;
  /** 블로그 상위 결과 중 브랜드가 실제로 언급된 비율. 총건수를 읽을 때 같이 본다. */
  relevance: number | null;
  /** 채널별 총 검색 결과 수. 호출 실패 채널은 null. */
  totals: Record<NaverChannel, number | null>;
}

/** 채널 4개 동시 호출(4회). 키가 없으면 null. */
export async function fetchNaverMentions(
  query: string,
  brandNames: string[],
  options: {
    credentials?: NaverOpenApiCredentials | null;
    signal?: AbortSignal;
  } = {}
): Promise<NaverMentions | null> {
  const credentials =
    options.credentials === undefined
      ? naverOpenApiCredentials()
      : options.credentials;
  if (!credentials) {
    return null;
  }
  const entries = await Promise.all(
    (Object.keys(CHANNELS) as NaverChannel[]).map(async (channel) => {
      const json = (await getJson(
        `${SEARCH_BASE}/${CHANNELS[channel]}.json?display=${SAMPLE_SIZE}&query=${encodeURIComponent(query)}`,
        credentials,
        { signal: options.signal }
      )) as SearchJson | null;
      return [channel, json] as const;
    })
  );
  const byChannel = Object.fromEntries(entries) as Record<
    NaverChannel,
    SearchJson | null
  >;
  return {
    query,
    totals: {
      blog: byChannel.blog?.total ?? null,
      cafe: byChannel.cafe?.total ?? null,
      kin: byChannel.kin?.total ?? null,
      news: byChannel.news?.total ?? null,
    },
    relevance: brandRelevance(byChannel.blog?.items ?? [], brandNames),
  };
}

/** 지식iN 에서 실제 사람이 쓴 질문 제목(측정 질문 씨앗). 저장하지 말고 질문 생성에만 쓴다. */
export async function fetchNaverQuestions(
  query: string,
  options: {
    credentials?: NaverOpenApiCredentials | null;
    signal?: AbortSignal;
  } = {}
): Promise<string[] | null> {
  const credentials =
    options.credentials === undefined
      ? naverOpenApiCredentials()
      : options.credentials;
  if (!credentials) {
    return null;
  }
  const json = (await getJson(
    `${SEARCH_BASE}/kin.json?display=${SAMPLE_SIZE}&sort=sim&query=${encodeURIComponent(query)}`,
    credentials,
    { signal: options.signal }
  )) as SearchJson | null;
  return json ? questionTitles(json.items ?? []) : null;
}

export interface NaverTrendSeries {
  points: Array<{ period: string; ratio: number }>;
  title: string;
}

/** 데이터랩 응답 → 묶음별 추이. 비율은 요청한 묶음 전체 중 최댓값 = 100 기준 상대값. */
export function parseTrend(json: unknown): NaverTrendSeries[] {
  const results =
    json && typeof json === "object" && "results" in json
      ? (json as { results: unknown }).results
      : null;
  if (!Array.isArray(results)) {
    return [];
  }
  return results.flatMap((row) => {
    if (!row || typeof row !== "object") {
      return [];
    }
    const r = row as { data?: unknown; title?: unknown };
    if (typeof r.title !== "string" || !Array.isArray(r.data)) {
      return [];
    }
    return [
      {
        title: r.title,
        points: r.data.flatMap((d) =>
          d &&
          typeof d === "object" &&
          typeof (d as { period?: unknown }).period === "string" &&
          typeof (d as { ratio?: unknown }).ratio === "number"
            ? [
                {
                  period: (d as { period: string }).period,
                  ratio: (d as { ratio: number }).ratio,
                },
              ]
            : []
        ),
      },
    ];
  });
}

/** 검색어 묶음(최대 5개)의 기간별 상대 검색 추이. 키가 없으면 null. */
export async function fetchNaverTrend(
  groups: Array<{ keywords: string[]; name: string }>,
  period: {
    endDate: string;
    startDate: string;
    timeUnit?: "date" | "week" | "month";
  },
  options: {
    credentials?: NaverOpenApiCredentials | null;
    signal?: AbortSignal;
  } = {}
): Promise<NaverTrendSeries[] | null> {
  const credentials =
    options.credentials === undefined
      ? naverOpenApiCredentials()
      : options.credentials;
  if (!credentials || groups.length === 0) {
    return null;
  }
  const json = await getJson(DATALAB_URL, credentials, {
    signal: options.signal,
    body: JSON.stringify({
      startDate: period.startDate,
      endDate: period.endDate,
      timeUnit: period.timeUnit ?? "month",
      keywordGroups: groups.slice(0, 5).map((g) => ({
        groupName: g.name,
        keywords: g.keywords.slice(0, 20),
      })),
    }),
  });
  return json ? parseTrend(json) : null;
}
