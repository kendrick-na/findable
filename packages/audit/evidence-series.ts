import {
  type BeforeAfterRow,
  buildBeforeAfterRow,
  type CompletionRecord,
} from "./before-after";

/**
 * ActionCompletion snapshots are displayed as 0–100 mention percentages.
 * Tracking.shareOfVoice is a 0–1 *per-answer* share, not a run-level mention
 * percentage. Never compare those columns directly.
 */
export function completionMentionRate(percent: number | null): number | null {
  if (
    percent === null ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100
  ) {
    return null;
  }
  return percent / 100;
}

/**
 * Historical Tracking rows have no auditJobId/axis, and can contain a briefing
 * row with the same timestamp, a briefing-only run, or a different question and
 * verdict cohort. A scalar snapshot cannot prove that any later run is
 * comparable. Hide the delta until provenance-aware pairing is implemented.
 */
export function buildUnattributedEvidenceRow(
  completion: CompletionRecord
): BeforeAfterRow {
  const row = buildBeforeAfterRow(
    {
      ...completion,
      sovAtCompletion: completionMentionRate(completion.sovAtCompletion),
    },
    []
  );
  return {
    ...row,
    caveats: [
      "측정 실행·질문·엔진·판정 버전을 조치 전후에 연결할 근거가 없어 변화 수치를 표시하지 않습니다. 재측정이 있더라도 비교 가능성이 확인되기 전에는 효과로 인용할 수 없습니다.",
    ],
  };
}
