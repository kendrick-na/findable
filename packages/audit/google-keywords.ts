// 구글 광고 키워드 플래너 — 해외(미국 등) 월 검색량 (2026-10-06, 측정 알고리즘 v3 §2-③)
//
// 왜: 네이버 검색광고 키워드도구는 국내 수요만 보여 준다. 해외 시장 질문(영어)도
//   「실제로 사람들이 검색하는 말」에서 고르려면 구글 검색량이 필요하다.
// 호출(2026-10-05 스크래치 실호출로 확인 — HTTP 200, `franz=8100`·`pdrn serum=22200`):
//   1) OAuth 갱신 토큰 → https://oauth2.googleapis.com/token (grant_type=refresh_token)
//   2) POST https://googleads.googleapis.com/v25/customers/{id}:generateKeywordIdeas
//      헤더 authorization·login-customer-id(+developer-token 이 있으면)
//      본문 language·geoTargetConstants·keywordPlanNetwork=GOOGLE_SEARCH·keywordSeed.keywords
//   응답 results[].text · keywordIdeaMetrics.avgMonthlySearches(문자열 정수)·competition.
//   ⚠️ 이 계정은 「탐색자」 등급 — 운영 계정 하루 2,880회 한도(콘솔 확인 2026-10-05).
//   [확인필요] 키워드 플래너 데이터의 재사용(리포트 게재) 약관.
// 새 의존성 없이 fetch 만 쓴다. 키가 없으면 null — 기능이 꺼진 것이지 오류가 아니다.
// 오류 본문은 읽지 않는다(토큰·계정 정보가 섞일 수 있음) — 상태 코드만 로그.

import { log } from "@repo/observability/log";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_VERSION = "v25";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_SEEDS = 20; // generateKeywordIdeas keywordSeed 상한
const NON_DIGIT_RE = /\D/g;

export interface GoogleAdsCredentials {
  clientId: string;
  clientSecret: string;
  customerId: string;
  developerToken: string | null;
  loginCustomerId: string;
  refreshToken: string;
}

/** 시장별 구글 지역·언어 상수(공식 geoTargetConstants·languageConstants). */
export const GOOGLE_MARKETS = {
  US: { geo: "geoTargetConstants/2840", language: "languageConstants/1000" },
  KR: { geo: "geoTargetConstants/2410", language: "languageConstants/1012" },
} as const;
export type GoogleMarket = keyof typeof GOOGLE_MARKETS;

export interface GoogleKeywordIdea {
  competition: string | null;
  keyword: string;
  /** 월 평균 검색수(구글이 구간으로 반올림한 값). */
  volume: number;
}

function digits(value: string | undefined): string | null {
  const v = (value ?? "").replace(NON_DIGIT_RE, "");
  return v.length > 0 ? v : null;
}

/**
 * 스크래치 실호출에서 확인된 계정 구성: customer = login-customer(관리자 계정).
 * 하위 계정 ID 가 따로 있어도 CUSTOMER_NOT_ENABLED 였으므로, login-customer 가 있으면
 * 그것을 기본 고객 ID 로 쓴다(GOOGLE_ADS_KEYWORD_CUSTOMER_ID 로 덮어쓸 수 있다).
 */
export function googleAdsCredentials(
  env: Record<string, string | undefined> = process.env
): GoogleAdsCredentials | null {
  const clientId = env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_ADS_REFRESH_TOKEN;
  const loginCustomerId =
    digits(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) ??
    digits(env.GOOGLE_ADS_CUSTOMER_ID);
  const customerId =
    digits(env.GOOGLE_ADS_KEYWORD_CUSTOMER_ID) ?? loginCustomerId;
  if (!(clientId && clientSecret && refreshToken && customerId)) {
    return null;
  }
  return {
    clientId,
    clientSecret,
    refreshToken,
    customerId,
    loginCustomerId: loginCustomerId ?? customerId,
    developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN || null,
  };
}

/** generateKeywordIdeas 응답 → 키워드·검색량. 숫자가 없는 행은 0 으로 둔다. */
export function parseKeywordIdeas(json: unknown): GoogleKeywordIdea[] {
  const results =
    json && typeof json === "object" && "results" in json
      ? (json as { results: unknown }).results
      : null;
  if (!Array.isArray(results)) {
    return [];
  }
  const out: GoogleKeywordIdea[] = [];
  for (const row of results) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const r = row as {
      keywordIdeaMetrics?: {
        avgMonthlySearches?: unknown;
        competition?: unknown;
      };
      text?: unknown;
    };
    if (typeof r.text !== "string" || !r.text.trim()) {
      continue;
    }
    const volume = Number(r.keywordIdeaMetrics?.avgMonthlySearches ?? 0);
    out.push({
      keyword: r.text.trim(),
      volume: Number.isFinite(volume) && volume > 0 ? volume : 0,
      competition:
        typeof r.keywordIdeaMetrics?.competition === "string"
          ? r.keywordIdeaMetrics.competition
          : null,
    });
  }
  return out;
}

async function postJson(
  url: string,
  init: { body: string; headers: Record<string, string> },
  signal?: AbortSignal
): Promise<{ json: unknown; status: number } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
    });
    return {
      status: response.status,
      json: response.ok ? await response.json() : null,
    };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** 갱신 토큰 → 접근 토큰. 실패하면 null(사유 문구는 남기지 않는다). */
export async function fetchGoogleAccessToken(
  credentials: GoogleAdsCredentials,
  signal?: AbortSignal
): Promise<string | null> {
  const res = await postJson(
    TOKEN_URL,
    {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    },
    signal
  );
  const token =
    res?.json && typeof res.json === "object" && "access_token" in res.json
      ? (res.json as { access_token: unknown }).access_token
      : null;
  if (typeof token !== "string") {
    log.warn("audit.google_keywords.token_failed", {
      status: res?.status ?? null,
    });
    return null;
  }
  return token;
}

/** 씨앗 키워드(최대 20개)의 구글 검색량 + 연관 키워드. 키가 없으면 null. */
export async function fetchGoogleKeywordIdeas(
  seeds: string[],
  market: GoogleMarket,
  credentials: GoogleAdsCredentials | null = googleAdsCredentials(),
  signal?: AbortSignal
): Promise<GoogleKeywordIdea[] | null> {
  if (!credentials) {
    return null;
  }
  const keywords = [
    ...new Set(seeds.map((s) => s.trim().toLowerCase()).filter(Boolean)),
  ].slice(0, MAX_SEEDS);
  if (keywords.length === 0) {
    return [];
  }
  const token = await fetchGoogleAccessToken(credentials, signal);
  if (!token) {
    return null;
  }
  const target = GOOGLE_MARKETS[market];
  const res = await postJson(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${credentials.customerId}:generateKeywordIdeas`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        "login-customer-id": credentials.loginCustomerId,
        "content-type": "application/json",
        ...(credentials.developerToken
          ? { "developer-token": credentials.developerToken }
          : {}),
      },
      body: JSON.stringify({
        language: target.language,
        geoTargetConstants: [target.geo],
        keywordPlanNetwork: "GOOGLE_SEARCH",
        keywordSeed: { keywords },
      }),
    },
    signal
  );
  if (!res?.json) {
    log.warn("audit.google_keywords.http_error", {
      status: res?.status ?? null,
      seeds: keywords.length,
      market,
    });
    return null;
  }
  return parseKeywordIdeas(res.json);
}
