export type AuditPostprocessingStage =
  | "pending"
  | "completed"
  | "failed"
  | "unknown"
  | "reconciling"
  | "deferred"
  | "not_required"
  | "skipped"
  | "not_applicable"
  | "unreplayable"
  | "retry_exhausted";

/** Core AuditJob.completed is not a promise that these derived outputs exist. */
export interface AuditPostprocessing {
  briefing: AuditPostprocessingStage;
  pdf: AuditPostprocessingStage;
  tracking: AuditPostprocessingStage;
}

export function auditPostprocessingWarning(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null; // legacy jobs predate this explicit status
  }
  const stages = value as Partial<AuditPostprocessing>;
  if (
    stages.tracking === "pending" ||
    stages.tracking === "failed" ||
    stages.tracking === "unknown" ||
    stages.tracking === "unreplayable" ||
    stages.tracking === "retry_exhausted"
  ) {
    return "측정 결과는 저장됐지만 대시보드 시계열 반영은 아직 완료되지 않았습니다.";
  }
  if (
    stages.pdf === "pending" ||
    stages.pdf === "failed" ||
    stages.pdf === "unknown" ||
    stages.pdf === "deferred"
  ) {
    return "측정 결과는 저장됐지만 PDF 생성은 아직 완료되지 않았습니다.";
  }
  if (
    stages.briefing === "pending" ||
    stages.briefing === "failed" ||
    stages.briefing === "unknown" ||
    stages.briefing === "deferred"
  ) {
    return "측정 결과는 저장됐지만 네이버 AI 브리핑은 아직 완료되지 않았습니다.";
  }
  return null;
}
