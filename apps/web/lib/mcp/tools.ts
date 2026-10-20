// MCP 도구 3개 정의. 설명에는 **동작 사실만** 쓴다(Anthropic 심사는 모델에게 행동을 지시하는 설명을 거절).
// 다음 행동 안내는 응답값의 message_ko 에 넣는다. 모든 도구에 title + annotations 를 단다.

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  type BridgeDeps,
  getAiVisibilityResult,
  type Language,
  startAiVisibilityCheck,
} from "./audit-bridge";
import { READONLY_ERROR_MESSAGES_KO } from "./geo-schemas";
import {
  guardedOfficialFacts,
  legacyFactsResponse,
  type ReadonlyDb,
} from "./geo-tools";
import { ERROR_MESSAGES_KO, type McpErrorCode, mapUrlError } from "./messages";
import type { FetchLike } from "./official-facts";

export interface ToolContext {
  /** 출처 추적용(UTM). 'claude' | 'chatgpt' | 'perplexity' | 'cursor' | 'other' */
  client: string;
  deps: BridgeDeps;
  /**
   * check_official_facts 가 읽어도 되는 브랜드(허용 목록 + 읽기 전용 DB 손잡이). **없으면 이 도구는 모든 주소를 거부한다(fail-closed).**
   * 임의 URL·사설 주소·허용 도메인 밖 리다이렉트는 읽지 않는다(코덱스 4차 판정, 대표 결정 P-1).
   */
  factsGuard?: { allowlist: ReadonlySet<string>; db: ReadonlyDb };
  fetchImpl?: FetchLike;
  log: { error: (event: string, data?: Record<string, unknown>) => void };
}

const urlField = z
  .string()
  .min(1)
  .max(2048)
  .describe("점검할 브랜드의 공개 사이트 주소. 예: https://example.co.kr");
const brandField = z
  .string()
  .max(100)
  .optional()
  .describe("브랜드(회사) 이름. 같은 이름의 다른 회사와 구분하는 데 쓴다.");

const factsOutput = z.looseObject({
  checked_url: z.string(),
  checked_at: z.string(),
  summary_ko: z.string(),
  limits_ko: z.string(),
  items: z.array(
    z.looseObject({ key: z.string(), status: z.string(), detail: z.string() })
  ),
});
const stateOutput = z.looseObject({ state: z.string() });

function ok(structured: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

function fail(code: McpErrorCode) {
  const payload = { error: { code, message_ko: ERROR_MESSAGES_KO[code] } };
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

/** 허용 목록 밖·없는 브랜드와 같은 모양의 거부(존재 여부를 알리지 않는다). */
function failFacts() {
  const payload = {
    error: {
      code: "not_available",
      message_ko: READONLY_ERROR_MESSAGES_KO.not_available,
    },
  };
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

function isUrlError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("URL_");
}

export function registerFindableTools(
  server: McpServer,
  ctx: ToolContext
): void {
  server.registerTool(
    "check_official_facts",
    {
      title: "공식 사실·AI 크롤러 점검",
      description:
        "허용 목록에 등록된 브랜드의 공개 사이트에서 AI 검색엔진 관련 파일·설정 항목의 유무를 확인합니다. llms.txt, robots.txt의 AI 크롤러 허용 여부, 구조화 데이터(JSON-LD), sitemap.xml 유무를 확인합니다. AI 엔진에 질의하지 않으며 보통 몇 초 걸립니다. / Checks which AI-search related files and settings exist on the registered public site of an allow-listed brand (llms.txt, AI crawler rules in robots.txt, JSON-LD, sitemap).",
      inputSchema: z.object({ url: urlField, brand_name: brandField }),
      outputSchema: factsOutput,
      annotations: {
        title: "공식 사실·AI 크롤러 점검",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url }) => {
      try {
        if (!ctx.factsGuard) {
          return failFacts();
        }
        const guarded = await guardedOfficialFacts(
          { ...ctx.factsGuard, fetchImpl: ctx.fetchImpl },
          url
        );
        if ("error" in guarded) {
          return failFacts();
        }
        return ok(legacyFactsResponse(guarded.out, guarded.summary_ko));
      } catch (error) {
        if (isUrlError(error)) {
          return fail(mapUrlError(error));
        }
        ctx.log.error("mcp.facts.failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return fail("internal");
      }
    }
  );

  server.registerTool(
    "start_ai_visibility_check",
    {
      title: "AI 노출 간이 진단 시작",
      description:
        "브랜드 사이트 주소로 ChatGPT·Claude·네이버 등 AI 엔진 답변에서의 브랜드 노출 간이 진단을 시작합니다. 최근 24시간 안에 측정된 결과가 있으면 그 결과를 바로 반환하고, 없고 새 측정이 허용되면 job_id를 반환합니다(측정에 약 3분). 새 측정은 하루 한도가 있습니다. / Starts a quick AI-visibility check for a brand site; returns a cached result (24h) immediately or a job_id for a new ~3-minute measurement.",
      inputSchema: z.object({
        url: urlField,
        brand_name: brandField,
        language: z
          .enum(["ko", "en", "both"])
          .default("ko")
          .describe("측정 언어. 기본 한국어."),
      }),
      outputSchema: stateOutput,
      annotations: {
        title: "AI 노출 간이 진단 시작",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url, brand_name, language }) => {
      try {
        const out = await startAiVisibilityCheck(
          {
            url,
            brandName: brand_name ?? null,
            language: language as Language,
            client: ctx.client,
          },
          ctx.deps
        );
        return ok(out as unknown as Record<string, unknown>);
      } catch (error) {
        if (isUrlError(error)) {
          return fail(mapUrlError(error));
        }
        ctx.log.error("mcp.start.failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return fail("internal");
      }
    }
  );

  server.registerTool(
    "get_ai_visibility_result",
    {
      title: "AI 노출 진단 결과 조회",
      description:
        "start_ai_visibility_check 가 반환한 job_id 의 진행 상태와 결과를 조회합니다. 비용이 들지 않습니다. / Returns the status and result of a job started by start_ai_visibility_check. Free to call.",
      inputSchema: z.object({
        job_id: z.string().min(1).max(64).describe("측정 번호(UUID)"),
        brand_name: brandField,
      }),
      outputSchema: stateOutput,
      annotations: {
        title: "AI 노출 진단 결과 조회",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ job_id, brand_name }) => {
      try {
        const out = await getAiVisibilityResult(
          { jobId: job_id, brandName: brand_name ?? null, client: ctx.client },
          ctx.deps
        );
        if ("notFound" in out) {
          return fail("job_not_found");
        }
        return ok(out as unknown as Record<string, unknown>);
      } catch (error) {
        ctx.log.error("mcp.get.failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return fail("internal");
      }
    }
  );
}
