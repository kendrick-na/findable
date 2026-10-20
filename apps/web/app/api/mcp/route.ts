// /api/mcp — Findable AI 노출 점검 커넥터(원격 MCP, Streamable HTTP, 읽기 위주).
//
// 🔴 기본 꺼짐: env `FINDABLE_MCP_ENABLED` 가 켜져야 동작한다(꺼져 있으면 503, 원가 0).
//   새 AI 측정 시작은 별도 `FINDABLE_MCP_MEASURE_ENABLED` — 대표 결정 전에는 켜지 않는다.
//   설계·근거: Findable_성장전략/플러그인MCP/08_개발기획서.md
//
// 위치가 apps/web 인 이유: 진단 엔진·24h 캐시·전역 예산·URL 안전검사가 여기 있다.
// ⚠️ apps/api 는 배포되지 않는 죽은 앱이다 — 거기에 두지 말 것.
// 인증: 1단계는 무인증(공개 데이터). 호출 IP 가 Claude·ChatGPT 서버라 IP 별 제한은 쓰지 않고
//   도메인 캐시·MCP 일일 상한·전역 예산으로 막는다(`lib/mcp/audit-bridge.ts`).

import { log } from "@repo/observability/log";
import { createMcpHandler } from "mcp-handler";
import { type NextRequest, NextResponse } from "next/server";

import { mcpEnabled } from "../../../lib/mcp/flags";
import {
  detectClient,
  isOriginAllowed,
  makeBridgeDeps,
} from "../../../lib/mcp/server";
import { registerFindableTools } from "../../../lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 측정 자체는 응답 뒤(`after`)에서 도는 기존 방식과 같다(POST /api/audit 과 동일한 상한).
export const maxDuration = 300;

function handle(request: NextRequest): Response | Promise<Response> {
  if (!mcpEnabled()) {
    return NextResponse.json({ error: "Not available" }, { status: 503 });
  }
  if (!isOriginAllowed(request.headers.get("origin"))) {
    return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  }
  const client = detectClient(request.headers.get("user-agent"));
  const handler = createMcpHandler(
    (server) =>
      registerFindableTools(server, {
        client,
        deps: makeBridgeDeps(),
        log: { error: (event, data) => log.error(event, data) },
      }),
    {
      serverInfo: { name: "findable", version: "1.0.0" },
      instructions:
        "Findable: 한국 브랜드의 AI 답변 노출 점검(읽기 전용). 사이트 공식 사실 점검과 AI 노출 간이 진단 결과를 제공합니다.",
    }
  );
  return handler(request);
}

export { handle as GET, handle as POST };
