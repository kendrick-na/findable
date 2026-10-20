// 접속 IP 3개월 자동 삭제 cron — 2026-10-20 (대표 결정 ②)
//
// 무엇: 3개월 지난 `AuditJob.ipAddress` 를 비운다(행·측정 결과는 유지). 로직은 `lib/purge-expired-ip.ts`.
// 언제: 매일 16:30 UTC = **01:30 KST** (vercel.json 과 같은 문자열을 하트비트에 넘긴다).
// 인증: `denyIfNotCron` 단일 진실(`CRON_SECRET` Bearer 만 신뢰, Preview 는 403).
//   🔴 `x-vercel-cron` 헤더 폴백을 되살리지 말 것 → `packages/security/cron.ts`.
// 배포 위치 = apps/web(이미 cron 이 도는 곳). apps/api 는 미배포라 쓰지 않는다.

import { database } from "@repo/database";
import { withCronHeartbeat } from "@repo/observability/cron-heartbeat";
import { log } from "@repo/observability/log";
import { denyIfNotCron } from "@repo/security/cron";
import type { NextRequest } from "next/server";
import { purgeExpiredIpAddresses } from "@/lib/purge-expired-ip";

export const maxDuration = 60;

const SCHEDULE = "30 16 * * *";

export const GET = async (request: NextRequest) => {
  const denied = denyIfNotCron(request);
  if (denied) {
    return denied;
  }
  return await withCronHeartbeat("purge-expired-ip", SCHEDULE, async () => {
    // 1,000건씩·45초 예산(maxDuration 60초 안). 다 못 끝내면 다음 날 실행이 이어서 한다.
    //   배치마다 잠금 시도 — 다른 실행이 돌고 있으면 비켜선다(lockBusy).
    const { cutoff, cleared, batches, done, lockBusy } =
      await purgeExpiredIpAddresses(database);
    log.info("privacy.ip_purge.done", {
      cutoff: cutoff.toISOString(),
      cleared,
      batches,
      done,
      lockBusy,
    });
    return Response.json({
      ok: true,
      cutoff: cutoff.toISOString(),
      cleared,
      batches,
      done,
      lockBusy,
    });
  });
};
