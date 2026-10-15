/**
 * 브랜드 팩트시트(G1, 2026-10-16) — 고객이 **확인했다고 표시한 사실만** 미리보기에 반영한다.
 * 순수 함수만 둔다(DB·네트워크 없음). 문장은 만들지 않고 고객이 적은 값만 옮긴다 —
 * 없는 인력·실적·수상을 채우지 않는다.
 */

export const FACT_KEYS = [
  "oneLiner",
  "operator",
  "scope",
  "profiles",
  "foundedYear",
  "disambiguation",
] as const;
export type FactKey = (typeof FACT_KEYS)[number];

export const EVIDENCE_TYPES = ["site", "registry", "self"] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export interface FactSheetData {
  confirmed: Partial<Record<FactKey, boolean>>;
  disambiguation: string;
  evidence: Partial<Record<FactKey, EvidenceType>>;
  foundedYear: number | null;
  oneLiner: string;
  operator: string;
  profiles: string[];
  scope: string;
}

export const EMPTY_FACT_SHEET: FactSheetData = {
  confirmed: {},
  disambiguation: "",
  evidence: {},
  foundedYear: null,
  oneLiner: "",
  operator: "",
  profiles: [],
  scope: "",
};

const LIMITS = {
  oneLiner: 60,
  operator: 40,
  scope: 200,
  disambiguation: 120,
  profiles: 5,
} as const;

const clip = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().replaceAll(/\s+/g, " ").slice(0, max) : "";

/** 공식 프로필 주소 정규화 — http(s) 만, 중복 제거, 최대 5개. 잘못된 값은 버린다. */
export function normalizeProfiles(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") {
      continue;
    }
    try {
      const url = new URL(raw.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        continue;
      }
      const href = url.toString();
      if (!seen.has(href)) {
        seen.add(href);
        out.push(href);
      }
    } catch {
      // 주소가 아닌 값은 버린다.
    }
    if (out.length >= LIMITS.profiles) {
      break;
    }
  }
  return out;
}

/** 저장·화면 입력을 같은 규칙으로 정리한다(알 수 없는 키는 버린다). */
export function normalizeFactSheet(input: unknown): FactSheetData {
  const src = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;
  const confirmedSrc = (src.confirmed ?? {}) as Record<string, unknown>;
  const evidenceSrc = (src.evidence ?? {}) as Record<string, unknown>;
  const confirmed: FactSheetData["confirmed"] = {};
  const evidence: FactSheetData["evidence"] = {};
  for (const key of FACT_KEYS) {
    if (confirmedSrc[key] === true) {
      confirmed[key] = true;
    }
    const ev = evidenceSrc[key];
    if ((EVIDENCE_TYPES as readonly unknown[]).includes(ev)) {
      evidence[key] = ev as EvidenceType;
    }
  }
  const year = Number(src.foundedYear);
  const thisYear = new Date().getUTCFullYear();
  return {
    confirmed,
    disambiguation: clip(src.disambiguation, LIMITS.disambiguation),
    evidence,
    foundedYear:
      Number.isInteger(year) && year >= 1900 && year <= thisYear ? year : null,
    oneLiner: clip(src.oneLiner, LIMITS.oneLiner),
    operator: clip(src.operator, LIMITS.operator),
    profiles: normalizeProfiles(src.profiles),
    scope: clip(src.scope, LIMITS.scope),
  };
}

/** 미리보기에 반영할 수 있는 항목 = 값이 있고 「확인함」이 켜져 있으며 증빙 유형이 골라진 것. */
export function usableFacts(sheet: FactSheetData): Set<FactKey> {
  const out = new Set<FactKey>();
  for (const key of FACT_KEYS) {
    const value = sheet[key];
    const filled = Array.isArray(value)
      ? value.length > 0
      : value !== "" && value !== null;
    // 공식 프로필 주소는 주소 자체가 증빙이라 증빙 유형을 따로 묻지 않는다.
    const hasEvidence = key === "profiles" || Boolean(sheet.evidence[key]);
    if (filled && sheet.confirmed[key] === true && hasEvidence) {
      out.add(key);
    }
  }
  return out;
}

export interface BrandIdentity {
  /** 표기 변형(별칭). */
  aliases: string[];
  /** 고객이 직접 넣은 정식 상호(있을 때만). */
  legalName: string | null;
  name: string;
  /** 사이트 주소(도메인 또는 URL). */
  url: string;
}

const HAS_SCHEME = /^https?:\/\//i;
const asUrl = (domain: string) =>
  HAS_SCHEME.test(domain) ? domain : `https://${domain}`;

/** 별칭에서 브랜드 이름과 같은 값(대소문자 무시)과 중복을 뺀다. */
const distinctAliases = (brand: BrandIdentity): string[] => {
  const seen = new Set([brand.name.trim().toLowerCase()]);
  const out: string[] = [];
  for (const alias of brand.aliases) {
    const key = alias.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(alias);
    }
  }
  return out;
};

/** schema.org `Organization` JSON-LD. 확인된 항목만 넣는다. */
export function buildOrganizationJsonLd(
  brand: BrandIdentity,
  sheet: FactSheetData
): Record<string, unknown> {
  const ok = usableFacts(sheet);
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: brand.name,
    url: asUrl(brand.url),
  };
  if (brand.legalName) {
    ld.legalName = brand.legalName;
  }
  const aliases = distinctAliases(brand);
  if (aliases.length > 0) {
    ld.alternateName = aliases;
  }
  if (ok.has("oneLiner")) {
    ld.description = sheet.oneLiner;
  }
  if (ok.has("foundedYear") && sheet.foundedYear !== null) {
    ld.foundingDate = String(sheet.foundedYear);
  }
  if (ok.has("profiles")) {
    ld.sameAs = sheet.profiles;
  }
  return ld;
}

/** `llms.txt` 문안. 키 이름은 영어 고정(파일 형식), 값은 고객이 적은 그대로. */
export function buildLlmsText(
  brand: BrandIdentity,
  sheet: FactSheetData
): string {
  const ok = usableFacts(sheet);
  const lines: string[] = [`# ${brand.name}`];
  if (ok.has("oneLiner")) {
    lines.push("", `> ${sheet.oneLiner}`);
  }
  const facts: string[] = [];
  if (brand.legalName) {
    facts.push(`- Legal name: ${brand.legalName}`);
  }
  const aliases = distinctAliases(brand);
  if (aliases.length > 0) {
    facts.push(`- Also written as: ${aliases.join(", ")}`);
  }
  if (ok.has("operator")) {
    facts.push(`- Operated by: ${sheet.operator}`);
  }
  if (ok.has("scope")) {
    facts.push(`- What we offer: ${sheet.scope}`);
  }
  if (ok.has("foundedYear") && sheet.foundedYear !== null) {
    facts.push(`- Founded: ${sheet.foundedYear}`);
  }
  if (ok.has("disambiguation")) {
    facts.push(`- Not to be confused with: ${sheet.disambiguation}`);
  }
  facts.push(`- Website: ${asUrl(brand.url)}`);
  if (ok.has("profiles")) {
    for (const p of sheet.profiles) {
      facts.push(`- Official profile: ${p}`);
    }
  }
  lines.push("", "## Facts", ...facts, "");
  return lines.join("\n");
}
