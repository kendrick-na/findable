// 네이버 검색광고 키워드도구 — 월간 검색수 (2026-10-05, 측정 알고리즘 v3 §2-③·⑥)
//
// 왜: 측정 질문이 「실제 사람이 묻는 말」인지, 매출 기회의 수요(D)가 얼마인지를 **실측 검색량**으로
//   정한다. 예전 매출 모델은 월 노출 1만/10만/100만을 임의로 골랐다(10/3 전 화면 제거 사유).
// 인증(공식 샘플 naver/searchad-apidoc python-sample/examples 로 확인):
//   base https://api.searchad.naver.com · 헤더 X-Timestamp·X-API-KEY·X-Customer·X-Signature
//   서명 = base64(HMAC-SHA256(secretKey, `${timestamp}.${method}.${uri}`))
// `/keywordstool`·`hintKeywords`·`showDetail=1`·응답 필드(relKeyword·monthlyPcQcCnt·
//   monthlyMobileQcCnt·compIdx)는 2026-10-05 실호출로 확인(힌트 5개 → 연관 752개).
//   [확인필요] 호출 한도·데이터 재사용 약관은 아직 원문 확인 전.
// 키가 없으면 null — 기능이 꺼진 것이지 오류가 아니다.

import { createHmac } from "node:crypto";
import { log } from "@repo/observability/log";

const BASE_URL = "https://api.searchad.naver.com";
const KEYWORD_TOOL_URI = "/keywordstool";
const MAX_HINTS_PER_CALL = 5;
const LOW_VOLUME_ESTIMATE = 5; // 응답의 "< 10" 은 0~9 → 가운데 값으로 근사하고 lowVolume 표시
const FETCH_TIMEOUT_MS = 10_000;
const WHITESPACE_RE = /\s+/g;

export interface KeywordVolume {
  /** 경쟁 정도(낮음/중간/높음) — 광고 경쟁, 참고용. */
  competition: string | null;
  keyword: string;
  /** "< 10" 이 섞여 근사값인 경우. */
  lowVolume: boolean;
  mobile: number;
  pc: number;
  total: number;
}

export interface NaverSearchAdCredentials {
  apiKey: string;
  customerId: string;
  secretKey: string;
}

export function naverSearchAdCredentials(
  env: Record<string, string | undefined> = process.env
): NaverSearchAdCredentials | null {
  const apiKey = env.NAVER_SEARCHAD_API_KEY;
  const secretKey = env.NAVER_SEARCHAD_SECRET_KEY;
  const customerId = env.NAVER_SEARCHAD_CUSTOMER_ID;
  return apiKey && secretKey && customerId
    ? { apiKey, secretKey, customerId }
    : null;
}

export function signNaverSearchAd(
  timestamp: string,
  method: string,
  uri: string,
  secretKey: string
): string {
  return createHmac("sha256", secretKey)
    .update(`${timestamp}.${method}.${uri}`)
    .digest("base64");
}

function count(value: unknown): { lowVolume: boolean; value: number } {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { lowVolume: false, value };
  }
  if (typeof value === "string" && value.includes("<")) {
    return { lowVolume: true, value: LOW_VOLUME_ESTIMATE };
  }
  const n = Number(value);
  return Number.isFinite(n)
    ? { lowVolume: false, value: n }
    : { lowVolume: true, value: 0 };
}

/** 키워드도구 응답 → 검색량. 연관 키워드도 함께 돌려준다(질문 씨앗 후보). */
export function parseKeywordTool(json: unknown): KeywordVolume[] {
  const list =
    json && typeof json === "object" && "keywordList" in json
      ? (json as { keywordList: unknown }).keywordList
      : null;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.flatMap((row) => {
    if (!row || typeof row !== "object") {
      return [];
    }
    const r = row as Record<string, unknown>;
    if (typeof r.relKeyword !== "string") {
      return [];
    }
    const pc = count(r.monthlyPcQcCnt);
    const mobile = count(r.monthlyMobileQcCnt);
    return [
      {
        keyword: r.relKeyword,
        pc: pc.value,
        mobile: mobile.value,
        total: pc.value + mobile.value,
        lowVolume: pc.lowVolume || mobile.lowVolume,
        competition: typeof r.compIdx === "string" ? r.compIdx : null,
      },
    ];
  });
}

/** 힌트 키워드(최대 5개씩)의 월간 검색수와 연관 키워드. 키가 없으면 null. */
export async function fetchNaverKeywordVolumes(
  keywords: string[],
  credentials: NaverSearchAdCredentials | null = naverSearchAdCredentials(),
  signal?: AbortSignal
): Promise<KeywordVolume[] | null> {
  if (!credentials) {
    return null;
  }
  const hints = [
    ...new Set(
      keywords.map((k) => k.replace(WHITESPACE_RE, "")).filter(Boolean)
    ),
  ];
  const out = new Map<string, KeywordVolume>();
  for (let i = 0; i < hints.length; i += MAX_HINTS_PER_CALL) {
    const batch = hints.slice(i, i + MAX_HINTS_PER_CALL);
    const timestamp = String(Date.now());
    const url = new URL(KEYWORD_TOOL_URI, BASE_URL);
    url.searchParams.set("hintKeywords", batch.join(","));
    url.searchParams.set("showDetail", "1");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(url, {
        headers: {
          "X-Timestamp": timestamp,
          "X-API-KEY": credentials.apiKey,
          "X-Customer": credentials.customerId,
          "X-Signature": signNaverSearchAd(
            timestamp,
            "GET",
            KEYWORD_TOOL_URI,
            credentials.secretKey
          ),
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        log.warn("audit.naver_keywords.http_error", {
          status: response.status,
          hints: batch.length,
        });
        continue;
      }
      for (const row of parseKeywordTool(await response.json())) {
        if (!out.has(row.keyword)) {
          out.set(row.keyword, row);
        }
      }
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      log.warn("audit.naver_keywords.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  return [...out.values()];
}
