import "server-only";

import { log } from "@repo/observability/log";

/**
 * 공공 API 공통 호출기 — 회사 카드 소스 모듈 전용.
 *
 * 원칙(2026-10-06):
 *  - HTTP 오류·타임아웃·JSON 파싱 실패에도 **절대 throw 하지 않는다** → 카드 한 칸만 비고 나머지는 채워진다.
 *  - 로그에는 **소스 이름 + HTTP 상태/결과 코드만** 남긴다. 응답 본문·URL은 인증키를 되돌려줄 수 있어 남기지 않는다.
 */

export const DEFAULT_TIMEOUT_MS = 15_000;

export type FetchOutcome =
  | { ok: true; status: number; body: unknown }
  | {
      ok: false;
      status: number | null;
      reason: "http" | "timeout" | "network" | "parse";
    };

export async function fetchJson(
  source: string,
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<FetchOutcome> {
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init, signal });
  } catch (error) {
    const timeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    log.warn(`[ax-mail:${source}] request failed`, {
      reason: timeout ? "timeout" : "network",
    });
    return { ok: false, status: null, reason: timeout ? "timeout" : "network" };
  }
  if (!response.ok) {
    log.warn(`[ax-mail:${source}] http error`, { status: response.status });
    return { ok: false, status: response.status, reason: "http" };
  }
  try {
    return { ok: true, status: response.status, body: await response.json() };
  } catch {
    // data.go.kr 은 키 오류 시 200 + XML(OpenAPI_ServiceResponse)을 돌려주는 경우가 있다.
    log.warn(`[ax-mail:${source}] non-json body`, { status: response.status });
    return { ok: false, status: response.status, reason: "parse" };
  }
}

/** 객체 안전 접근 — 응답 모양을 믿지 않는다. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 문자열/숫자 필드를 trim 된 문자열로. 빈 값·"00010101" 같은 자리표시자는 null. */
export function str(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function num(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const s = str(value);
  if (s === null) {
    return null;
  }
  const n = Number(s.replaceAll(",", ""));
  return Number.isFinite(n) ? n : null;
}

const YMD_RE = /^(\d{4})(\d{2})(\d{2})$/;

/** YYYYMMDD → YYYY-MM-DD. 형식이 아니거나 0001년 같은 자리표시자면 null. */
export function ymd(value: unknown): string | null {
  const s = str(value);
  const m = s ? YMD_RE.exec(s) : null;
  if (!m || Number(m[1]) < 1900) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * data.go.kr 표준 응답에서 item 배열을 꺼낸다.
 * 서비스마다 껍데기가 다르다(실측 2026-10-06):
 *  - 금융위·국민연금: { response: { header, body: { items: { item: [...] } } } }
 *  - 식약처 화장품:   { header, body: { items: [...] } }
 *  - 결과 1건이면 item 이 배열이 아니라 객체로 오는 경우가 있다.
 */
export function dataGoKrItems(body: unknown): {
  resultCode: string | null;
  totalCount: number | null;
  items: Record<string, unknown>[];
} {
  const root = asRecord(body);
  const envelope = asRecord(root?.response) ?? root;
  const header = asRecord(envelope?.header);
  const inner = asRecord(envelope?.body);
  const itemsField = inner?.items;
  let raw: unknown = itemsField;
  const itemsRecord = asRecord(itemsField);
  if (itemsRecord) {
    raw = itemsRecord.item;
  }
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (asRecord(raw)) {
    list = [raw];
  }
  return {
    resultCode: str(header?.resultCode),
    totalCount: num(inner?.totalCount),
    items: list
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => item !== null),
  };
}

/** 사업자등록번호 → 숫자 10자리. 아니면 null. */
export function normalizeBizNo(
  value: string | null | undefined
): string | null {
  if (!value) {
    return null;
  }
  const digits = value.replaceAll(/\D/g, "");
  return digits.length === 10 ? digits : null;
}

const CORP_MARK_RE =
  /\(주\)|㈜|（주）|주식회사|\(유\)|유한회사|\(재\)|재단법인|\(사\)|사단법인/g;
const SPACE_RE = /\s+/g;

/** 회사명 비교용 정규화 — 법인 표기·공백 제거. 표시용으로 쓰지 말 것. */
export function normalizeCorpName(name: string | null | undefined): string {
  return (name ?? "")
    .replaceAll(CORP_MARK_RE, "")
    .replaceAll(SPACE_RE, "")
    .toLowerCase();
}
