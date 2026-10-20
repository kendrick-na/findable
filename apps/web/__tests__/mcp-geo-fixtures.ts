// 읽기 전용 MCP 시험 공용 재료(시험 파일 아님). 고정 입력·가짜 DB 뿐이며 외부 호출·실제 DB 는 없다.
import { MENTION_VERDICT_VERSION } from "@repo/ai/lib/mention-verdict-version";
import { NextRequest } from "next/server";

export const BRAND_ID = "11111111-2222-4333-8444-555555555555";
export const OTHER_BRAND_ID = "99999999-2222-4333-8444-555555555555";
export const BRAND_DOMAIN = "brand.example";
export const BRAND_NAME = "시험브랜드";

type Row = Record<string, unknown>;

function row(
  engineId: string,
  kind: "brand" | "discovery",
  verdict: "confirmed" | "different_entity" | "unknown" | "error",
  extra: Row = {}
): Row {
  return {
    engineId,
    promptKind: kind,
    promptLang: "ko",
    brandMentioned: verdict === "confirmed" || verdict === "different_entity",
    mentionQuality:
      verdict === "confirmed" || verdict === "different_entity"
        ? verdict
        : undefined,
    errorMessage: verdict === "error" ? "engine failed" : null,
    isStub: false,
    citedSources: [],
    rawResponse: "원문 전체(응답에 실리면 안 됨) 사업자번호 000-00-00000",
    ...extra,
  };
}

/** 고정 입력: AI 브랜드 질문 12행(제대로 5·다른 회사 1·모름 5·실패 1), 발굴 2행, 검색 1행. */
export const FIXTURE_ROWS: Row[] = [
  row("chatgpt", "brand", "confirmed"),
  row("chatgpt", "brand", "confirmed"),
  row("chatgpt", "brand", "confirmed"),
  row("claude", "brand", "confirmed"),
  row("claude", "brand", "confirmed"),
  row("claude", "brand", "unknown"),
  row("perplexity", "brand", "different_entity"),
  row("perplexity", "brand", "unknown"),
  row("perplexity", "brand", "error"),
  row("gemini", "brand", "unknown"),
  row("gemini", "brand", "unknown"),
  row("gemini", "brand", "unknown"),
  row("chatgpt", "discovery", "confirmed"),
  row("claude", "discovery", "unknown"),
  row("naver", "brand", "confirmed", { naverSource: "search_results" }),
];

export function makeResult(
  rows: Row[] = FIXTURE_ROWS
): Record<string, unknown> {
  return {
    domain: BRAND_DOMAIN,
    mentionVerdictVersion: MENTION_VERDICT_VERSION,
    metrics: {},
    engineResponses: rows,
  };
}

export const JOB_ID = "aaaaaaaa-2222-4333-8444-555555555555";

export function makeJob(result: unknown = makeResult()) {
  return {
    id: JOB_ID,
    completedAt: new Date("2026-10-20T01:00:00.000Z"),
    createdAt: new Date("2026-10-20T00:55:00.000Z"),
    result,
  };
}

/**
 * 읽기만 허용하는 가짜 DB. auditJob.findMany/findFirst·brand.findFirst 외의 모든 접근(쓰기·raw·다른 모델)은
 * `writes` 에 기록되고 **불리면 던진다**. 시험은 `writes` 가 비어 있음을 단언한다.
 */
export function makeWatchedDb(opts: {
  brand: Record<string, unknown> | null;
  job: Record<string, unknown> | null;
}) {
  const reads: string[] = [];
  const writes: string[] = [];
  const allowed: Record<
    string,
    Record<string, (...a: unknown[]) => unknown>
  > = {
    auditJob: {
      findFirst: async () => opts.job,
      findMany: async () => (opts.job ? [opts.job] : []),
    },
    brand: { findFirst: async () => opts.brand },
  };
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, prop) => {
          const fn = allowed[name]?.[String(prop)];
          if (fn) {
            return (...args: unknown[]) => {
              reads.push(`${name}.${String(prop)}`);
              return fn(...args);
            };
          }
          return (..._args: unknown[]) => {
            writes.push(`${name}.${String(prop)}`);
            throw new Error(`forbidden db access: ${name}.${String(prop)}`);
          };
        },
      }
    );
  const db = new Proxy(
    {},
    {
      get: (_t, prop) => {
        const name = String(prop);
        if (name === "auditJob" || name === "brand") {
          return model(name);
        }
        return (..._args: unknown[]) => {
          writes.push(name);
          throw new Error(`forbidden db access: ${name}`);
        };
      },
    }
  );
  return { db, reads, writes };
}

const HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

export async function rpc(
  method: string,
  params: unknown = {},
  extra: Record<string, string> = {}
) {
  const { POST } = await import("@/app/api/mcp/route");
  const response = await POST(
    new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      headers: { ...HEADERS, ...extra },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })
  );
  const text = await response.text();
  const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
  const json = dataLine ? dataLine.slice(5).trim() : text;
  let body: unknown = null;
  try {
    body = JSON.parse(json);
  } catch {
    body = text;
  }
  return { status: response.status, body: body as Record<string, any> };
}

/** 키 이름을 재귀로 훑어 모은다(비공개 필드 검사용). */
export function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) {
      allKeys(v, out);
    }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}
