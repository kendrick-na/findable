import type { MeasureCompanyResult } from "@/app/actions/admin/sales-discovery";
import { daysSince } from "@/lib/ax-mail/discovery/view";
import type { AppDictionary } from "@/lib/i18n";

/** [측정] 문구 — 순수 함수(서버액션·브라우저 API 없음). measure-button.tsx 가 쓴다. */

type Labels = AppDictionary["salesDiscover"];

/** 결과 → 쉬운 문구. 기술 오류 원문은 화면에 내보내지 않는다(서버 로그에만 남는다). */
export function measureMessage(
  labels: Labels,
  result: MeasureCompanyResult
): string {
  if (!result.ok) {
    if (result.error === "no_domain") {
      return labels.measureNoDomain;
    }
    return result.error === "failed"
      ? labels.measureFailed
      : labels.errors[result.error];
  }
  if (result.outcome === "already_running") {
    return labels.measureRunning;
  }
  return result.brandCreated ? labels.measureRegistered : labels.measureStarted;
}

/** 유료 측정 전 확인 문구 — 최근 영업 측정이 있으면 「N일 전 측정 있음 — 다시 측정할까요?」 */
export function measureConfirmText(
  labels: Labels,
  lastMeasuredAt: string | null | undefined,
  now: Date = new Date()
): string {
  const days = daysSince(lastMeasuredAt, now);
  let ask = labels.measureConfirmAsk;
  if (days === 0) {
    ask = labels.measureConfirmToday;
  } else if (days !== null) {
    ask = labels.measureConfirmRecent.replace("{days}", String(days));
  }
  return `${ask}\n\n${labels.measureConfirm}`;
}
