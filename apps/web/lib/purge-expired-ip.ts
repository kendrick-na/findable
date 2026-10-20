/**
 * 접속 IP 3개월 보관 후 자동 삭제 — 2026-10-20 (대표 결정 ②).
 *
 * 저장 위치 전수(git grep `ipAddress`·`x-forwarded-for`·`x-real-ip`): DB 에 IP 가 남는 곳은
 * `AuditJob.ipAddress` **한 곳뿐**이다(무료 진단의 IP 당 하루 한도용, 직전 24시간만 읽는다).
 * 나머지(문의·뉴스레터 요청 제한)는 Upstash 키라 1시간~1일 뒤 저절로 사라진다.
 * 범위표: `docs/_적용/개인정보_삭제범위_20261020.md` 5절.
 *
 * - 행은 지우지 않고 `ipAddress` 칸만 비운다(측정 결과·도메인 캐시는 그대로).
 * - 멱등: 이미 비운 행은 조건(`not: null`)에서 빠진다.
 * - 3개월 = 달력 기준(오늘이 10-20 이면 07-20 이전 생성분). UTC 로 계산한다.
 * - 자동 재측정 표식(`"auto-refresh"`)도 함께 비운다 — 하루 한도 계산은 당일 것만 봐서 영향 없다.
 */

import type { database } from "@repo/database";

export const IP_RETENTION_MONTHS = 3;

/** `now` 에서 달력 기준 `months` 개월 전 시각(UTC). 3-31 → 12-31 처럼 말일은 JS 규칙대로 넘친다. */
export function ipRetentionCutoff(
  now: Date,
  months: number = IP_RETENTION_MONTHS
): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

interface PurgeClient {
  auditJob: Pick<typeof database.auditJob, "updateMany">;
}

export async function purgeExpiredIpAddresses(
  client: PurgeClient,
  now: Date = new Date()
): Promise<{ cutoff: Date; cleared: number }> {
  const cutoff = ipRetentionCutoff(now);
  const result = await client.auditJob.updateMany({
    where: { createdAt: { lt: cutoff }, ipAddress: { not: null } },
    data: { ipAddress: null },
  });
  return { cutoff, cleared: result.count };
}
