// W1 PromptAttempt 원장 영속 계층.
//
// ⚠️ PROMPT_ATTEMPT_LEDGER_ENABLED="true" 일 때만 러너가 이 모듈의 쓰기 함수를 부른다.
//   off(기본)면 러너는 이 테이블을 한 번도 건드리지 않는다 → migration
//   `20261005_prompt_attempt_ledger` 적용 전에 코드가 배포돼도 무변화.
//   켜는 순서: ① migration 적용 → ② 플래그 on. 반대로 하면 예약이 실패해
//   기존 순환 선택으로 폴백한다(측정은 계속되지만 원장은 비어 있다).
//
// 원자성 규칙(W1 계약 "질문 시도 원장 최소 불변식"):
//   - 예약: 한 transaction 안에서 브랜드 advisory lock → live AuditJob lease 확인
//     → 정책·순환 선택 → 행 삽입 → 같은 계획의 checkpoint 저장. 둘 다 있거나 둘 다 없다.
//   - 시작: 유료 호출 직전, live lease 로만 startedAt 기록(호출은 transaction 밖).
//   - 종료: 질문 묶음 checkpoint 저장과 finishedAt/outcome 갱신을 같은 transaction 으로.
//   - zombie lease(만료·인계된 token)는 어떤 행도 갱신하지 못한다.
// 모든 시각 비교는 DB 시계(UTC)로 한다 — 인스턴스 시계 오차가 fence 를 흐리지 않게.

import { database, type Prisma } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import type { AuditCheckpoint } from "./checkpoint";
import { keys } from "./keys";
import {
  type PromptAttempt,
  type PromptAttemptOutcome,
  reservePromptPlan,
} from "./prompt-attempt-ledger";
import {
  applyPromptAttemptPolicy,
  type PolicyPrompt,
  type PromptPolicyVerdict,
} from "./prompt-attempt-policy";

type Tx = Prisma.TransactionClient;

/** 원장 판단에 읽는 브랜드 최근 행 수 상한(약 150질문 × 30회분). */
const BRAND_HISTORY_WINDOW = 5000;
const LEDGER_TX = { maxWait: 10_000, timeout: 20_000 } as const;

export function isPromptAttemptLedgerEnabled(): boolean {
  return keys().PROMPT_ATTEMPT_LEDGER_ENABLED === true;
}

export class PromptAttemptLeaseLostError extends Error {
  constructor() {
    super("Prompt attempt ledger lost its live audit lease");
    this.name = "PromptAttemptLeaseLostError";
  }
}

async function assertLiveLease(
  tx: Tx,
  auditJobId: string,
  leaseToken: string,
  lockMode: "share" | "update"
): Promise<void> {
  const rows =
    lockMode === "update"
      ? await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "AuditJob"
          WHERE "id" = ${auditJobId}
            AND "status" = 'processing'
            AND "leaseToken" = ${leaseToken}
            AND "leaseUntil" >= (now() AT TIME ZONE 'UTC')
          FOR UPDATE`
      : await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "AuditJob"
          WHERE "id" = ${auditJobId}
            AND "status" = 'processing'
            AND "leaseToken" = ${leaseToken}
            AND "leaseUntil" >= (now() AT TIME ZONE 'UTC')
          FOR SHARE`;
  if (rows.length !== 1) {
    throw new PromptAttemptLeaseLostError();
  }
}

const ATTEMPT_SELECT = {
  attemptNo: true,
  auditJobId: true,
  brandId: true,
  finishedAt: true,
  leaseToken: true,
  outcome: true,
  planIndex: true,
  planSize: true,
  promptId: true,
  selectedAt: true,
  selectionSeq: true,
  startedAt: true,
  startedLeaseToken: true,
} as const;

export interface ReservedPromptPlan<T> {
  prompts: T[];
  resumed: boolean;
  verdicts: PromptPolicyVerdict[];
}

/**
 * 새 Job 의 저장 질문 계획을 원장에 예약하고, 같은 transaction 에서
 * `saveCheckpoint(selected, tx)` 로 질문 계획 checkpoint 를 기록한다.
 * 같은 Job 의 계획이 이미 있으면 새로 고르지 않고 그 계획을 현재 lease 로 인계한다.
 */
export async function reservePromptAttemptPlan<T extends PolicyPrompt>(input: {
  auditJobId: string;
  brandId: string;
  leaseToken: string;
  limit: number;
  prompts: readonly T[];
  saveCheckpoint: (selected: T[], tx: Tx) => Promise<void>;
}): Promise<ReservedPromptPlan<T>> {
  const byId = new Map(input.prompts.map((prompt) => [prompt.id, prompt]));
  return await database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`findable:prompt-attempt:${input.brandId}`}, 0))`;
    await assertLiveLease(tx, input.auditJobId, input.leaseToken, "update");

    const existing = (await tx.promptAttempt.findMany({
      where: { auditJobId: input.auditJobId },
      select: ATTEMPT_SELECT,
    })) as PromptAttempt[];
    if (existing.length > 0) {
      const plan = reservePromptPlan({
        attempts: existing,
        auditJobId: input.auditJobId,
        brandId: input.brandId,
        leaseToken: input.leaseToken,
        limit: input.limit,
        prompts: [...input.prompts],
        selectedAt: new Date(),
      });
      await tx.promptAttempt.updateMany({
        where: {
          auditJobId: input.auditJobId,
          finishedAt: null,
          leaseToken: { not: input.leaseToken },
        },
        data: { leaseToken: input.leaseToken },
      });
      const selected = plan.map((row) => byId.get(row.promptId) as T);
      await input.saveCheckpoint(selected, tx);
      return { prompts: selected, resumed: true, verdicts: [] };
    }

    // 한 transaction 연결 위에서는 순차로 읽는다(병렬 질의 금지).
    const history = await tx.promptAttempt.findMany({
      where: { brandId: input.brandId },
      orderBy: { selectionSeq: "desc" },
      take: BRAND_HISTORY_WINDOW,
      select: ATTEMPT_SELECT,
    });
    const resets = await tx.promptAttemptReset.findMany({
      where: { brandId: input.brandId },
      select: { promptId: true, resetAt: true },
    });
    const attempts = history as PromptAttempt[];
    const jobIds = [...new Set(attempts.map((row) => row.auditJobId))];
    const inactiveJobs =
      jobIds.length === 0
        ? []
        : await tx.auditJob.findMany({
            where: {
              id: { in: jobIds },
              status: { in: ["completed", "failed"] },
            },
            select: { id: true },
          });
    const { eligible, verdicts } = applyPromptAttemptPolicy({
      attempts,
      prompts: input.prompts,
      resets,
    });
    const plan = reservePromptPlan({
      attempts,
      auditJobId: input.auditJobId,
      brandId: input.brandId,
      inactiveAuditJobIds: inactiveJobs.map((job) => job.id),
      leaseToken: input.leaseToken,
      limit: input.limit,
      prompts: eligible,
      selectedAt: new Date(),
    });
    if (plan.length > 0) {
      await tx.promptAttempt.createMany({
        data: plan.map((row) => ({
          attemptNo: row.attemptNo,
          auditJobId: row.auditJobId,
          brandId: row.brandId,
          leaseToken: row.leaseToken,
          planIndex: row.planIndex,
          planSize: row.planSize,
          promptId: row.promptId,
          selectedAt: row.selectedAt,
          selectionSeq: row.selectionSeq,
        })),
      });
    }
    const selected = plan.map((row) => byId.get(row.promptId) as T);
    await input.saveCheckpoint(selected, tx);
    return { prompts: selected, resumed: false, verdicts };
  }, LEDGER_TX);
}

/**
 * 재개(checkpoint resume) 때 이 Job 의 미완료 행을 현재 lease 로 인계한다.
 * 현재 lease 가 AuditJob 의 권위 있는 live lease 일 때만 성공한다.
 */
export async function adoptPromptAttemptPlan(
  auditJobId: string,
  leaseToken: string
): Promise<number> {
  return await database.$transaction(async (tx) => {
    await assertLiveLease(tx, auditJobId, leaseToken, "update");
    const moved = await tx.promptAttempt.updateMany({
      where: {
        auditJobId,
        finishedAt: null,
        leaseToken: { not: leaseToken },
      },
      data: { leaseToken },
    });
    return moved.count;
  }, LEDGER_TX);
}

/**
 * 유료 호출 직전 dispatch 기록. 이전(인계 전) lease 가 시작한 행이면 attemptNo+1.
 * 같은 lease 가 이미 시작한 행·종료된 행·원장에 없는 질문은 그대로 둔다.
 * live lease 가 아니면 throw — 호출 전에 멈춰 원가를 쓰지 않는다.
 */
export async function markPromptAttemptStarted(
  auditJobId: string,
  leaseToken: string,
  promptId: string
): Promise<boolean> {
  return await database.$transaction(async (tx) => {
    await assertLiveLease(tx, auditJobId, leaseToken, "share");
    const updated = await tx.$executeRaw`
      UPDATE "PromptAttempt"
      SET "startedAt" = (now() AT TIME ZONE 'UTC'),
          "startedLeaseToken" = ${leaseToken},
          "attemptNo" = CASE WHEN "startedAt" IS NULL THEN "attemptNo" ELSE "attemptNo" + 1 END
      WHERE "auditJobId" = ${auditJobId}
        AND "promptId" = ${promptId}
        AND "leaseToken" = ${leaseToken}
        AND "finishedAt" IS NULL
        AND "startedLeaseToken" IS DISTINCT FROM ${leaseToken}`;
    return updated === 1;
  }, LEDGER_TX);
}

export interface PromptAttemptFinish {
  outcome: Exclude<PromptAttemptOutcome, "abandoned">;
  promptId: string;
}

/**
 * 질문 묶음 checkpoint 저장 + 해당 질문들의 finishedAt/outcome 을 한 transaction 으로.
 * 둘 중 하나라도 실패하면 둘 다 롤백된다(W1 RED 7).
 * 이 lease 가 시작한 행만 종료한다 — 선임 lease 가 시작한 미상 호출은 손대지 않는다.
 */
export async function saveCheckpointAndFinishAttempts(input: {
  auditJobId: string;
  checkpoint: AuditCheckpoint;
  finishes: readonly PromptAttemptFinish[];
  leaseToken: string;
}): Promise<void> {
  await database.$transaction(async (tx) => {
    await assertLiveLease(tx, input.auditJobId, input.leaseToken, "update");
    for (const finish of input.finishes) {
      await tx.$executeRaw`
        UPDATE "PromptAttempt"
        SET "finishedAt" = (now() AT TIME ZONE 'UTC'),
            "outcome" = ${finish.outcome}::"PromptAttemptOutcome"
        WHERE "auditJobId" = ${input.auditJobId}
          AND "promptId" = ${finish.promptId}
          AND "leaseToken" = ${input.leaseToken}
          AND "startedLeaseToken" = ${input.leaseToken}
          AND "startedAt" IS NOT NULL
          AND "finishedAt" IS NULL`;
    }
    const written = await tx.auditJob.updateMany({
      where: {
        id: input.auditJobId,
        status: "processing",
        leaseToken: input.leaseToken,
      },
      data: { checkpoint: input.checkpoint as never },
    });
    if (written.count !== 1) {
      throw new Error("Audit checkpoint lost its processing job");
    }
  }, LEDGER_TX);
}

/** 질문 하나의 응답 묶음 → 원장 결과. 유효 응답이 하나라도 있으면 completed. */
export function promptBatchOutcome(
  batch: ReadonlyArray<{ errorMessage?: string | null; isStub?: boolean }>
): PromptAttemptFinish["outcome"] {
  return batch.some((row) => !(row.errorMessage || row.isStub))
    ? "completed"
    : "failed";
}

/**
 * 운영자 수동 초기화 — "needs attention" 질문을 다시 순환에 넣는다.
 * 플래그 off 면 테이블이 없을 수 있으므로 거부한다.
 */
export async function resetPromptAttemptStreak(input: {
  brandId: string;
  promptId: string;
  reason?: string;
}): Promise<void> {
  if (!isPromptAttemptLedgerEnabled()) {
    throw new Error("Prompt attempt ledger is disabled");
  }
  await database.promptAttemptReset.create({
    data: {
      brandId: input.brandId,
      promptId: input.promptId,
      reason: input.reason ?? null,
    },
    select: { id: true },
  });
}

/**
 * 화면·운영용 읽기. 플래그 off 면 DB 를 조회하지 않고 null,
 * 켜져 있어도 테이블 부재·조회 실패는 null 로 흡수한다(측정·화면을 죽이지 않는다).
 */
export async function readPromptAttemptHealth(
  brandId: string,
  prompts: readonly PolicyPrompt[]
): Promise<PromptPolicyVerdict[] | null> {
  if (!isPromptAttemptLedgerEnabled()) {
    return null;
  }
  try {
    const history = await database.promptAttempt.findMany({
      where: { brandId },
      orderBy: { selectionSeq: "desc" },
      take: BRAND_HISTORY_WINDOW,
      select: ATTEMPT_SELECT,
    });
    const resets = await database.promptAttemptReset.findMany({
      where: { brandId },
      select: { promptId: true, resetAt: true },
    });
    return applyPromptAttemptPolicy({
      attempts: history as PromptAttempt[],
      prompts,
      resets,
    }).verdicts;
  } catch (error) {
    log.warn("audit.prompt_attempts.health_read_failed", {
      brandId,
      error: parseError(error),
    });
    return null;
  }
}
