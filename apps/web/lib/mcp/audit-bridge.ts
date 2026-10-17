// MCP 도구 ↔ 진단 엔진 연결. 캐시·예산은 `lib/audit-gates.ts`(POST /api/audit 과 같은 로직)를 쓴다.
//
// 설계 불변식(2026-10-17 개발기획서):
//   - 공개 무료 진단(FREE_AUDIT_PUBLIC_ENABLED)은 대표 결정으로 꺼져 있다. 새 측정은 별도 플래그
//     `FINDABLE_MCP_MEASURE_ENABLED` 가 켜져야만 시작한다. 꺼져 있으면 캐시만 보여 준다.
//   - 이메일 열에는 시스템 주소만 넣는다(`org:` 금지). 영업 리드(`database.lead`)는 만들지 않는다.
//   - 다른 사용자의 job 은 조회하지 않는다(MCP 가 만든 job 만). 캐시 히트도 job_id 를 노출하지 않는다.
//   - 응답에 이메일·내부 비용·crew 결과·PDF 주소를 넣지 않는다.

import {
  assertPublicUrl,
  normalizePublicUrl,
} from "@repo/audit/public-url-security";

import {
  DEFAULT_MCP_DAILY_JOB_CAP,
  mcpDailyJobCap,
  mcpMeasureEnabled,
  MCP_SYSTEM_EMAIL,
} from "./flags";
import { siteLink } from "./messages";
import { type McpAuditResult, toMcpResult } from "./result";

export type Language = "ko" | "en" | "both";

type StartOutcome =
  | { source: "cache"; state: "completed"; result: McpAuditResult }
  | {
      expected_total_seconds: number;
      job_id: string;
      message_ko: string;
      poll_after_seconds: number;
      state: "started";
    }
  | {
      message_ko: string;
      reason: "daily_budget" | "mcp_daily_cap";
      retry_after_seconds: number;
      state: "rate_limited";
    }
  | {
      message_ko: string;
      site_link: string;
      state: "measurement_unavailable";
    }
  | { message_ko: string; state: "result_unavailable"; site_link: string };

export type StartResult = StartOutcome;

export type PollResult =
  | {
      message_ko: string;
      poll_after_seconds: number;
      state: "processing";
    }
  | { result: McpAuditResult; state: "completed" }
  | {
      message_ko: string;
      state: "failed" | "result_unavailable";
      site_link: string;
    };

/** DB 에 닿는 부분은 주입한다(테스트에서 가짜로 교체). */
export interface BridgeDeps {
  /** 응답 후 백그라운드 실행(Next `after`). */
  after: (task: () => Promise<void>) => void;
  db: {
    auditJob: {
      count: (args: unknown) => Promise<number>;
      create: (args: unknown) => Promise<{ id: string }>;
      findFirst: (args: unknown) => Promise<{ id: string } | null>;
      findUnique: (args: unknown) => Promise<{
        completedAt: Date | null;
        createdAt: Date;
        domain: string;
        email: string;
        result: unknown;
        status: "queued" | "processing" | "completed" | "failed";
      } | null>;
    };
  };
  findCachedByDomain: (
    domain: string,
    language: Language
  ) => Promise<string | null>;
  isDailyBudgetExhausted: () => Promise<boolean>;
  log: {
    error: (event: string, data?: Record<string, unknown>) => void;
    info: (event: string, data?: Record<string, unknown>) => void;
  };
  runAuditJob: (args: {
    domain: string;
    invocationStartedAtMs: number;
    jobId: string;
    language: Language;
    brandName?: string;
  }) => Promise<unknown>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const IN_PROGRESS_WINDOW_MS = 30 * 60 * 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function startAiVisibilityCheck(
  input: {
    brandName: string | null;
    client: string;
    language: Language;
    url: string;
  },
  deps: BridgeDeps
): Promise<StartResult> {
  // URL 오류(URL_*)는 호출자가 mapUrlError 로 변환한다.
  const url = normalizePublicUrl(input.url);
  await assertPublicUrl(url);
  const domain = url.hostname.toLowerCase();

  // ① 캐시 — 새 측정이 아니므로 원가 0. 항상 먼저 본다(예산 소진·측정 꺼짐 중에도 동작).
  const cachedId = await deps.findCachedByDomain(domain, input.language);
  if (cachedId) {
    const cached = await deps.db.auditJob.findUnique({
      where: { id: cachedId },
      select: {
        completedAt: true,
        createdAt: true,
        domain: true,
        email: true,
        result: true,
        status: true,
      },
    });
    const mapped = cached
      ? toMcpResult(cached, input.brandName, input.client)
      : null;
    if (mapped) {
      deps.log.info("mcp.cache.hit", { domain });
      return { state: "completed", source: "cache", result: mapped };
    }
    // 표시할 수 없는 캐시(품질 미달)는 없는 것으로 본다.
  }

  // ② 새 측정은 별도 플래그가 켜져 있을 때만.
  if (!mcpMeasureEnabled()) {
    return {
      state: "measurement_unavailable",
      message_ko:
        "최근 24시간 안에 측정된 결과가 없고, 현재 이 커넥터에서는 새 AI 노출 측정을 받지 않습니다. 사이트 공식 사실 점검은 사용할 수 있습니다.",
      site_link: siteLink(input.client),
    };
  }

  // ③ 같은 도메인 진행 중이면 같은 job 을 돌려준다(중복 측정 방지).
  const inProgress = await deps.db.auditJob.findFirst({
    where: {
      email: MCP_SYSTEM_EMAIL,
      domain,
      language: input.language,
      status: { in: ["queued", "processing"] },
      createdAt: { gte: new Date(Date.now() - IN_PROGRESS_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (inProgress) {
    return startedResponse(inProgress.id);
  }

  // ④ MCP 전용 일일 상한 + 기존 전역 무료 예산.
  const cap = mcpDailyJobCap();
  const startedToday = await deps.db.auditJob.count({
    where: {
      email: MCP_SYSTEM_EMAIL,
      createdAt: { gte: new Date(Date.now() - DAY_MS) },
      NOT: { status: "failed" },
    },
  });
  if (startedToday >= cap) {
    deps.log.info("mcp.cap.reached", { cap: cap || DEFAULT_MCP_DAILY_JOB_CAP });
    return rateLimited("mcp_daily_cap");
  }
  if (await deps.isDailyBudgetExhausted()) {
    deps.log.info("mcp.budget.exhausted", { domain });
    return rateLimited("daily_budget");
  }

  // ⑤ 새 측정 시작. 이메일 열은 시스템 주소, 리드는 만들지 않는다.
  const startedAtMs = Date.now();
  const job = await deps.db.auditJob.create({
    data: {
      email: MCP_SYSTEM_EMAIL,
      domain,
      language: input.language,
      ipAddress: null,
    },
    select: { id: true },
  });
  deps.log.info("mcp.job.created", { jobId: job.id, domain });
  deps.after(async () => {
    try {
      await deps.runAuditJob({
        invocationStartedAtMs: startedAtMs,
        jobId: job.id,
        domain,
        language: input.language,
        brandName: input.brandName ?? undefined,
      });
    } catch (error) {
      deps.log.error("mcp.job.uncaught", {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return startedResponse(job.id);
}

function startedResponse(jobId: string): StartResult {
  return {
    state: "started",
    job_id: jobId,
    poll_after_seconds: 20,
    expected_total_seconds: 180,
    message_ko:
      "측정을 시작했습니다. 약 3분 걸립니다. 20초 뒤 get_ai_visibility_result 로 진행 상태를 확인할 수 있습니다.",
  };
}

function rateLimited(reason: "daily_budget" | "mcp_daily_cap"): StartResult {
  return {
    state: "rate_limited",
    reason,
    retry_after_seconds: 3600,
    message_ko:
      reason === "mcp_daily_cap"
        ? "오늘 이 커넥터로 시작할 수 있는 새 측정 한도에 도달했습니다. 내일 다시 시도해 주세요. 이미 측정된 도메인은 한도와 관계없이 결과를 볼 수 있습니다."
        : "오늘 무료 측정 한도에 도달했습니다. 내일 다시 시도해 주세요. 이미 측정된 도메인은 결과를 볼 수 있습니다.",
  };
}

export async function getAiVisibilityResult(
  input: { brandName: string | null; client: string; jobId: string },
  deps: BridgeDeps
): Promise<PollResult | { notFound: true }> {
  if (!UUID_RE.test(input.jobId)) {
    return { notFound: true };
  }
  const job = await deps.db.auditJob.findUnique({
    where: { id: input.jobId },
    select: {
      completedAt: true,
      createdAt: true,
      domain: true,
      email: true,
      result: true,
      status: true,
    },
  });
  // 🔒 MCP 가 만든 job 만. 다른 경로(무료 폼·로그인 앱)의 job 은 UUID 를 알아도 보여 주지 않는다.
  if (!job || job.email !== MCP_SYSTEM_EMAIL) {
    return { notFound: true };
  }
  if (job.status === "queued" || job.status === "processing") {
    return {
      state: "processing",
      poll_after_seconds: 15,
      message_ko: "측정이 진행 중입니다. 15초 뒤 다시 확인할 수 있습니다.",
    };
  }
  if (job.status === "failed") {
    return {
      state: "failed",
      message_ko: "측정에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      site_link: siteLink(input.client),
    };
  }
  const mapped = toMcpResult(job, input.brandName, input.client);
  if (!mapped) {
    return {
      state: "result_unavailable",
      message_ko:
        "측정은 끝났지만 결과의 신뢰도가 낮아(응답을 받은 엔진이 부족) 표시하지 않습니다. 다시 시도해 주세요.",
      site_link: siteLink(input.client),
    };
  }
  return { state: "completed", result: mapped };
}
