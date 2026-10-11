/**
 * 측정 준비도(setup readiness) — 측정을 시작해도 되는 설정이 갖춰졌는지의 **단일 규칙**(2026-10-12).
 *
 * 🔴 왜: 프란츠·넘버즈인·프롬맘은 '브랜드 추가'로 등록돼 경쟁사·질문 단계를 건너뛰고
 *   이름 질문만으로 측정됐다. 판정이 4곳에 복제돼(brand 화면·start-tracking·프로필 편집기·
 *   브랜드 추가 폼) 어느 길은 이름·업종·시장만 보고 나머지는 아무도 보지 않았다.
 *   이 파일이 그 판정의 한 곳이다 — 화면·서버·cron·관리자 경로는 모두 이 함수를 부른다.
 *
 * 규칙
 *   필수(required)  : 이름(2자 이상 · 도메인과 같지 않음) · 업종 · 타깃 시장. 빠지면 측정을 시작할 수 없다.
 *   권장(게이트 대상): 별칭 · 경쟁사(1곳 이상 또는 '없음' 명시) · 저장된 추적 질문 중 이름 없는 질문 1개 이상
 *                     · 이름 확인(brandNameCheck)이 mismatch 가 아님.
 *                     빠져도 막지 않는다 — 추천 단계로 안내하고, 건너뛰면 그 선택을 기록한다.
 *
 * 순수 함수다(DB·네트워크 없음). 값은 호출부가 읽어서 넘긴다.
 * 경쟁사는 '미설정/없음/n곳'을 값 인터페이스(CompetitorSetting)로만 받는다 —
 * '없음'을 어디에 저장하는지는 이 규칙과 무관하다.
 */

import { classifySavedPromptKind } from "./audit-prompts";

export type CompetitorSetting =
  | { kind: "none" }
  | { count: number; kind: "set" }
  | { kind: "unset" };

export type SetupRequirement = "required" | "recommended";

export type SetupItemCode =
  | "alias"
  | "brand_name_mismatch"
  | "competitors"
  | "discovery_prompt"
  | "industry"
  | "market_scope"
  | "name";

/** 항목 코드 → 필수/권장. 화면·로그가 같은 분류를 쓴다. */
export const SETUP_ITEM_REQUIREMENT: Record<SetupItemCode, SetupRequirement> = {
  name: "required",
  industry: "required",
  market_scope: "required",
  alias: "recommended",
  competitors: "recommended",
  discovery_prompt: "recommended",
  brand_name_mismatch: "recommended",
};

export interface BrandSetupInput {
  /** Brand.entityVariants 의 문자열 목록(별칭). */
  aliases?: readonly string[];
  /** 이름 확인 결과(runner 의 measurementContext.brandNameCheck.status). 없으면 판단하지 않는다. */
  brandNameCheck?: "match" | "mismatch" | "unknown" | null;
  competitors: CompetitorSetting;
  domain: string;
  /** 영문 표기(없으면 name). 이름 없는 질문 판별에 쓴다. */
  englishName?: string | null;
  industry?: string | null;
  marketScope?: string | null;
  name?: string | null;
  /** 저장된 추적 질문(Prompt.text). */
  savedPrompts?: readonly { text: string }[];
}

export type SetupLevel =
  /** 필수 항목이 비었다 — 측정을 시작할 수 없다. */
  | "blocked"
  /** 필수는 갖췄지만 권장 항목이 비었다 — 추천 단계로 안내, 건너뛰기는 명시 선택. */
  | "needs_setup"
  | "ready";

export interface BrandSetupReadiness {
  level: SetupLevel;
  /** 비어 있는 권장 항목. */
  missingRecommended: SetupItemCode[];
  /** 비어 있는 필수 항목. */
  missingRequired: SetupItemCode[];
}

/** 측정 기록(measurementContext)에 남기는 모양 — 건너뛴 선택까지 함께. */
export interface SetupReadinessRecord {
  level: SetupLevel;
  missingRecommended: SetupItemCode[];
  missingRequired: SetupItemCode[];
  /** '기본값으로 진행'을 명시 선택했으면 true. 미달이 아니면 항상 false. */
  skippedSetup: boolean;
}

const MIN_NAME_LENGTH = 2;
const WWW_RE = /^www\./;
const SCHEME_RE = /^https?:\/\//;

function hostOf(domain: string): string {
  return (
    domain
      .trim()
      .toLowerCase()
      .replace(SCHEME_RE, "")
      .replace(WWW_RE, "")
      .split("/")[0] ?? ""
  );
}

/** 이름이 쓸 수 있는 표기인가 — 2자 이상이고 도메인 문자열 그대로가 아니다. */
export function isUsableBrandName(
  name: string | null | undefined,
  domain: string
): boolean {
  const trimmed = (name ?? "").trim();
  if (trimmed.length < MIN_NAME_LENGTH) {
    return false;
  }
  return trimmed.toLowerCase().replace(WWW_RE, "") !== hostOf(domain);
}

function hasDiscoveryPrompt(input: BrandSetupInput, name: string): boolean {
  const names = { ko: name, en: input.englishName?.trim() || name };
  const variants = input.aliases ?? [];
  return (input.savedPrompts ?? []).some(
    (prompt) =>
      classifySavedPromptKind(prompt.text, names, variants) === "discovery"
  );
}

export function getBrandSetupReadiness(
  input: BrandSetupInput
): BrandSetupReadiness {
  const missing = new Set<SetupItemCode>();
  const name = (input.name ?? "").trim();

  if (!isUsableBrandName(name, input.domain)) {
    missing.add("name");
  }
  if (!input.industry) {
    missing.add("industry");
  }
  if (!input.marketScope) {
    missing.add("market_scope");
  }
  if ((input.aliases ?? []).filter((v) => v.trim().length > 0).length === 0) {
    missing.add("alias");
  }
  if (
    input.competitors.kind === "unset" ||
    (input.competitors.kind === "set" && input.competitors.count < 1)
  ) {
    missing.add("competitors");
  }
  if (!(name && hasDiscoveryPrompt(input, name))) {
    missing.add("discovery_prompt");
  }
  if (input.brandNameCheck === "mismatch") {
    missing.add("brand_name_mismatch");
  }

  const all = [...missing];
  const missingRequired = all.filter(
    (code) => SETUP_ITEM_REQUIREMENT[code] === "required"
  );
  const missingRecommended = all.filter(
    (code) => SETUP_ITEM_REQUIREMENT[code] === "recommended"
  );
  let level: SetupLevel = "ready";
  if (missingRequired.length > 0) {
    level = "blocked";
  } else if (missingRecommended.length > 0) {
    level = "needs_setup";
  }
  return { level, missingRecommended, missingRequired };
}

/**
 * 측정 기록용 값. `skippedSetup` 은 사용자가 '기본값으로 진행'을 **명시 선택**했을 때만 true 가 되며,
 * 이미 준비가 끝난(ready) 상태에서는 선택할 것이 없으므로 항상 false 다.
 */
export function toSetupReadinessRecord(
  readiness: BrandSetupReadiness,
  skippedSetup: boolean
): SetupReadinessRecord {
  return {
    level: readiness.level,
    missingRecommended: readiness.missingRecommended,
    missingRequired: readiness.missingRequired,
    skippedSetup: readiness.level === "needs_setup" && skippedSetup,
  };
}

/**
 * 측정을 시작해도 되는가. blocked 는 항상 불가. needs_setup 은 '기본값으로 진행'을 명시했을 때만 가능.
 * 자동 경로(cron)는 skip 을 선택할 수 없으므로 needs_setup 이면 false — 호출부가 needs_setup 으로 기록한다.
 */
export function mayStartMeasurement(
  readiness: BrandSetupReadiness,
  skippedSetup: boolean
): boolean {
  if (readiness.level === "blocked") {
    return false;
  }
  return readiness.level === "ready" || skippedSetup;
}
