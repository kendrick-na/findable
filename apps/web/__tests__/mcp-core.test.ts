/**
 * MCP 커넥터 — 스위치·문구 규칙. @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MCP_DAILY_JOB_CAP,
  MCP_SYSTEM_EMAIL,
  mcpDailyJobCap,
  mcpEnabled,
  mcpMeasureEnabled,
} from "@/lib/mcp/flags";
import {
  ERROR_MESSAGES_KO,
  FACTS_LIMITS_KO,
  LIMITS_KO,
  mapUrlError,
  siteLink,
} from "@/lib/mcp/messages";

afterEach(() => vi.unstubAllEnvs());

describe("스위치 — 둘 다 기본 꺼짐", () => {
  it("아무 설정이 없으면 서버도 측정도 꺼져 있다", () => {
    expect(mcpEnabled()).toBe(false);
    expect(mcpMeasureEnabled()).toBe(false);
  });

  it("측정 플래그만 켜도 서버 플래그가 꺼져 있으면 측정은 꺼진 채다", () => {
    vi.stubEnv("FINDABLE_MCP_MEASURE_ENABLED", "true");
    expect(mcpMeasureEnabled()).toBe(false);
  });

  it("서버 플래그만 켜면 서버만 켜지고 측정은 꺼진 채다", () => {
    vi.stubEnv("FINDABLE_MCP_ENABLED", "true");
    expect(mcpEnabled()).toBe(true);
    expect(mcpMeasureEnabled()).toBe(false);
  });

  it("둘 다 켜야 측정이 켜진다", () => {
    vi.stubEnv("FINDABLE_MCP_ENABLED", "1");
    vi.stubEnv("FINDABLE_MCP_MEASURE_ENABLED", "on");
    expect(mcpMeasureEnabled()).toBe(true);
  });

  it("일일 상한 기본 2건, 숫자가 아니면 기본값, 0 은 측정 전면 중단", () => {
    expect(mcpDailyJobCap()).toBe(DEFAULT_MCP_DAILY_JOB_CAP);
    expect(DEFAULT_MCP_DAILY_JOB_CAP).toBe(2);
    vi.stubEnv("FINDABLE_MCP_DAILY_JOB_CAP", "abc");
    expect(mcpDailyJobCap()).toBe(2);
    vi.stubEnv("FINDABLE_MCP_DAILY_JOB_CAP", "0");
    expect(mcpDailyJobCap()).toBe(0);
    vi.stubEnv("FINDABLE_MCP_DAILY_JOB_CAP", "5");
    expect(mcpDailyJobCap()).toBe(5);
  });

  it("시스템 주소는 org: 이름공간(유료 게이트 통과)과 겹치지 않고 유효한 이메일 형식이다", () => {
    expect(MCP_SYSTEM_EMAIL.toLowerCase().startsWith("org:")).toBe(false);
    expect(MCP_SYSTEM_EMAIL).toMatch(/^[^@\s:]+@[^@\s]+\.[^@\s]+$/);
  });
});

describe("문구 정책 — 업그레이드·결제 유도 금지(ChatGPT 정책)", () => {
  const FORBIDDEN = [
    /업그레이드/,
    /결제/,
    /요금제/,
    /구독/,
    /프리미엄/,
    /할인/,
    /무료\s*체험/,
    /\/pricing/i,
    /upgrade/i,
    /\bpro\b/i,
  ];

  const all = [
    LIMITS_KO,
    FACTS_LIMITS_KO,
    ...Object.values(ERROR_MESSAGES_KO),
    siteLink("claude"),
  ];

  it.each(all.map((t) => [t]))("금지 문구가 없다: %s", (text) => {
    for (const re of FORBIDDEN) {
      expect(text).not.toMatch(re);
    }
  });

  it("정보 링크는 가격·결제가 아닌 첫 화면 + 출처 UTM", () => {
    const url = new URL(siteLink("chatgpt"));
    expect(url.origin).toBe("https://findable.co.kr");
    expect(url.pathname).toBe("/ko");
    expect(url.searchParams.get("utm_source")).toBe("mcp");
    expect(url.searchParams.get("utm_medium")).toBe("chatgpt");
  });

  it("한계 문구는 '매번 달라질 수 있음'과 '점수 하나로 판단 금지'를 말한다", () => {
    expect(LIMITS_KO).toMatch(/매번 달라질 수 있/);
    expect(LIMITS_KO).toMatch(/점수 하나로/);
  });

  it("URL 오류 코드를 사람 말 코드로 바꾼다", () => {
    expect(mapUrlError(new Error("URL_PRIVATE"))).toBe("private_address");
    expect(mapUrlError(new Error("URL_INVALID"))).toBe("url_invalid");
    expect(mapUrlError(new Error("URL_PROTOCOL"))).toBe("url_invalid");
    expect(mapUrlError(new Error("URL_DNS"))).toBe("dns_failed");
    expect(mapUrlError(new Error("URL_REQUIRED"))).toBe("url_required");
    expect(mapUrlError(new Error("URL_UNSAFE"))).toBe("url_unsafe");
    expect(mapUrlError(new Error("뭔가 이상한 내부 오류: DB 비밀번호"))).toBe(
      "internal"
    );
    expect(mapUrlError("문자열")).toBe("internal");
  });
});
