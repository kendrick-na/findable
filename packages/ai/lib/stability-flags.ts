/**
 * 안정성 개선 플래그·한도(2026-10-18) — 여러 고객이 동시에 써도 멈추지 않게 하는 변경의 **켜는 스위치와 숫자**를 한 곳에 둔다.
 *
 * 규칙
 *  - 플래그는 전부 **기본 꺼짐**이다. 꺼져 있으면 동작은 이 파일이 생기기 전과 **바이트 단위로 같아야 한다**(테스트로 고정).
 *  - 숫자(동시 상한·일일 상한·재시도 횟수…)는 코드에 박지 않고 **환경값**으로 읽는다. 아래 기본값은 **임시값**이다.
 *    대표 확정(공급자 실제 한도 확인·경쟁사 사례 조사) 뒤 환경값으로 바꾼다 — 코드를 고치지 않는다.
 *  - 새 패키지 없음. 의존성 없는 순수 모듈이라 ai·audit·apps 어디서나 쓴다(`@repo/audit/stability-flags` 는 이 파일을 다시 내보낸다).
 */

export const STABILITY_FLAGS = [
  /** 빈 응답(공백만)을 오류로 바꿔 "측정 못 함 → 재시도"로 다룬다(미노출로 세지 않는다). */
  "STABILITY_EMPTY_AS_ERROR_ENABLED",
  /** 429·5xx·네트워크·빈 응답 칸을 칸당 최대 N회(지터·Retry-After) 다시 묻는다. 켜면 SDK 기본 재시도는 끈다(한 층만). */
  "STABILITY_CELL_RETRY_ENABLED",
  /** 한 프로세스 안에서 연속 실패한 엔진을 잠깐 격리한다(회차 내 서킷브레이커). */
  "STABILITY_ENGINE_BREAKER_ENABLED",
  /** 멈춘(stale) 작업에 저장된 답이 있으면 실패 대신 이어가기 대기로 돌린다. */
  "STABILITY_RESUME_STUCK_ENABLED",
  /** 전역·고객별 동시 실행 상한과 대기 줄(입장 관리) + 전용 일꾼 라우트. */
  "STABILITY_ADMISSION_ENABLED",
  /** 고객(조직)별 하루 측정 횟수 상한. */
  "STABILITY_ORG_DAILY_CAP_ENABLED",
  /** 운영자 알림(엔진 실패율·대기·잔량·원가 등) 점검과 cron 하트비트. */
  "STABILITY_OPS_ALERTS_ENABLED",
  /** 고객 화면에 오류 원문 대신 분류된 문장만 보인다. */
  "STABILITY_ERROR_SANITIZE_ENABLED",
] as const;

export type StabilityFlag = (typeof STABILITY_FLAGS)[number];

const ON_VALUES = new Set(["1", "true"]);

export function isStabilityFlagOn(
  name: StabilityFlag,
  env: Record<string, string | undefined> = process.env
): boolean {
  return ON_VALUES.has((env[name] ?? "").trim().toLowerCase());
}

export interface StabilityLimits {
  /** 격리 시간(ms) 뒤 한 번 시험 호출(반열림). */
  breakerCooldownMs: number;
  /** 회차 내 서킷브레이커: 같은 엔진이 이 횟수만큼 연속으로 최종 실패하면 격리. */
  breakerFailThreshold: number;
  /** 칸당 재시도 최대 횟수(최초 호출 제외). */
  cellMaxRetries: number;
  /** 전체 동시 실행 상한(내부·무료·고객 모두 센다). */
  globalConcurrency: number;
  /** 고객(조직)별 동시 실행 상한. */
  orgConcurrency: number;
  /** 고객별 하루(24시간) 측정 횟수 상한 — 플랜별. 무료는 기존 규칙(도메인당 24시간 1회)을 그대로 쓴다. */
  orgDailyCap: { growth: number; scale: number; starter: number };
  /** 대기 줄에서 이 시간(분)을 넘기면 실패로 닫는다(안내 문구와 함께). */
  queueWaitMaxMinutes: number;
  /** Retry-After 를 따르되 이 값(ms)을 넘기지 않는다. */
  retryAfterCapMs: number;
  /** 재시도 사이 대기(ms) 목록. 부족하면 마지막 값을 쓴다. */
  retryDelaysMs: number[];
}

const num = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(parsed)
    ? parsed
    : fallback;
};

const numList = (raw: string | undefined, fallback: number[]): number[] => {
  if (!raw?.trim()) {
    return fallback;
  }
  const parsed = raw.split(",").map((part) => Number(part.trim()));
  return parsed.length > 0 && parsed.every((n) => Number.isFinite(n) && n >= 0)
    ? parsed
    : fallback;
};

/**
 * ⚠️ 아래 기본값은 **임시값**(공급자 한도 미확인). 환경값 이름은 고정이다 — 값만 운영에서 바꾼다.
 */
export function stabilityLimits(
  env: Record<string, string | undefined> = process.env
): StabilityLimits {
  return {
    breakerCooldownMs: num(env.STABILITY_BREAKER_COOLDOWN_MS, 120_000),
    breakerFailThreshold: num(env.STABILITY_BREAKER_FAIL_THRESHOLD, 5),
    cellMaxRetries: num(env.STABILITY_CELL_MAX_RETRIES, 2),
    globalConcurrency: num(env.STABILITY_GLOBAL_CONCURRENCY, 8),
    orgConcurrency: num(env.STABILITY_ORG_CONCURRENCY, 2),
    orgDailyCap: {
      growth: num(env.STABILITY_ORG_DAILY_CAP_GROWTH, 10),
      scale: num(env.STABILITY_ORG_DAILY_CAP_SCALE, 20),
      starter: num(env.STABILITY_ORG_DAILY_CAP_STARTER, 3),
    },
    queueWaitMaxMinutes: num(env.STABILITY_QUEUE_WAIT_MAX_MINUTES, 120),
    retryAfterCapMs: num(env.STABILITY_RETRY_AFTER_CAP_MS, 15_000),
    retryDelaysMs: numList(env.STABILITY_RETRY_DELAYS_MS, [2000, 8000]),
  };
}
