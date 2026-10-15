import {
  scopedCompletedSiteReadinessRuns,
  scopedLatestSiteReadinessRun,
} from "@/lib/db/scoped";
import { summarizeReadiness } from "./today-view";

type ReadinessReport = { checks?: { id?: string; status: string }[] } | null;

/**
 * 「오늘」 화면의 사이트 상태 요약 — 최근 점검 + 같은 주소를 점검한 직전 완료 점검과의 비교.
 * 점검이 없으면 null. 직전 점검이 없으면 `newIssues` 가 null(0 이라고 말하지 않는다).
 */
export async function loadTodaySiteSummary(brandId: string | null) {
  if (!brandId) {
    return null;
  }
  const [latest, completed] = await Promise.all([
    scopedLatestSiteReadinessRun(brandId),
    scopedCompletedSiteReadinessRuns(brandId),
  ]);
  const previous = completed.find(
    (run) => run.id !== latest?.id && run.targetUrl === latest?.targetUrl
  );
  return summarizeReadiness(
    (latest?.report as ReadinessReport)?.checks,
    (previous?.report as ReadinessReport)?.checks
  );
}
