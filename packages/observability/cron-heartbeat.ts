// cron 하트비트 — 2026-10-18 안정성 U4
//
// 배경: cron 이 **조용히 멈추면** 아무도 모른다(에러도 안 난다 — 그냥 안 돈다).
//   Sentry cron 모니터는 「체크인이 예정 시각에 안 오면」 알림을 준다. 이 헬퍼가 그 체크인을 보낸다.
//   새 패키지·새 DB 표 없음(이미 설치된 `@sentry/nextjs` 의 `captureCheckIn`).
//
// 규칙
//  - 플래그 `STABILITY_OPS_ALERTS_ENABLED` 꺼짐 → `fn` 만 그대로 실행한다(체크인 없음, 바이트 동일).
//  - 체크인 전송이 실패해도 **본 작업을 깨지 않는다**(`captureOpsAlert` 와 같은 원칙, 절대 던지지 않는다).
//  - `fn` 이 던지면 `error` 체크인을 보내고 **같은 예외를 다시 던진다**(삼키지 않는다).
//  - 슬러그·시각만 보낸다. 개인정보 없음.
//
// ⚠️ `scheduleHint` 는 vercel.json 의 crontab 과 **같은 문자열**을 쓴다(UTC). Sentry 가 모니터를 자동 생성/갱신한다.

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK convention
import * as Sentry from "@sentry/nextjs";
import { log } from "./log";

const FLAG = "STABILITY_OPS_ALERTS_ENABLED";

/** `@repo/ai/lib/stability-flags` 의 켜짐 규칙(`1`·`true`)과 같다 — observability 가 ai 에 의존하지 않도록 값만 복제한다. */
const isOn = (env: Record<string, string | undefined>): boolean =>
  ["1", "true"].includes((env[FLAG] ?? "").trim().toLowerCase());

/** 발명한 시작점: 예정 시각 뒤 5분까지는 늦은 것으로 보지 않고, 15분 넘게 끝나지 않으면 실패로 본다. */
const DEFAULT_CHECKIN_MARGIN_MIN = 5;
const DEFAULT_MAX_RUNTIME_MIN = 15;

const safeCheckIn = (
  checkIn: Parameters<typeof Sentry.captureCheckIn>[0],
  config?: Parameters<typeof Sentry.captureCheckIn>[1]
): string | undefined => {
  try {
    return Sentry.captureCheckIn(checkIn, config);
  } catch (heartbeatError) {
    log.error("cron-heartbeat 전송 실패", {
      slug: checkIn.monitorSlug,
      reason:
        heartbeatError instanceof Error ? heartbeatError.message : "unknown",
    });
    return undefined;
  }
};

export interface CronHeartbeatOptions {
  checkinMarginMinutes?: number;
  env?: Record<string, string | undefined>;
  maxRuntimeMinutes?: number;
}

/**
 * cron 본문을 하트비트로 감싼다.
 *
 * @param slug Sentry 모니터 슬러그(예: `auto-refresh-tracking`)
 * @param scheduleHint vercel.json 의 crontab(UTC) — 예: 30분마다(5개 칸 crontab)
 */
export async function withCronHeartbeat<T>(
  slug: string,
  scheduleHint: string,
  fn: () => Promise<T> | T,
  options: CronHeartbeatOptions = {}
): Promise<T> {
  if (!isOn(options.env ?? process.env)) {
    return await fn();
  }
  const startedAt = Date.now();
  const checkInId = safeCheckIn(
    { monitorSlug: slug, status: "in_progress" },
    {
      schedule: { type: "crontab", value: scheduleHint },
      checkinMargin: options.checkinMarginMinutes ?? DEFAULT_CHECKIN_MARGIN_MIN,
      maxRuntime: options.maxRuntimeMinutes ?? DEFAULT_MAX_RUNTIME_MIN,
      timezone: "UTC",
    }
  );
  const finish = (status: "ok" | "error"): void => {
    if (!checkInId) {
      return;
    }
    safeCheckIn({
      checkInId,
      monitorSlug: slug,
      status,
      duration: (Date.now() - startedAt) / 1000,
    });
  };
  try {
    const value = await fn();
    finish("ok");
    return value;
  } catch (error) {
    finish("error");
    throw error;
  }
}
