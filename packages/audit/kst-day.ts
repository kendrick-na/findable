/*
 * KST(한국 표준시) 하루 경계 계산 — 2026-08-12 세션N-25.
 *
 * 🔴 **왜 순수 함수로 빼는가**
 *   ① `apps/web` 에는 **테스트 러너가 없다**(프로젝트 확립 사실). 라우트 안에 두면
 *      이 계산은 영원히 검증되지 않는다.
 *   ② 날짜 경계는 **라이브에서 확인하기가 사실상 불가능**하다 — 자정을 기다려야 하고
 *      경계 직전/직후를 재현할 수 없다. 프로젝트 교훈: *"라이브에서 확인 못 하는
 *      경로는 순수 함수로 빼서 테스트로 고정한다."*
 *
 * 🔴 **왜 UTC 가 아니라 KST 인가**
 *   이 프로젝트는 cron 에서 이미 한 번 크게 뎄다 — `0 17 * * *` 을 "새벽 2시"로 읽었지만
 *   UTC 라서 **오전 11시 KST** 에 돌고 있었다(`auto-refresh-tracking/route.ts:20~22`).
 *   일일 상한을 UTC 자정으로 끊으면 한국 사용자에겐 **오전 9시에 리셋**된다
 *   → "아침부터 이미 소진" 같은 이상 동작이 된다.
 */

/** KST = UTC + 9시간. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 주어진 시각이 속한 **KST 하루의 시작(자정)** 을 UTC `Date` 로 돌려준다.
 *
 * 반환값은 그대로 Prisma 의 `{ gte: ... }` 에 넣어 "오늘 몇 건" 을 셀 수 있다.
 *
 * @param now 기준 시각. 테스트에서 경계를 직접 주입할 수 있게 인자로 받는다
 *   (🔴 `Date.now()` 를 안에서 부르면 **가짜 타이머가 시계를 안 돌려** 테스트가 불가능해진다 —
 *   프로젝트 함정 목록에 있는 항목이다).
 */
export function kstDayStart(now: Date): Date {
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  // UTC 게터로 읽는다 — 서버 로컬 타임존이 무엇이든 결과가 같아야 한다.
  const kstMidnightAsUtc = Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate()
  );
  return new Date(kstMidnightAsUtc - KST_OFFSET_MS);
}
