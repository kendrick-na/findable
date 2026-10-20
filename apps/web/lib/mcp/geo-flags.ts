// 읽기 전용 MCP 모드 스위치 — **전부 기본 꺼짐/비어 있음**. 값은 환경변수에만 둔다(코드·문서·로그 출력 금지).
//
//   FINDABLE_MCP_READONLY_MODE_ENABLED     읽기 전용 모드. 켜지면 측정을 시작하는 도구(start_*)가 등록되지 않는다.
//   FINDABLE_MCP_TOKEN_REQUIRED            Authorization: Bearer 토큰 검사.
//   FINDABLE_MCP_PREVIEW_TOKEN             프리뷰 전용 토큰 값(서버 쪽 기준값, 값은 어디에도 출력하지 않는다).
//   FINDABLE_MCP_PREVIEW_TOKEN_EXPIRES_AT  토큰 만료 시각(ISO 8601). 없거나 읽을 수 없거나 지났으면 모두 거부.
//   (운영 환경 — VERCEL_ENV=production, 또는 VERCEL_ENV 가 없을 때 NODE_ENV=production — 에서는 읽기 전용 모드·점검 도구가 켜지지 않는다.)
//   FINDABLE_MCP_READONLY_BRAND_ALLOWLIST  읽어 줄 brandId 목록(쉼표). 비어 있으면 아무 브랜드도 읽지 않는다.
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
 * 운영 환경인가. Vercel 에서는 VERCEL_ENV 가 기준이다(프리뷰 배포도 NODE_ENV=production 이라 NODE_ENV 만 보면 프리뷰가 막힌다).
 * VERCEL_ENV 가 없으면(로컬·자체 서버) NODE_ENV=production 을 운영으로 본다.
 */
export function isProductionRuntime(): boolean {
  const vercelEnv = (process.env.VERCEL_ENV ?? "").trim();
  if (vercelEnv !== "") {
    return vercelEnv === "production";
  }
  return (process.env.NODE_ENV ?? "") === "production";
}

/** 읽기 전용 모드가 켜져 있는데 운영 환경이라 거부해야 하는가(시작 단계 가드). */
export function mcpReadonlyModeBlockedHere(): boolean {
  return mcpReadonlyModeEnabled() && isProductionRuntime();
}

export function mcpTokenRequired(): boolean {
  return readFlag("FINDABLE_MCP_TOKEN_REQUIRED");
}

/** 허용 brandId 집합. 비어 있으면 빈 집합(= 아무 브랜드도 못 읽음). */
export function readonlyBrandAllowlist(): ReadonlySet<string> {
  return new Set(
    (process.env.FINDABLE_MCP_READONLY_BRAND_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

const BEARER_RE = /^Bearer\s+(.+)$/i;

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
  // 만료 시각이 없거나 읽을 수 없거나 지났으면 거부(만료 없는 토큰을 열린 문으로 두지 않는다).
  const expiresAt = Date.parse(
    process.env.FINDABLE_MCP_PREVIEW_TOKEN_EXPIRES_AT ?? ""
  );
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
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
