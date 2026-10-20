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

import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { createMcpHandler } from "mcp-handler";
import { type NextRequest, NextResponse } from "next/server";

import { mcpEnabled } from "../../../lib/mcp/flags";
import {
  checkReadonlyToken,
  isPreviewOrDevRuntime,
  mcpReadonlyModeBlockedHere,
  mcpReadonlyModeEnabled,
  readonlyBrandAllowlist,
  readonlyBrandDomainPins,
} from "../../../lib/mcp/geo-flags";
import { READONLY_ERROR_MESSAGES_KO } from "../../../lib/mcp/geo-schemas";
import {
  registerGeoReadonlyTools,
  toReadonlyDb,
} from "../../../lib/mcp/geo-tools";
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

// 읽기 전용 모드(FINDABLE_MCP_READONLY_MODE_ENABLED): 토큰 검사 뒤 읽기 도구 3개만 등록한다.
// start_*·get_ai_visibility_result 는 등록하지 않고, 쓰기 가능한 의존성(makeBridgeDeps)도 만들지 않는다.
function handleReadonly(request: NextRequest): Response | Promise<Response> {
  if (checkReadonlyToken(request.headers.get("authorization")) !== "ok") {
    return NextResponse.json(
      {
        error: {
          code: "unauthorized",
          message_ko: READONLY_ERROR_MESSAGES_KO.unauthorized,
        },
      },
      { status: 401 }
    );
  }
  const handler = createMcpHandler(
    (server) =>
      registerGeoReadonlyTools(server, {
        allowlist: readonlyBrandAllowlist(),
        db: toReadonlyDb(database),
        domainPins: readonlyBrandDomainPins(),
        log: { error: (event, data) => log.error(event, data) },
      }),
    {
      serverInfo: { name: "findable", version: "1.0.0" },
      instructions:
        "Findable: 허용 목록 브랜드의 저장된 AI 노출 측정 결과를 읽기 전용으로 제공합니다. 새 측정을 시작하지 않습니다.",
    }
  );
  return handler(request);
}

function handle(request: NextRequest): Response | Promise<Response> {
  if (!mcpEnabled()) {
    return NextResponse.json({ error: "Not available" }, { status: 503 });
  }
  if (!isOriginAllowed(request.headers.get("origin"))) {
    return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  }
  if (mcpReadonlyModeBlockedHere()) {
    // 프리뷰 한정 장치: 운영에서 읽기 전용 모드가 켜져 있으면 도구를 등록하지 않고 거부한다(기존 도구로 되돌아가지도 않는다).
    return NextResponse.json({ error: "Not available" }, { status: 503 });
  }
  if (mcpReadonlyModeEnabled()) {
    return handleReadonly(request);
  }
  const client = detectClient(request.headers.get("user-agent"));
  const handler = createMcpHandler(
    (server) =>
      registerFindableTools(server, {
        client,
        deps: makeBridgeDeps(),
        // 공식 정보 점검은 허용 목록 브랜드의 등록 도메인만 읽는다(허용 목록이 비면 전부 거부).
        // 프리뷰·개발 환경이 아니면(운영·알 수 없는 값) 가드를 주지 않아 이 도구가 모든 주소를 거부한다(fail-closed).
        ...(isPreviewOrDevRuntime()
          ? {
              factsGuard: {
                allowlist: readonlyBrandAllowlist(),
                db: toReadonlyDb(database),
                domainPins: readonlyBrandDomainPins(),
              },
            }
          : {}),
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
