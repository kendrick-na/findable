import { isApiSearchEngineSetActive } from "@repo/ai/lib/engines/engine-set";
import { database } from "@repo/database";
import type { EngineWindowStats, FinishedJobSignal } from "./evaluate";

/**
 * 운영 점검용 **읽기 전용** 조회. 쓰기 없음. 큰 JSON 을 통째로 읽지 않으려고 필요한 조각만 SQL 로 뽑는다
 * (측정 결과 JSON 은 작업당 수백 KB 가 될 수 있다).
 * 개인정보(이메일·IP·도메인)는 조회하지 않는다.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** 쿼터 오류 문구 — `packages/audit/answer-buckets.ts` 의 QUOTA_RE 와 같은 낱말(PG 정규식으로 옮김). */
const QUOTA_PG_RE = "quota|exceeded|credit|billing|한도";

interface RawEngineRow {
  cells: number;
  engineId: string;
}
interface RawErrorRow {
  empty: number;
  engineId: string;
  error: number;
  rate_limit: number;
  recovered: number;
  timeout: number;
}

/** ① 최근 1시간에 완료된 작업의 엔진별 칸 수·오류 수(`measurementContext.engineErrors` 기반). */
export async function loadEngineWindowStats(
  now: Date
): Promise<EngineWindowStats[]> {
  const since = new Date(now.getTime() - HOUR_MS);
  const cells = await database.$queryRaw<RawEngineRow[]>`
    SELECT e->>'engineId' AS "engineId", count(*)::int AS "cells"
    FROM "AuditJob" j,
      jsonb_array_elements(
        CASE WHEN jsonb_typeof(j."result"->'engineResponses') = 'array'
             THEN j."result"->'engineResponses' ELSE '[]'::jsonb END
      ) e
    WHERE j."status" = 'completed' AND j."completedAt" >= ${since}
      AND e->>'engineId' IS NOT NULL
    GROUP BY 1`;
  const errors = await database.$queryRaw<RawErrorRow[]>`
    SELECT b.key AS "engineId",
      sum(coalesce((b.value->>'timeout')::int, 0))::int AS "timeout",
      sum(coalesce((b.value->>'rate_limit')::int, 0))::int AS "rate_limit",
      sum(coalesce((b.value->>'empty')::int, 0))::int AS "empty",
      sum(coalesce((b.value->>'error')::int, 0))::int AS "error",
      sum(coalesce((b.value->>'recovered')::int, 0))::int AS "recovered"
    FROM "AuditJob" j,
      jsonb_each(
        CASE WHEN jsonb_typeof(j."result"->'measurementContext'->'engineErrors'->'byEngine') = 'object'
             THEN j."result"->'measurementContext'->'engineErrors'->'byEngine' ELSE '{}'::jsonb END
      ) b
    WHERE j."status" = 'completed' AND j."completedAt" >= ${since}
    GROUP BY 1`;
  const errorByEngine = new Map(errors.map((row) => [row.engineId, row]));
  return cells.map((row) => {
    const err = errorByEngine.get(row.engineId);
    const total = err
      ? err.timeout + err.rate_limit + err.empty + err.error
      : 0;
    return {
      cells: row.cells,
      engineId: row.engineId,
      // 늦게라도 답이 와서 반영된 칸(recovered)은 실패로 세지 않는다.
      failed: Math.max(0, total - (err?.recovered ?? 0)),
      rateLimited: err?.rate_limit ?? 0,
    };
  });
}

interface RawFinishedRow {
  jobQuota: boolean;
  quotaCells: number;
}

/** ② 최근 6시간 안에 끝난(완료·실패) 작업을 최신순으로 — 쿼터 계열 오류 여부만. */
export async function loadRecentFinishedQuotaSignals(
  now: Date,
  limit = 20
): Promise<FinishedJobSignal[]> {
  const since = new Date(now.getTime() - 6 * HOUR_MS);
  const rows = await database.$queryRaw<RawFinishedRow[]>`
    SELECT
      coalesce(j."errorMessage" ~* ${QUOTA_PG_RE}, false) AS "jobQuota",
      (SELECT count(*)::int
         FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(j."result"->'engineResponses') = 'array'
                THEN j."result"->'engineResponses' ELSE '[]'::jsonb END
         ) e
        WHERE coalesce(e->>'errorMessage', '') ~* ${QUOTA_PG_RE}) AS "quotaCells"
    FROM "AuditJob" j
    WHERE j."status" IN ('completed', 'failed') AND j."completedAt" >= ${since}
    ORDER BY j."completedAt" DESC
    LIMIT ${limit}`;
  return rows.map((row) => ({
    quotaError: row.jobQuota || row.quotaCells > 0,
  }));
}

/**
 * ③ 시작 안 된 queued — 「이어가기 대기」(leaseUntil 있음)는 의도된 대기라 뺀다.
 * 기준 시각은 `attemptStartedAt ?? createdAt`(stale-job.ts 와 같은 규칙).
 * ※ 30분이 지난 것은 `sweep-stuck-jobs` 가 정리한다 — 여기는 그 **전에** 알리는 것뿐(중복 정리 없음).
 */
export async function loadQueueWait(
  now: Date,
  waitMinutes: number
): Promise<{ count: number; oldestWaitMinutes: number }> {
  const cutoff = new Date(now.getTime() - waitMinutes * 60 * 1000);
  const where = {
    leaseUntil: null,
    OR: [
      { attemptStartedAt: null, createdAt: { lt: cutoff } },
      { attemptStartedAt: { lt: cutoff } },
    ],
    status: "queued" as const,
  };
  const count = await database.auditJob.count({ where });
  if (count === 0) {
    return { count: 0, oldestWaitMinutes: 0 };
  }
  const oldest = await database.auditJob.findFirst({
    orderBy: { createdAt: "asc" },
    select: { attemptStartedAt: true, createdAt: true },
    where,
  });
  const startedAt = oldest?.attemptStartedAt ?? oldest?.createdAt;
  return {
    count,
    oldestWaitMinutes: startedAt
      ? (now.getTime() - startedAt.getTime()) / 60_000
      : 0,
  };
}

/** ⑤ 최근 1시간에 끝난 작업의 완료·실패 수. */
export async function loadJobOutcomes(
  now: Date
): Promise<{ completed: number; failed: number }> {
  const since = new Date(now.getTime() - HOUR_MS);
  const [completed, failed] = await Promise.all([
    database.auditJob.count({
      where: { completedAt: { gte: since }, status: "completed" },
    }),
    database.auditJob.count({
      where: { completedAt: { gte: since }, status: "failed" },
    }),
  ]);
  return { completed, failed };
}

/**
 * ⑥ 무료 진단 하루(24시간) 건수와 상한.
 *
 * ⚠️ 상한 계산은 `apps/web/lib/free-audit-budget.ts`·`audit-gates.ts` 와 **같은 산식을 여기 복제**한 것이다
 *   (그 파일은 apps/web 에만 있어 apps/app 이 import 할 수 없다). 예산·평균 원가를 바꾸면 **양쪽을 함께** 고칠 것.
 *   건수는 `isDailyBudgetExhausted` 와 같은 조건(org 측정 제외)으로 센다.
 */
const DEFAULT_DAILY_FREE_BUDGET_KRW = 50_000;
const FREE_AUDIT_AVG_COST_KRW = 1000;
const FREE_AUDIT_AVG_COST_API_SEARCH_KRW = 1400;

export function dailyFreeCap(
  env: Record<string, string | undefined> = process.env
): number {
  const budget = Number(
    env.FINDABLE_DAILY_FREE_BUDGET_KRW ?? DEFAULT_DAILY_FREE_BUDGET_KRW
  );
  const avg = isApiSearchEngineSetActive()
    ? FREE_AUDIT_AVG_COST_API_SEARCH_KRW
    : FREE_AUDIT_AVG_COST_KRW;
  if (!(Number.isFinite(budget) && budget > 0)) {
    return 1;
  }
  return Math.max(1, Math.floor(budget / avg));
}

export async function loadFreeDailyUsage(
  now: Date
): Promise<{ cap: number; count: number }> {
  const count = await database.auditJob.count({
    where: {
      createdAt: { gte: new Date(now.getTime() - DAY_MS) },
      NOT: { email: { startsWith: "org:" } },
    },
  });
  return { cap: dailyFreeCap(), count };
}
