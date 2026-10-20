// 읽기 전용 MCP 모드 스위치 — **전부 기본 꺼짐/비어 있음**. 값은 환경변수에만 둔다(코드·문서·로그 출력 금지).
//
//   FINDABLE_MCP_READONLY_MODE_ENABLED     읽기 전용 모드. 켜지면 측정을 시작하는 도구(start_*)가 등록되지 않는다.
//   FINDABLE_MCP_TOKEN_REQUIRED            Authorization: Bearer 토큰 검사.
//   FINDABLE_MCP_PREVIEW_TOKEN             프리뷰 전용 토큰 값(서버 쪽 기준값, 값은 어디에도 출력하지 않는다).
//   FINDABLE_MCP_PREVIEW_TOKEN_EXPIRES_AT  토큰 만료 시각(ISO 8601). 없거나 읽을 수 없거나 지났으면 모두 거부.
//   (허용 목록 방식 — VERCEL_ENV==="preview", 또는 VERCEL_ENV 가 비었고 NODE_ENV 가 "development"/"test" 일 때만
//    읽기 전용 모드·점검 도구가 켜진다. 그 밖의 값(둘 다 빔·staging·오타·대소문자 변형·production)은 전부 거부.)
//   FINDABLE_MCP_READONLY_BRAND_ALLOWLIST  읽어 줄 brandId 목록(쉼표). 비어 있으면 아무 브랜드도 읽지 않는다.
//                                          항목은 「brandId」 또는 「brandId=기대도메인」. 공식 사실 점검(실제 접속)은
//                                          「brandId=기대도메인」 쌍이 있고 DB 의 Brand.domain 이 그 도메인과 같을 때만 한다.
//
// 이것은 인증이 없고 Origin 이 없으면 통과하던 구조 위의 **최소 안전장치**다(허용 목록·토큰·시험 시간 한정).
// 기존 `flags.ts` 는 수정하지 않는다 — 기존 스위치(FINDABLE_MCP_ENABLED)는 읽기만 한다.

import { createHash, timingSafeEqual } from "node:crypto";

import { mcpEnabled } from "./flags";

const TRUE_VALUES = new Set(["1", "true", "on", "yes"]);

function readFlag(name: string): boolean {
  return TRUE_VALUES.has((process.env[name] ?? "").trim().toLowerCase());
}

/** 서버 자체가 켜져 있고 읽기 전용 모드도 켜졌을 때만 true. */
export function mcpReadonlyModeEnabled(): boolean {
  return mcpEnabled() && readFlag("FINDABLE_MCP_READONLY_MODE_ENABLED");
}

/**
 * 프리뷰·개발·시험 환경인가(허용 목록 방식, fail-closed).
 *  - VERCEL_ENV 가 정확히 "preview" 면 허용(프리뷰 배포는 NODE_ENV=production 이어도 허용).
 *  - VERCEL_ENV 가 비어 있으면 NODE_ENV 가 정확히 "development" 또는 "test" 일 때만 허용(로컬·시험).
 *  - 그 밖(둘 다 빔·staging·오타·대소문자 변형·앞뒤 공백·production)은 전부 거부 = 운영으로 취급.
 *
 * 전제(관제탑 결정 2026-10-20): Findable 은 **Vercel 전용 배포**이고 자체 호스팅 운영은 없다. Vercel 은 모든 배포에
 * VERCEL_ENV 를 넣으므로 운영(production)은 첫 줄에서 거부된다. NODE_ENV=development/test 허용은 VERCEL_ENV 가 없는
 * 로컬 개발·시험만을 위한 것이다. 자체 호스팅 운영을 새로 만든다면 이 판정을 별도 명시적 허용값 방식으로 바꿔야 한다.
 */
export function isPreviewOrDevRuntime(): boolean {
  const vercelEnv = process.env.VERCEL_ENV ?? "";
  if (vercelEnv !== "") {
    return vercelEnv === "preview";
  }
  const nodeEnv = process.env.NODE_ENV ?? "";
  return nodeEnv === "development" || nodeEnv === "test";
}

/** 읽기 전용 모드가 켜져 있는데 프리뷰·개발 환경이 아니라 거부해야 하는가(시작 단계 가드). */
export function mcpReadonlyModeBlockedHere(): boolean {
  return mcpReadonlyModeEnabled() && !isPreviewOrDevRuntime();
}

export function mcpTokenRequired(): boolean {
  return readFlag("FINDABLE_MCP_TOKEN_REQUIRED");
}

// brandId 는 영문·숫자·`-`·`_` 만(1~128자). 공백·그 밖의 문자가 섞이면 그 항목을 버린다.
const BRAND_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const LEADING_WWW_RE = /^www\./;
const TRAILING_DOT_RE = /\.$/;
// 기대 도메인에는 DNS 호스트 이름만 쓴다(주소·경로·포트·계정·공백 금지). 의도된 정책: `:`·`[`·`]` 를 막으므로
// IPv6 리터럴은 기대 도메인이 될 수 없다(공용 URL 검사는 공개 IPv6 리터럴을 통과시키지만, MCP 점검 대상은 도메인만).
const PIN_FORBIDDEN_RE = /[\s/\\?#@:[\]]/;

/**
 * 기대 도메인 정규화: 소문자·국제화 도메인은 퓨니코드·앞의 www.·끝의 점 제거. 형식이 틀리면 null.
 * MCP 점검 도구의 호스트 비교(geo-tools 의 hostOnly)와 같은 규칙이다.
 */
export function normalizePinnedDomain(raw: string): string | null {
  const text = raw.trim();
  if (text === "" || PIN_FORBIDDEN_RE.test(text)) {
    return null;
  }
  let host: string;
  try {
    host = new URL(`https://${text}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  const normalized = host
    .replace(LEADING_WWW_RE, "")
    .replace(TRAILING_DOT_RE, "");
  return normalized.includes(".") && !normalized.startsWith(".")
    ? normalized
    : null;
}

export interface ParsedBrandAllowlist {
  /** 읽어도 되는 brandId(「brandId」·「brandId=도메인」 둘 다). 요약·분포 조회 도구가 쓴다. */
  ids: ReadonlySet<string>;
  /** brandId → 정규화한 기대 도메인. 공식 사실 점검 도구는 여기 있는 브랜드만 읽는다. */
  pins: ReadonlyMap<string, string>;
  /** 형식 오류·충돌로 버린 항목 수(값은 담지 않는다). */
  rejected: number;
}

/**
 * 허용 목록 해석. 항목은 쉼표로 나누고, 각 항목은 「brandId」 또는 「brandId=기대도메인」.
 *  - 쉼표 앞뒤 공백은 지운다. brandId 는 영문·숫자·`-`·`_` 만 — 안쪽 공백·다른 문자가 있으면 그 항목을 버린다.
 *  - 형식 오류(빈 쪽, `=` 두 개 이상, 도메인 형식 틀림) 항목은 그 brandId 를 **통째로 뺀다**(fail-closed).
 *  - 같은 brandId 에 서로 다른 기대 도메인이 오면 그 brandId 를 통째로 뺀다(어느 쪽이 맞는지 모르므로).
 */
export function parseReadonlyBrandAllowlist(raw: string): ParsedBrandAllowlist {
  const ids = new Set<string>();
  const pins = new Map<string, string>();
  const banned = new Set<string>();
  let rejected = 0;
  for (const entry of raw.split(",")) {
    const item = entry.trim();
    if (item === "") {
      continue;
    }
    const parts = item.split("=");
    const id = (parts[0] ?? "").trim();
    if (!BRAND_ID_RE.test(id)) {
      // brandId 형식 오류(빈 값·안쪽 공백·허용 밖 문자): 이 항목은 버린다(형식이 틀린 id 는 어디에도 넣지 않는다).
      rejected += 1;
      continue;
    }
    if (parts.length === 1) {
      ids.add(id);
      continue;
    }
    const pin =
      parts.length === 2 ? normalizePinnedDomain(parts[1] ?? "") : null;
    if (pin === null) {
      rejected += 1;
      banned.add(id);
      continue;
    }
    const prior = pins.get(id);
    if (prior !== undefined && prior !== pin) {
      rejected += 1;
      banned.add(id);
      continue;
    }
    ids.add(id);
    pins.set(id, pin);
  }
  for (const id of banned) {
    ids.delete(id);
    pins.delete(id);
  }
  return { ids, pins, rejected };
}

function envBrandAllowlist(): ParsedBrandAllowlist {
  return parseReadonlyBrandAllowlist(
    process.env.FINDABLE_MCP_READONLY_BRAND_ALLOWLIST ?? ""
  );
}

/** 허용 brandId 집합. 비어 있으면 빈 집합(= 아무 브랜드도 못 읽음). */
export function readonlyBrandAllowlist(): ReadonlySet<string> {
  return envBrandAllowlist().ids;
}

/** brandId → 기대 도메인(공식 사실 점검 전용). 쌍으로 적힌 항목만 들어간다. */
export function readonlyBrandDomainPins(): ReadonlyMap<string, string> {
  return envBrandAllowlist().pins;
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

const BEARER_RE = /^Bearer\s+(.+)$/i;

// 만료 시각: ISO 8601 「YYYY-MM-DDTHH:MM:SSZ」 또는 「…SS+09:00」 같은 오프셋 포함 형식만. 소수 초·날짜만·안쪽 공백 등은 거부.
// 앞뒤 공백은 토큰·허용 목록과 같은 정책으로 지운다. 연도는 2000~9999 만(0000~0099 는 JS Date 가 1900년대로 바꾸므로 거부).
const STRICT_EXPIRY_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:Z|([+-])(\d{2}):(\d{2}))$/;

const MIN_EXPIRY_YEAR = 2000;

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/** 엄격 형식의 만료 시각을 밀리초로. 형식·범위(없는 날짜 포함)가 틀리면 null. */
export function parseStrictExpiry(raw: string): number | null {
  const m = STRICT_EXPIRY_RE.exec(raw.trim());
  if (!m) {
    return null;
  }
  const [year, month, day, hour, minute, second] = m
    .slice(1, 7)
    .map(Number) as [number, number, number, number, number, number];
  const offH = Number(m[8] ?? "0");
  const offM = Number(m[9] ?? "0");
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    !(
      inRange(year, MIN_EXPIRY_YEAR, 9999) &&
      inRange(month, 1, 12) &&
      inRange(day, 1, daysInMonth) &&
      inRange(hour, 0, 23) &&
      inRange(minute, 0, 59) &&
      inRange(second, 0, 59) &&
      inRange(offH, 0, 23) &&
      inRange(offM, 0, 59)
    )
  ) {
    return null;
  }
  const sign = m[7] === "-" ? -1 : 1;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  return utc - sign * (offH * 60 + offM) * 60_000;
}

/**
 * 토큰 검사 결과.
 *  - 토큰 검사가 꺼져 있으면 통과(기존 방식, 허용 목록만 적용).
 *  - 켜졌는데 서버 토큰이 없으면 **거부**(설정 누락을 열린 문으로 두지 않는다).
 *  - 헤더가 없거나 형식이 다르거나 값이 다르면 거부. 비교는 sha256 해시끼리 timingSafeEqual(길이 노출 방지).
 */
export function checkReadonlyToken(
  authorizationHeader: string | null,
  nowMs: number = Date.now()
): "ok" | "unauthorized" {
  if (!mcpTokenRequired()) {
    return "ok";
  }
  const expected = process.env.FINDABLE_MCP_PREVIEW_TOKEN ?? "";
  if (expected === "") {
    return "unauthorized";
  }
  // 만료 시각이 없거나 엄격 형식이 아니거나 지났으면 거부(만료 없는 토큰을 열린 문으로 두지 않는다).
  const expiresAt = parseStrictExpiry(
    process.env.FINDABLE_MCP_PREVIEW_TOKEN_EXPIRES_AT ?? ""
  );
  if (expiresAt === null || expiresAt <= nowMs) {
    return "unauthorized";
  }
  const match = BEARER_RE.exec((authorizationHeader ?? "").trim());
  if (!match?.[1]) {
    return "unauthorized";
  }
  return timingSafeEqual(sha256(match[1].trim()), sha256(expected))
    ? "ok"
    : "unauthorized";
}
