const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 한국 시간 자정에 해당하는 UTC 시각. 서버가 UTC여도 '오늘' 집계가 흔들리지 않는다. */
export function startOfKoreanDay(now: Date): Date {
  const koreanClock = new Date(now.getTime() + KST_OFFSET_MS);
  return new Date(
    Date.UTC(
      koreanClock.getUTCFullYear(),
      koreanClock.getUTCMonth(),
      koreanClock.getUTCDate()
    ) - KST_OFFSET_MS
  );
}
