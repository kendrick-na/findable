import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRAND_VARIANT_LOCALES,
  BRAND_VARIANT_SEED_KO,
  BRAND_VARIANTS_WIRED_TO_VERDICT,
  splitBrandVariantEntries,
  validateBrandVariantEntry,
  variantsFromOfficialSite,
} from "./brand-variants";
import {
  HOMONYM_SEED_KO,
  HOMONYMS_WIRED_TO_VERDICT,
  validateHomonymCandidate,
} from "./homonym-candidates";

const GOOD = {
  locale: "ko",
  source: "https://example.com/about",
  source_checked_at: "2026-10-20",
  value: "예시이름",
};

describe("별칭 항목 검증 (출처 필수)", () => {
  it("출처 있는 항목만 통과한다", () => {
    const r = validateBrandVariantEntry(GOOD);
    expect(r.ok).toBe(true);
  });

  it("출처가 없거나 비었거나 자리표시면 거부한다", () => {
    for (const source of [
      undefined,
      "",
      "   ",
      "확인 필요",
      "TBD",
      "추정",
      "N/A",
    ]) {
      const r = validateBrandVariantEntry({ ...GOOD, source });
      expect(r.ok, String(source)).toBe(false);
      if (!r.ok) {
        expect(r.issues).toContain("source_missing");
      }
    }
  });

  it("확인일이 없거나 날짜가 아니면 거부한다", () => {
    for (const source_checked_at of [undefined, "", "어제", "2026-13-45"]) {
      const r = validateBrandVariantEntry({ ...GOOD, source_checked_at });
      expect(r.ok).toBe(false);
    }
    expect(
      validateBrandVariantEntry({
        ...GOOD,
        source_checked_at: "2026-10-20T01:02:03Z",
      }).ok
    ).toBe(true);
  });

  it("언어 키는 필수이고 ko·en 만 받는다", () => {
    expect(BRAND_VARIANT_LOCALES).toEqual(["ko", "en"]);
    for (const locale of [undefined, "", "jp", "KO"]) {
      const r = validateBrandVariantEntry({ ...GOOD, locale });
      expect(r.ok, String(locale)).toBe(false);
      if (!r.ok) {
        expect(r.issues).toContain("locale_invalid");
      }
    }
    expect(validateBrandVariantEntry({ ...GOOD, locale: "en" }).ok).toBe(true);
  });

  it("표기가 비었거나 40자를 넘으면 거부, 객체가 아니어도 죽지 않는다", () => {
    expect(validateBrandVariantEntry({ ...GOOD, value: "  " }).ok).toBe(false);
    expect(
      validateBrandVariantEntry({ ...GOOD, value: "가".repeat(41) }).ok
    ).toBe(false);
    expect(validateBrandVariantEntry(null).ok).toBe(false);
    expect(validateBrandVariantEntry("문자열").ok).toBe(false);
  });

  it("묶음 검증: 통과·거부를 나누고, 같은 표기·언어 중복은 거부한다", () => {
    const { accepted, rejected } = splitBrandVariantEntries([
      GOOD,
      { ...GOOD, source: "" },
      { ...GOOD, value: "예시이름" },
      { ...GOOD, locale: "en", value: "Example" },
      { ...GOOD, locale: "en", value: "EXAMPLE" },
    ]);
    expect(accepted.map((e) => `${e.locale}:${e.value}`)).toEqual([
      "ko:예시이름",
      "en:Example",
    ]);
    expect(rejected.map((r) => r.index)).toEqual([1, 2, 4]);
    expect(rejected[1]?.issues).toEqual(["duplicate"]);
  });
});

describe("공식 사이트 표기에서 항목 만들기 (brand-aliases 읽기 전용 사용)", () => {
  it("도메인 이름과 같은 표기만, 출처는 그 사이트로 채운다", () => {
    const entries = variantsFromOfficialSite(
      "knowverse.net",
      { siteName: "KNOWVERSE", title: "Home | We Create the Future" },
      "2026-10-20"
    );
    expect(entries.map((e) => e.value)).toEqual(["KNOWVERSE"]);
    expect(entries[0]).toMatchObject({
      locale: "en",
      source: "official_site:knowverse.net",
      source_checked_at: "2026-10-20",
    });
  });

  it("확인일이 잘못되면 항목이 만들어지지 않는다", () => {
    expect(
      variantsFromOfficialSite("knowverse.net", { siteName: "KNOWVERSE" }, "")
    ).toEqual([]);
  });
});

describe("동명 후보 검증", () => {
  const GOOD_H = {
    locale: "ko",
    name: "예시이름",
    other_entity_ko: "다른 업종의 회사",
    source: "https://example.com/other",
    source_checked_at: "2026-10-20",
  };

  it("출처·언어·설명이 있어야 통과한다", () => {
    expect(validateHomonymCandidate(GOOD_H).ok).toBe(true);
    expect(validateHomonymCandidate({ ...GOOD_H, source: "" }).ok).toBe(false);
    expect(validateHomonymCandidate({ ...GOOD_H, locale: undefined }).ok).toBe(
      false
    );
    expect(
      validateHomonymCandidate({ ...GOOD_H, other_entity_ko: "" }).ok
    ).toBe(false);
    expect(validateHomonymCandidate({ ...GOOD_H, name: "" }).ok).toBe(false);
  });
});

describe("시드·연결 금지", () => {
  it("한국어 시드의 모든 항목은 검증을 통과한다(지금은 0개)", () => {
    for (const list of Object.values(BRAND_VARIANT_SEED_KO)) {
      for (const entry of list) {
        expect(validateBrandVariantEntry(entry).ok).toBe(true);
        expect(entry.locale).toBe("ko");
      }
    }
    for (const list of Object.values(HOMONYM_SEED_KO)) {
      for (const entry of list) {
        expect(validateHomonymCandidate(entry).ok).toBe(true);
        expect(entry.locale).toBe("ko");
      }
    }
  });

  it("판정·측정 경로 파일은 이 두 파일을 import 하지 않는다(그림자·기록만)", () => {
    expect(BRAND_VARIANTS_WIRED_TO_VERDICT).toBe(false);
    expect(HOMONYMS_WIRED_TO_VERDICT).toBe(false);
    const libDir = import.meta.dirname;
    const auditDir = join(libDir, "..", "..", "audit");
    const files = [
      ...readdirSync(libDir).map((f) => join(libDir, f)),
      ...readdirSync(join(libDir, "engines")).map((f) =>
        join(libDir, "engines", f)
      ),
      ...readdirSync(auditDir)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => join(auditDir, f)),
    ].filter(
      (f) =>
        f.endsWith(".ts") &&
        !f.endsWith(".test.ts") &&
        !f.endsWith("brand-variants.ts") &&
        !f.endsWith("homonym-candidates.ts")
    );
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/brand-variants["']/);
      expect(text, file).not.toMatch(/homonym-candidates["']/);
    }
  });
});
