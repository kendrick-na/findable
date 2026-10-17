import {
  type StabilityLimits,
  stabilityLimits,
} from "@repo/audit/stability-flags";
import { hasPlan, type Plan } from "@repo/auth/plan";
import { database } from "@repo/database";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

/**
 * 자동 갱신 cron 이 나중에 job 의 ipAddress 에 이 값을 쓰면 수동 한도 계산에서 코드 변경 없이 빠진다.
 * 지금은 아무도 쓰지 않는다(표식 없음) — 아래 주석 참고.
 */
export const AUTO_REFRESH_MARK = "auto-refresh";

/** 수동 측정 한도가 걸리는 플랜 등급. 무료는 기존 규칙(도메인당 24시간 1회), enterprise 는 상한 없음. */
function paidTier(plan: Plan): "starter" | "growth" | "scale" | null {
  if (plan === "enterprise") {
    return null;
  }
  if (hasPlan(plan, "scale")) {
    return "scale";
  }
  if (hasPlan(plan, "growth")) {
    return "growth";
  }
  if (hasPlan(plan, "starter")) {
    return "starter";
  }
  return null;
}

/** 일 상한(24시간)·월 상한(30일) — 플랜별. 한도가 없으면 null. */
export function manualCapsFor(
  plan: Plan,
  limits: StabilityLimits = stabilityLimits()
): { daily: number; monthly: number } | null {
  const tier = paidTier(plan);
  return tier
    ? { daily: limits.orgDailyCap[tier], monthly: limits.orgMonthlyCap[tier] }
    : null;
}

/**
 * 고객(org)의 수동 측정 일·월 상한 도달 여부(STABILITY_ORG_DAILY_CAP_ENABLED).
 * start-tracking(수동) 경로에서만 부른다 — 자동 측정 경로(옴니버스 cron)에는 적용하지 않는다.
 *
 * 세는 기준
 *  · 실패(failed)는 뺀다 — 반복 실패는 별도 규칙(하루 3회)이 막고, 시스템 탓 실패(대기 만료 등)가 고객 몫을 갉아먹으면 안 된다.
 *    대기·진행·완료는 센다. 이어가기는 같은 행이라 1건.
 *  ⚠️ AuditJob 에는 수동/자동 구분 컬럼이 없고 자동 갱신 cron 도 표식 없이 같은 모양으로 job 을 만든다.
 *    그래서 **자동 측정도 이 수에 섞여 센다**(`ipAddress = AUTO_REFRESH_MARK` 가 붙은 건만 제외 — 지금은 아무도 안 붙인다).
 * 🔒 N6: 쿼리 2개는 직렬(풀 max 1). 일 상한에 걸리면 월 조회는 생략한다.
 */
export async function overManualCap(
  orgId: string,
  plan: Plan,
  now = Date.now()
): Promise<"daily" | "monthly" | null> {
  const caps = manualCapsFor(plan);
  if (!caps) {
    return null;
  }
  const base = {
    email: `org:${orgId}`,
    status: { not: "failed" as const },
    // Prisma 의 not 은 NULL 행을 빼므로 null 을 따로 허용한다.
    OR: [{ ipAddress: null }, { ipAddress: { not: AUTO_REFRESH_MARK } }],
  };
  const today = await database.auditJob.count({
    where: { ...base, createdAt: { gte: new Date(now - DAY_MS) } },
  });
  if (today >= caps.daily) {
    return "daily";
  }
  const month = await database.auditJob.count({
    where: { ...base, createdAt: { gte: new Date(now - MONTH_MS) } },
  });
  return month >= caps.monthly ? "monthly" : null;
}
