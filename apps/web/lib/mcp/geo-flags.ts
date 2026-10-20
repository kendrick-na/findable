// 읽기 전용 MCP 모드 스위치 — **전부 기본 꺼짐/비어 있음**. 값은 환경변수에만 둔다(코드·문서·로그 출력 금지).
//
//   FINDABLE_MCP_READONLY_MODE_ENABLED     읽기 전용 모드. 켜지면 측정을 시작하는 도구(start_*)가 등록되지 않는다.
//   FINDABLE_MCP_TOKEN_REQUIRED            Authorization: Bearer 토큰 검사.
//   FINDABLE_MCP_READONLY_TOKEN            토큰 값(서버 쪽 기준값).
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
  authorizationHeader: string | null
): "ok" | "unauthorized" {
  if (!mcpTokenRequired()) {
    return "ok";
  }
  const expected = process.env.FINDABLE_MCP_READONLY_TOKEN ?? "";
  if (expected === "") {
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
