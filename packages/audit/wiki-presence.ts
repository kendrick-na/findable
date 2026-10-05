// 위키데이터·위키백과 존재감 (2026-10-06, 측정 알고리즘 v3 — 해외 출처)
//
// 왜: AI 엔진은 엔티티(어떤 회사인가)를 위키데이터·위키백과에 크게 기댄다. 「공식 항목이 있는가,
//   한국어·영어 문서가 있는가, 한 달에 몇 명이 보는가」는 키 없이 얻는 무료 공개 데이터(CC BY-SA)다.
// 정확도: 이름 검색만으로는 동명 항목(apple.com → 다른 항목)이 걸린다. 그래서 위키데이터의
//   「공식 웹사이트(P856)」가 브랜드 도메인과 같은 항목만 받는다.
// 공식 API: wikidata.org/w/api.php (wbsearchentities·wbgetentities),
//   wikimedia.org/api/rest_v1/metrics/pageviews (User-Agent 필수, 분당 200회).

const USER_AGENT =
  "FindableMeasurement/1.0 (https://www.findable.co.kr; contact@findable.co.kr)";
const FETCH_TIMEOUT_MS = 8000;
const MAX_CANDIDATES = 8;
const PROTOCOL_RE = /^https?:\/\//;
const WWW_RE = /^www\./;
const PATH_SPLIT_RE = /[/?#]/;

export interface WikiPresence {
  /** 한국어·영어 위키백과 문서 제목(없으면 null). */
  articles: { en: string | null; ko: string | null };
  /** 직전 한 달 조회수(문서가 없으면 null). */
  monthlyViews: { en: number | null; ko: number | null };
  /** 공식 웹사이트가 브랜드 도메인과 같은 위키데이터 항목. 없으면 null. */
  wikidataId: string | null;
}

const EMPTY: WikiPresence = {
  wikidataId: null,
  articles: { ko: null, en: null },
  monthlyViews: { ko: null, en: null },
};

/** 호스트에서 프로토콜·www·경로를 떼어 낸다. */
function host(urlOrDomain: string): string {
  return (
    urlOrDomain
      .trim()
      .toLowerCase()
      .replace(PROTOCOL_RE, "")
      .replace(WWW_RE, "")
      .split(PATH_SPLIT_RE)[0] ?? ""
  );
}

/** 같은 호스트이거나 한쪽이 다른 쪽의 하위 도메인이면 같은 사이트로 본다. */
function sameSite(a: string, b: string): boolean {
  const x = host(a);
  const y = host(b);
  return (
    Boolean(x && y) && (x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`))
  );
}

interface WikidataEntity {
  claims?: Record<
    string,
    Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>
  >;
  id?: string;
  sitelinks?: Record<string, { title?: string }>;
}

/** 위키데이터 항목의 공식 웹사이트(P856) 중 브랜드 도메인과 같은 것이 있는가. */
export function entityMatchesDomain(
  entity: WikidataEntity,
  domain: string
): boolean {
  return (entity.claims?.P856 ?? []).some((claim) => {
    const value = claim.mainsnak?.datavalue?.value;
    return typeof value === "string" && sameSite(value, domain);
  });
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: controller.signal,
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** 직전 달(1일~말일) 조회수. 문서가 없거나 집계 전이면 null. */
async function lastMonthViews(
  lang: "ko" | "en",
  title: string,
  now: Date,
  signal?: AbortSignal
): Promise<number | null> {
  const first = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
  );
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");
  const json = (await getJson(
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${lang}.wikipedia/all-access/user/${encodeURIComponent(title.replaceAll(" ", "_"))}/monthly/${fmt(first)}/${fmt(last)}`,
    signal
  )) as { items?: Array<{ views?: number }> } | null;
  const views = json?.items?.[0]?.views;
  return typeof views === "number" ? views : null;
}

export async function resolveWikiPresence(
  input: { brandName: string; domain: string; names?: string[] },
  options: { now?: Date; signal?: AbortSignal } = {}
): Promise<WikiPresence> {
  const names = [...new Set([input.brandName, ...(input.names ?? [])])].filter(
    Boolean
  );
  const ids = new Set<string>();
  for (const name of names) {
    for (const language of ["ko", "en"] as const) {
      const json = (await getJson(
        `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&limit=5&language=${language}&search=${encodeURIComponent(name)}`,
        options.signal
      )) as { search?: Array<{ id?: string }> } | null;
      for (const hit of json?.search ?? []) {
        if (hit.id) {
          ids.add(hit.id);
        }
      }
    }
  }
  if (ids.size === 0) {
    return EMPTY;
  }
  const json = (await getJson(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims%7Csitelinks&ids=${[...ids].slice(0, MAX_CANDIDATES).join("%7C")}`,
    options.signal
  )) as { entities?: Record<string, WikidataEntity> } | null;
  const match = Object.values(json?.entities ?? {}).find((entity) =>
    entityMatchesDomain(entity, input.domain)
  );
  if (!match?.id) {
    return EMPTY;
  }
  const ko = match.sitelinks?.kowiki?.title ?? null;
  const en = match.sitelinks?.enwiki?.title ?? null;
  const now = options.now ?? new Date();
  return {
    wikidataId: match.id,
    articles: { ko, en },
    monthlyViews: {
      ko: ko ? await lastMonthViews("ko", ko, now, options.signal) : null,
      en: en ? await lastMonthViews("en", en, now, options.signal) : null,
    },
  };
}
