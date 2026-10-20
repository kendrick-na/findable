// 동명(같은 이름의 다른 대상) 후보 사전의 **데이터 구조** (C-a, S2) — 2026-10-21.
//
// brand-variants.ts 와 같은 규칙: 출처 있는 항목만 · 언어 키 필수 · 그림자·기록만(판정에 연결하지 않음)
//   · 실시간 기록 금지 · 순수 함수와 상수만. 확인 못 한 후보는 비워 둔다(지어내지 않음).
//
// 쓰임(나중): 「다른 회사로 앎」 판정을 사람이 검토할 때 「이 이름은 다른 대상도 있다」는 근거 목록. 지금은 구조만.

import {
  BRAND_VARIANT_LOCALES,
  type BrandVariantLocale,
  type EntryIssue,
  isBrandVariantLocale,
  sourceIssues,
} from "./brand-variants";

export const HOMONYM_LOCALES = BRAND_VARIANT_LOCALES;
export type HomonymLocale = BrandVariantLocale;

export interface HomonymCandidateEntry {
  locale: HomonymLocale;
  /** 같은 이름(우리 브랜드 이름과 겹치는 표기) */
  name: string;
  /** 그 이름을 쓰는 다른 대상을 한 줄로(예: 업종·종류). 사실만, 추정 금지 */
  other_entity_ko: string;
  source: string;
  source_checked_at: string;
}

export type HomonymIssue = EntryIssue | "name_missing" | "other_entity_missing";

export type HomonymValidation =
  | { entry: HomonymCandidateEntry; ok: true }
  | { issues: HomonymIssue[]; ok: false };

export function validateHomonymCandidate(input: unknown): HomonymValidation {
  const raw = (
    typeof input === "object" && input !== null ? input : {}
  ) as Record<string, unknown>;
  const issues: HomonymIssue[] = [];
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const other =
    typeof raw.other_entity_ko === "string" ? raw.other_entity_ko.trim() : "";
  if (name.length === 0) {
    issues.push("name_missing");
  }
  if (other.length === 0) {
    issues.push("other_entity_missing");
  }
  if (!isBrandVariantLocale(raw.locale)) {
    issues.push("locale_invalid");
  }
  issues.push(...sourceIssues(raw));
  if (issues.length > 0 || !isBrandVariantLocale(raw.locale)) {
    return { issues, ok: false };
  }
  return {
    entry: {
      locale: raw.locale,
      name,
      other_entity_ko: other,
      source: (raw.source as string).trim(),
      source_checked_at: raw.source_checked_at as string,
    },
    ok: true,
  };
}

/** 한국어 시드: 브랜드 키 → 후보. **출처를 확인한 것만.** 지금은 비어 있다(확인한 항목 0개). */
export const HOMONYM_SEED_KO: Readonly<
  Record<string, readonly HomonymCandidateEntry[]>
> = {};

export const HOMONYMS_WIRED_TO_VERDICT = false as const;
