/**
 * 공개 글 날짜 표시 — 한국 시간(Asia/Seoul) 기준 날짜.
 *
 * 🔴 `toLocaleDateString(언어)` 만 쓰면 서버(UTC) 날짜가 나와, 한국 시간 0시~9시에 올린 글이
 *   전날로 보였다(2026-10-16 실측: 10/16 02:03 KST 공개 글이 「2026. 10. 15.」). 서비스·운영 기준이
 *   한국이라 표시 시간대를 고정한다. 구조화 데이터의 `datePublished`(ISO, UTC)는 이 함수와 무관하다.
 */
export const DISPLAY_TIME_ZONE = "Asia/Seoul";

export function formatDisplayDate(
  date: Date | null | undefined,
  locale: string
): string | undefined {
  return date?.toLocaleDateString(locale, { timeZone: DISPLAY_TIME_ZONE });
}
