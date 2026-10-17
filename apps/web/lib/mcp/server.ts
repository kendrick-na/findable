// 라우트가 쓰는 조립부: 클라이언트 판별·Origin 검사·실제 의존성 연결.

import { runAuditJob } from "@repo/audit/runner";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { after } from "next/server";

import { findCachedByDomain, isDailyBudgetExhausted } from "../audit-gates";
import type { BridgeDeps } from "./audit-bridge";

/** 호출한 AI 클라이언트(출처 추적용 UTM). 헤더 기반 추정이라 분석용이며 보안 판단에 쓰지 않는다. */
export function detectClient(userAgent: string | null): string {
  const ua = (userAgent ?? "").toLowerCase();
  if (ua.includes("claude") || ua.includes("anthropic")) {
    return "claude";
  }
  if (ua.includes("chatgpt") || ua.includes("openai")) {
    return "chatgpt";
  }
  if (ua.includes("perplexity")) {
    return "perplexity";
  }
  if (ua.includes("cursor")) {
    return "cursor";
  }
  return "other";
}

const DEFAULT_ALLOWED_ORIGINS = [
  "https://claude.ai",
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://www.perplexity.ai",
  "https://findable.co.kr",
  "https://www.findable.co.kr",
];

/**
 * MCP 스펙: 브라우저가 보낸 Origin 은 검증한다(DNS 리바인딩 방어).
 * 서버 간 호출(Claude·ChatGPT 백엔드, Cursor 등)은 Origin 이 없다 → 통과.
 * 허용 목록은 env `FINDABLE_MCP_ALLOWED_ORIGINS`(쉼표 구분)로 늘릴 수 있다.
 */
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) {
    return true;
  }
  const extra = (process.env.FINDABLE_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...DEFAULT_ALLOWED_ORIGINS, ...extra].includes(origin);
}

export function makeBridgeDeps(): BridgeDeps {
  return {
    after: (task) => after(task),
    db: database as unknown as BridgeDeps["db"],
    findCachedByDomain,
    isDailyBudgetExhausted,
    log: {
      info: (event, data) => log.info(event, data),
      error: (event, data) => log.error(event, data),
    },
    runAuditJob: (args) => runAuditJob(args),
  };
}

export { parseError };
