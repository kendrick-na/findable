// 별칭(브랜드 표기 변형) 사전의 **데이터 구조** (C-a, S2) — 2026-10-21.
//
// 범위(대표 승인): 구조·검증·한국어 시드만. **판정에 연결하지 않는다 — 그림자·기록만.**
//   · `mention-verdict*.ts`·`brand-aliases.ts`·측정 경로·플래그를 수정하지 않는다. 이 파일을 import 하는 곳은
//     이 파일의 시험뿐이다(시험이 소스를 훑어 확인한다).
//   · 실시간 기록 금지. 이 파일은 순수 함수와 상수만 둔다(DB·네트워크·환경변수 없음).
//
// 규칙: **출처 있는 항목만.** 출처(source)가 비었거나 「확인 필요」 같은 자리표시면 거부한다.
//   확인하지 못한 항목은 비워 둔다 — 추측(번역·로마자 변환)으로 채우지 않는다(brand-aliases.ts 와 같은 원칙).
//
// packages/audit 에 의존하지 않는다(audit 이 ai 를 쓰는 방향이라 되돌리면 순환).

import { officialSiteAliases } from "./brand-aliases";

/** 언어 키. 지금 채우는 것은 ko 뿐이다. 값 추가는 계약 변경(K0 `PROOF_LANGUAGES` 와 같은 값을 쓴다). */
export const BRAND_VARIANT_LOCALES = ["ko", "en"] as const;
export type BrandVariantLocale = (typeof BRAND_VARIANT_LOCALES)[number];

export interface BrandVariantEntry {
  locale: BrandVariantLocale;
  /** 출처: URL 또는 문서 식별자. 필수. */
  source: string;
  /** 출처를 확인한 날(ISO, YYYY-MM-DD 또는 전체 ISO). 필수. */
  source_checked_at: string;
  /** 표기 변형(별칭) 그대로 */
  value: string;
}

export type EntryIssue =
  | "locale_invalid"
  | "source_checked_at_invalid"
  | "source_missing"
  | "value_missing"
  | "value_too_long";

export type EntryValidation<T> =
  | { entry: T; ok: true }
  | { issues: EntryIssue[]; ok: false };

const MAX_VALUE_LENGTH = 40; // brand-aliases.ts MAX_ALIAS_LENGTH 와 같다
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
/** 출처 자리에 쓰면 안 되는 말(지어낸 출처 방지). 소문자 비교. */
const PLACEHOLDER_SOURCES: ReadonlySet<string> = new Set([
  "-",
  "?",
  "n/a",
  "na",
  "none",
  "null",
  "tbd",
  "todo",
  "unknown",
  "추정",
  "미확인",
  "확인 필요",
  "확인필요",
  "없음",
]);

export function isBrandVariantLocale(
  value: unknown
): value is BrandVariantLocale {
  return (
    typeof value === "string" &&
    (BRAND_VARIANT_LOCALES as readonly string[]).includes(value)
  );
}

/** 출처 필드 공통 검증(별칭·동명 후보가 같이 쓴다). */
export function sourceIssues(input: {
  source?: unknown;
  source_checked_at?: unknown;
}): EntryIssue[] {
  const issues: EntryIssue[] = [];
  const source = typeof input.source === "string" ? input.source.trim() : "";
  if (source.length === 0 || PLACEHOLDER_SOURCES.has(source.toLowerCase())) {
    issues.push("source_missing");
  }
  const checked = input.source_checked_at;
  if (
    typeof checked !== "string" ||
    !DATE_RE.test(checked) ||
    Number.isNaN(Date.parse(checked))
  ) {
    issues.push("source_checked_at_invalid");
  }
  return issues;
}

export function validateBrandVariantEntry(
  input: unknown
): EntryValidation<BrandVariantEntry> {
  const raw = (
    typeof input === "object" && input !== null ? input : {}
  ) as Record<string, unknown>;
  const issues: EntryIssue[] = [];
  const value = typeof raw.value === "string" ? raw.value.trim() : "";
  if (value.length === 0) {
    issues.push("value_missing");
  } else if (value.length > MAX_VALUE_LENGTH) {
    issues.push("value_too_long");
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
      source: (raw.source as string).trim(),
      source_checked_at: raw.source_checked_at as string,
      value,
    },
    ok: true,
  };
}

export interface RejectedEntry {
  index: number;
  issues: EntryIssue[] | ["duplicate"];
}

/** 같은 (표기, 언어) 는 한 번만 받는다(대소문자 무시) — 두 번째부터 거부. */
export function splitBrandVariantEntries(inputs: readonly unknown[]): {
  accepted: BrandVariantEntry[];
  rejected: RejectedEntry[];
} {
  const accepted: BrandVariantEntry[] = [];
  const rejected: RejectedEntry[] = [];
  const seen = new Set<string>();
  inputs.forEach((input, index) => {
    const result = validateBrandVariantEntry(input);
    if (!result.ok) {
      rejected.push({ index, issues: result.issues });
      return;
    }
    const key = `${result.entry.locale}:${result.entry.value.toLowerCase()}`;
    if (seen.has(key)) {
      rejected.push({ index, issues: ["duplicate"] });
      return;
    }
    seen.add(key);
    accepted.push(result.entry);
  });
  return { accepted, rejected };
}

/**
 * 공식 사이트가 스스로 쓰는 표기에서 항목을 만든다(출처 = 그 사이트). `officialSiteAliases` 를 읽기만 쓴다.
 * 반환은 로마자 표기라 locale 은 "en" 이다. 한국어 이름 항목은 사람이 출처를 확인해 넣는다.
 */
export function variantsFromOfficialSite(
  domain: string,
  site: { siteName?: string | null; title?: string | null } | null | undefined,
  checkedAt: string
): BrandVariantEntry[] {
  const host = domain.trim().toLowerCase();
  return splitBrandVariantEntries(
    officialSiteAliases(host, site).map((value) => ({
      locale: "en",
      source: `official_site:${host}`,
      source_checked_at: checkedAt,
      value,
    }))
  ).accepted;
}

/**
 * 한국어 시드: 브랜드 키 → 항목. **출처를 확인한 것만** 넣는다. 지금은 비어 있다(2026-10-20 기준 확인한 항목 0개).
 * 항목을 넣을 때는 시험(`brand-variants.test.ts`)이 전부 검증을 통과해야 한다.
 */
export const BRAND_VARIANT_SEED_KO: Readonly<
  Record<string, readonly BrandVariantEntry[]>
> = {};

/** 판정 경로에 연결돼 있지 않다는 표시(그림자·기록만). 연결하려면 대표의 동결 예외 승인이 먼저다. */
export const BRAND_VARIANTS_WIRED_TO_VERDICT = false as const;
