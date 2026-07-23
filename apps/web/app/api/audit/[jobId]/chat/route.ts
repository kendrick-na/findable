// POST /api/audit/[jobId]/chat — 진단 결과 코파일럿 챗 (스트리밍)
//
// 4 에이전트 분석(crewResult) 완료 후, 사용자가 진단 결과에 대해 대화로 질문.
// crewResult + metrics를 서버에서 DB로부터 읽어 시스템 컨텍스트로 주입한 뒤
// AI Gateway 경유 streamText로 응답을 스트리밍한다.
//
// 컨텍스트는 클라이언트가 보내는 게 아니라 서버가 DB에서 직접 읽는다 (변조 방지).
// 클라이언트는 messages(대화 히스토리)만 보낸다.
// Runtime: Node.js, maxDuration 60s.

import {
  type CopilotAnalyst,
  type CopilotChatMessage,
  type CopilotContext,
  type CopilotStrategist,
  isCopilotConfigured,
  streamCopilotResponse,
} from "@repo/ai/lib/crew";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

// 클라이언트가 보내는 대화 히스토리 (순수 텍스트 — @ai-sdk/react 미사용)
type ChatMessage = CopilotChatMessage;

// DB에 저장된 JSON 구조 (audit-result.tsx의 CrewReport / JobResult와 일치)
interface StoredCrewReport {
  analysts?: CopilotAnalyst[];
  strategist?: CopilotStrategist;
}
interface StoredMetrics {
  averageMentionPosition?: number | null;
  enginesCovered?: string[];
  enginesWithMention?: string[];
  sentimentDistribution?: {
    positive: number;
    neutral: number;
    negative: number;
  };
  sov?: number;
  topCitedDomains?: Array<{ domain: string; count: number }>;
}
interface StoredResult {
  brandName?: string;
  domain?: string;
  metrics?: StoredMetrics;
}

function buildMetricsSummary(result: StoredResult): string {
  const m = result.metrics;
  if (!m) {
    return "(측정 지표 없음)";
  }
  const covered = m.enginesCovered?.length ?? 0;
  const mentioned = m.enginesWithMention?.length ?? 0;
  const s = m.sentimentDistribution;
  const domains =
    m.topCitedDomains && m.topCitedDomains.length > 0
      ? m.topCitedDomains
          .slice(0, 5)
          .map((d) => `${d.domain}(${d.count})`)
          .join(", ")
      : "없음";
  return [
    `SoV(점유율): ${m.sov ?? 0}/100`,
    `언급된 엔진: ${mentioned}/${covered}개 (${(m.enginesWithMention ?? []).join(", ") || "없음"})`,
    `평균 언급 위치: ${m.averageMentionPosition ?? "N/A"}`,
    s
      ? `감성: 긍정 ${s.positive} / 중립 ${s.neutral} / 부정 ${s.negative}`
      : "감성: N/A",
    `상위 인용 도메인: ${domains}`,
  ].join("\n");
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { jobId } = await params;

  try {
    if (!jobId || typeof jobId !== "string" || jobId.length < 10) {
      return NextResponse.json(
        { error: "잘못된 jobId입니다." },
        { status: 400 }
      );
    }

    if (!isCopilotConfigured()) {
      return NextResponse.json(
        { error: "코파일럿이 아직 설정되지 않았습니다. (AI Gateway 미인증)" },
        { status: 503 }
      );
    }

    let body: { messages?: ChatMessage[] };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "잘못된 요청 본문입니다." },
        { status: 400 }
      );
    }
    const rawMessages = body.messages;
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return NextResponse.json(
        { error: "messages가 필요합니다." },
        { status: 400 }
      );
    }
    // 화이트리스트 검증 — user/assistant + 문자열 content만 통과
    const messages = rawMessages
      .filter(
        (m): m is ChatMessage =>
          (m?.role === "user" || m?.role === "assistant") &&
          typeof m?.content === "string" &&
          m.content.length > 0
      )
      .slice(-20); // 히스토리 상한
    if (messages.length === 0) {
      return NextResponse.json(
        { error: "유효한 messages가 없습니다." },
        { status: 400 }
      );
    }

    const job = await database.auditJob.findUnique({
      where: { id: jobId },
      select: { id: true, crewStatus: true, crewResult: true, result: true },
    });

    if (!job) {
      return NextResponse.json(
        { error: "존재하지 않는 jobId입니다." },
        { status: 404 }
      );
    }
    if (job.crewStatus !== "completed" || !job.crewResult) {
      return NextResponse.json(
        {
          error: "4 에이전트 분석이 먼저 완료되어야 합니다.",
          crewStatus: job.crewStatus,
        },
        { status: 400 }
      );
    }

    const crew = job.crewResult as unknown as StoredCrewReport;
    const result = (job.result as unknown as StoredResult) ?? {};
    if (!(crew.analysts && crew.strategist)) {
      return NextResponse.json(
        { error: "이 진단은 코파일럿을 지원하지 않는 옛 형식입니다." },
        { status: 400 }
      );
    }

    const ctx: CopilotContext = {
      brandName: result.brandName ?? "이 브랜드",
      domain: result.domain ?? "",
      metricsSummary: buildMetricsSummary(result),
      analysts: crew.analysts,
      strategist: crew.strategist as CopilotStrategist,
    };

    log.info("audit.chat.stream", { jobId, turns: messages.length });

    // AI SDK 의존성은 @repo/ai가 소유 — 앱은 ai를 직접 import 안 함
    // 클라이언트는 @ai-sdk/react 없이 fetch로 순수 텍스트 스트림을 직접 읽음
    return streamCopilotResponse(ctx, messages);
  } catch (error) {
    const message = parseError(error);
    log.error("audit.chat.unhandled", { jobId, error: message });
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
