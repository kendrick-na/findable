// 무료 진단 도메인 캐시·전역 일일 예산 — `POST /api/audit` 와 MCP 커넥터(`lib/mcp`)가 같이 쓴다.
//
// 🔴 이 파일은 `app/api/audit/route.ts` 에 있던 로직을 **그대로 옮긴 것**이다(2026-10-17).
//   동작을 바꾸지 않았다는 증거: `__tests__/audit-cache-budget-regression.test.ts`
//   (추출 전 코드에서 먼저 통과시킨 뒤, 추출 후 같은 테스트가 통과).
//   로직을 바꿀 때는 route 쪽 정책(예산·캐시 TTL)이 MCP 에도 함께 적용된다는 점을 기억할 것.

import { database, Prisma } from "@repo/database";

import {
  dailyFreeJobCap,
  DEFAULT_DAILY_FREE_BUDGET_KRW,
} from "./free-audit-budget";

const DAY_MS = 24 * 60 * 60 * 1000;

// ──────────────────────────────────────────────────────────────────
// 도메인 캐시 (2026-07-31 리서치 — 원가방어 1순위)
// 📕 근거: docs/_적용/무료진단_어뷰징_원가방어_리서치_2026-07-31.md §5(a)
//
// 핵심: 우리 원가는 "요청 수"가 아니라 "서로 다른 도메인 수"에 비례한다.
//   같은 도메인을 이메일 50개로 물어도 원가는 1회분이면 된다.
//   → 이메일을 바꿔 우회하는 공격이 경제적으로 무의미해진다(기존 게이트의 유일한 구멍).
//   → CGNAT 오차단 문제도 동시 해소(캐시 공유는 버그가 아니라 기능).
//
// 선례(Mozilla HTTP Observatory 문서 원문):
//   "24시간 내 스캔했으면 캐시된 결과를 반환" + "3분보다 자주는 스캔 불가"
//
// ⚠️ 기존 checkUsageGate 는 차단만 하고 적재된 result 를 재사용하지 않았다.
//    같은 조회로 캐시까지 처리하도록 확장한다(추가 쿼리 없음).
export const DOMAIN_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — Observatory 준용

// ──────────────────────────────────────────────────────────────────
// 전역 일일 상한 (리서치 §7-2) — 어뷰저가 로테이션으로 우회할 수 없는 유일한 통제.
//
// 이메일·IP·도메인은 전부 바꿀 수 있지만 "우리가 오늘 쓴 총액"은 못 바꾼다.
// 경고 사례(리서치): Recipe Ninja — 한 유저가 같은 요청 12,000회로 $700 청구.
//
// ⚠️ 원가는 현재 result JSON·로그 안에만 있고 조회 가능한 컬럼이 아니다.
//    (packages/audit/runner.ts costSummary → log.info + result.cost)
//    → 정확한 "원화 합계" 상한은 스키마 변경이 필요하므로, 지금은 **건수 × 실측 평균단가**로
//      환산해 상한을 건다. 마이그레이션 0으로 오늘 방어를 켜는 게 우선.
//    → 정밀화(costKrw 컬럼 추가 후 SUM)는 투두_마스터에 남긴다.
// 🔴 평균단가는 원가모델 v2 기준으로 재보정했다(2026-10-07 · 250→1,000원). 산식은
//   `lib/free-audit-budget.ts` 주석 참조.
// 무료 진단 일일 예산. 초과 시 신규 무료 측정만 정지(유료·admin·캐시 히트는 계속 동작).
export const DAILY_FREE_BUDGET_KRW = Number(
  process.env.FINDABLE_DAILY_FREE_BUDGET_KRW ?? DEFAULT_DAILY_FREE_BUDGET_KRW
);
export const DAILY_FREE_JOB_CAP = dailyFreeJobCap(DAILY_FREE_BUDGET_KRW);

/**
 * 오늘 실행된 무료 진단 건수가 예산 상한을 넘었는지.
 * 캐시 히트는 새 측정이 아니므로 여기 카운트에 들어오지 않는다(원가 0).
 */
export async function isDailyBudgetExhausted(): Promise<boolean> {
  const since = new Date(Date.now() - DAY_MS);
  const count = await database.auditJob.count({
    where: {
      createdAt: { gte: since },
      // 로그인 org 측정(email="org:*")은 유료 흐름이라 무료 예산에서 제외.
      NOT: { email: { startsWith: "org:" } },
    },
  });
  return count >= DAILY_FREE_JOB_CAP;
}

/**
 * 도메인 캐시 조회 — 이메일 무관하게 **도메인 기준**으로 최근 완료 job 을 찾는다.
 *
 * 이게 원가 방어의 핵심이다. 이메일을 바꿔도 도메인이 같으면 새 측정을 하지 않는다.
 * ⚠️ admin 은 캐시를 우회한다(운영·디버깅에서 강제 재측정이 필요).
 */
/**
 * 요청 언어를 만족하는 캐시 후보 언어 목록.
 *
 * ⚠️ 2026-08-02 구조감사 F8: 캐시 키가 domain 뿐이라 **ko 로 요청해도 24h 안에 누가
 *    en/both 로 측정했으면 그 결과를 그대로 받았다**(라이브 실측: medicube·sulwhasoo·
 *    roundlab 3개 도메인이 ko/both 혼재). 리드 metadata 에는 "요청한" 언어가 적혀
 *    CRM 까지 조용히 오염된다.
 *
 * 규칙: 요청 언어를 **실제로 포함하는** 측정만 캐시로 인정한다.
 *   - ko 요청  ← ko 측정만 (both 는 한국어 프롬프트를 절반만 돌려 근거가 부족)
 *   - en 요청  ← en 측정만
 *   - both 요청 ← both 측정만
 * 보수적으로 정확히 일치하는 언어만 허용한다. 캐시 히트율이 조금 낮아지지만,
 * "측정하지 않은 언어의 결과를 그 언어 진단이라고 주는" 오배급보다 낫다.
 */
function cacheableLanguages(
  requested: "ko" | "en" | "both"
): Array<"ko" | "en" | "both"> {
  return [requested];
}

export async function findCachedByDomain(
  domain: string,
  language: "ko" | "en" | "both"
): Promise<string | null> {
  const cached = await database.auditJob.findFirst({
    where: {
      domain,
      // F8 수정 — 언어를 캐시 키에 포함(누락 시 다른 언어 결과가 배급된다).
      language: { in: cacheableLanguages(language) },
      status: "completed",
      // Workspace results are private. They must never be selected as the
      // anonymous/free-domain cache hit.
      organizationId: null,
      // Organization deletion uses SetNull on the FK, but the legacy
      // `org:{orgId}` email marker remains. Keep those rows private too.
      NOT: { email: { startsWith: "org:" } },
      // result 가 실제로 있는 것만(빈 완료 job 을 캐시로 주면 빈 화면이 된다).
      // ⚠️ Prisma Json 필터는 plain null 을 받지 않는다 → DbNull 센티널 사용.
      result: { not: Prisma.DbNull },
      createdAt: { gte: new Date(Date.now() - DOMAIN_CACHE_TTL_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return cached?.id ?? null;
}
