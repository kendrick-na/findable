import type { AuditRunInput } from "@repo/audit/runner";
import type { SetupReadinessRecord } from "@repo/audit/setup-readiness";

/** DB JSON 필드에 저장된 별칭만 안전하게 러너 입력으로 넘긴다. */
export const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.trim() !== ""
      )
    : [];

export interface OrgRunInputSource {
  /** 브랜드 행에서 읽은 값(없으면 null). */
  brand: {
    entityVariants: unknown;
    industry?: string | null;
    marketScope?: AuditRunInput["marketScope"] | null;
  } | null;
  brandId: string;
  brandName: string | undefined;
  domain: string;
  invocationStartedAtMs: number;
  jobId: string;
  language: AuditRunInput["language"];
  organizationId: string;
  setupReadiness: SetupReadinessRecord | undefined;
}

/**
 * 고객(org) 측정을 러너에 넘기는 입력 — **start-tracking(즉시 시작)과 대기 줄 일꾼이 같은 함수로** 만든다.
 * 두 곳이 각자 만들면 대기했다 시작한 측정만 입력이 달라지는 사고가 난다(중복 복사 금지).
 */
export function buildOrgRunInput(source: OrgRunInputSource): AuditRunInput {
  return {
    invocationStartedAtMs: source.invocationStartedAtMs,
    jobId: source.jobId,
    domain: source.domain,
    language: source.language,
    brandName: source.brandName,
    // 가입/설정 단계에서 저장한 한글·영문·제품 별칭도 판정기에 전달한다.
    // 비어 있으면 러너가 도메인 기반으로 추론한 별칭을 그대로 사용한다.
    brandVariants: stringList(source.brand?.entityVariants),
    organizationId: source.organizationId,
    brandId: source.brandId,
    // 동명이인 분별 단서(mention-verdict). 없으면 기존과 동일 동작.
    industry: source.brand?.industry ?? undefined,
    // 점수 분모를 정하는 타깃 시장. 없으면 러너가 자동 추정.
    marketScope: source.brand?.marketScope ?? undefined,
    // 마감으로 질문이 남으면 「이어가기 대기」로 멈춘다(2026-10-06).
    //   측정 화면 폴링(continueOrgTracking)·30분 cron 이 남은 질문만 이어서 잰다.
    continueWhenTruncated: true,
    setupReadiness: source.setupReadiness,
  };
}
