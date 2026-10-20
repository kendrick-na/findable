/**
 * 접속 IP 3개월 보관 후 자동 삭제 — 2026-10-20 (대표 결정 ②, 2차: 코덱스 검토 반영).
 *
 * 저장 위치 전수(git grep `ipAddress`·`x-forwarded-for`·`x-real-ip`): DB 에 IP 가 남는 곳은
 * `AuditJob.ipAddress` **한 곳뿐**이다(무료 진단의 IP 당 하루 한도용, 직전 24시간만 읽는다).
 * 나머지(문의·뉴스레터 요청 제한)는 Upstash 키라 1시간~1일 뒤 저절로 사라진다.
 * 범위표: `docs/_적용/개인정보_삭제범위_20261020.md` 5절.
 *
 * - 행은 지우지 않고 `ipAddress` 칸만 비운다(측정 결과·도메인 캐시는 그대로).
 * - **배치**: 오래된 것부터 1,000건씩(createdAt·id 순) 비우고, 시간 예산(기본 45초) 안에서 반복한다.
 *   배치마다 별도 트랜잭션 + `pg_try_advisory_xact_lock` → 두 실행이 겹치면 늦은 쪽이 비켜선다(lockBusy).
 *   배치 시작 전 남은 예산을 확인하고, 배치 1회는 min(남은 예산, 15초)를 넘으면 되돌려진다.
 *   다 못 끝내면 `done: false` 로 돌려주고 다음 실행이 이어서 한다(조건이 `not: null` 이라 자연히 이어짐).
 * - 멱등: 이미 비운 행은 조건에서 빠진다.
 * - 3개월 = **달력 기준, 월말 넘침 없음**(5-31 → 2-28/29, 8-31 → 5-31). UTC 로 계산한다.
 * - 자동 재측정 표식(`"auto-refresh"`)도 함께 비운다 — 하루 한도 계산은 당일 것만 봐서 영향 없다.
 */

import type { database } from "@repo/database";
import { tryAdvisoryXactLock } from "@repo/database/advisory-lock";

export const IP_RETENTION_MONTHS = 3;
export const IP_PURGE_BATCH_SIZE = 1000;
export const IP_PURGE_TIME_BUDGET_MS = 45_000;

const daysInUtcMonth = (year: number, monthIndex: number): number =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

/**
 * `now` 에서 달력 기준 `months` 개월 전 시각(UTC). 대상 달에 그 날짜가 없으면 그 달 말일로 맞춘다
 * (JS `setUTCMonth` 처럼 다음 달로 넘치지 않는다). 시·분·초는 그대로.
 */
export function ipRetentionCutoff(
  now: Date,
  months: number = IP_RETENTION_MONTHS
): Date {
  const totalMonths = now.getUTCFullYear() * 12 + now.getUTCMonth() - months;
  const year = Math.floor(totalMonths / 12);
  const monthIndex = totalMonths - year * 12;
  const day = Math.min(now.getUTCDate(), daysInUtcMonth(year, monthIndex));
  return new Date(
    Date.UTC(
      year,
      monthIndex,
      day,
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds()
    )
  );
}

type PurgeClient = Pick<typeof database, "$transaction">;

/** 동시 실행 방지 잠금 키(배치마다 `pg_try_advisory_xact_lock`). */
export const IP_PURGE_LOCK_KEY = "cron:purge-expired-ip";
/** 남은 예산이 이보다 적으면 새 배치를 시작하지 않는다. */
export const IP_PURGE_MIN_BATCH_MS = 2000;
/** 배치 1회(트랜잭션)의 최대 시간. 넘으면 Prisma 가 그 배치를 되돌린다. */
export const IP_PURGE_BATCH_TIMEOUT_MS = 15_000;

export interface PurgeOptions {
  batchSize?: number;
  /** 테스트용 시계. */
  clock?: () => number;
  timeBudgetMs?: number;
}

export interface PurgeResult {
  batches: number;
  cleared: number;
  cutoff: Date;
  /** false = 시간 예산이 다 됐거나 다른 실행이 돌고 있어 멈췄다(다음 실행이 이어서 한다). */
  done: boolean;
  /** 다른 실행이 잠금을 쥐고 있어 이번 실행은 비켜섰다. */
  lockBusy: boolean;
}

/**
 * 경계 정책: `createdAt < cutoff` 만 비운다. 기준 시각과 **정확히 같은** 행은 남긴다(다음 날 실행이 비운다).
 * 배치마다: 남은 예산 확인 → 트랜잭션(잠금 시도 → 오래된 순 1,000건 id → 조건 재확인하며 비움).
 */
export async function purgeExpiredIpAddresses(
  client: PurgeClient,
  now: Date = new Date(),
  options: PurgeOptions = {}
): Promise<PurgeResult> {
  const batchSize = options.batchSize ?? IP_PURGE_BATCH_SIZE;
  const budget = options.timeBudgetMs ?? IP_PURGE_TIME_BUDGET_MS;
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  const cutoff = ipRetentionCutoff(now);
  const expired = { createdAt: { lt: cutoff }, ipAddress: { not: null } };

  let cleared = 0;
  let batches = 0;
  for (;;) {
    const remaining = budget - (clock() - startedAt);
    if (remaining < IP_PURGE_MIN_BATCH_MS) {
      return { cutoff, cleared, batches, done: false, lockBusy: false };
    }
    const batch = await client.$transaction(
      async (tx) => {
        if (!(await tryAdvisoryXactLock(tx, IP_PURGE_LOCK_KEY))) {
          return null;
        }
        const ids = (
          await tx.auditJob.findMany({
            where: expired,
            select: { id: true },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: batchSize,
          })
        ).map((row) => row.id);
        if (ids.length === 0) {
          return { found: 0, count: 0 };
        }
        // 조건을 다시 건다: 그 사이 다른 곳이 바꾼 행은 건드리지 않는다(건수가 실제 비운 수).
        const result = await tx.auditJob.updateMany({
          where: { id: { in: ids }, ...expired },
          data: { ipAddress: null },
        });
        return { found: ids.length, count: result.count };
      },
      {
        maxWait: IP_PURGE_MIN_BATCH_MS,
        timeout: Math.min(remaining, IP_PURGE_BATCH_TIMEOUT_MS),
      }
    );
    if (batch === null) {
      return { cutoff, cleared, batches, done: false, lockBusy: true };
    }
    if (batch.found === 0) {
      return { cutoff, cleared, batches, done: true, lockBusy: false };
    }
    cleared += batch.count;
    batches += 1;
    if (batch.found < batchSize) {
      return { cutoff, cleared, batches, done: true, lockBusy: false };
    }
  }
}
