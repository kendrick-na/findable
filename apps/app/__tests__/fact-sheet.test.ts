import { describe, expect, test } from "vitest";
import {
  buildLlmsText,
  buildOrganizationJsonLd,
  EMPTY_FACT_SHEET,
  normalizeFactSheet,
  normalizeProfiles,
  usableFacts,
} from "../lib/brand/fact-sheet";

const brand = {
  aliases: ["Acme KR"],
  legalName: "Acme Inc.",
  name: "Acme",
  url: "acme.example",
};

const sheet = normalizeFactSheet({
  confirmed: { oneLiner: true, scope: true, profiles: true },
  evidence: { oneLiner: "site", scope: "self" },
  oneLiner: "  We make   widgets  ",
  operator: "Sole proprietor",
  profiles: ["https://linkedin.com/company/acme", "javascript:alert(1)", "x"],
  scope: "Widgets for small shops",
});

describe("팩트시트 정리", () => {
  test("공백 정리·잘못된 주소 제거", () => {
    expect(sheet.oneLiner).toBe("We make widgets");
    expect(sheet.profiles).toEqual(["https://linkedin.com/company/acme"]);
  });
  test("정리 결과는 다시 정리해도 같다(멱등)", () => {
    expect(normalizeFactSheet(sheet)).toEqual(sheet);
  });
  test("프로필은 최대 5개·중복 제거", () => {
    const urls = Array.from({ length: 9 }, (_, i) => `https://e.com/${i % 7}`);
    expect(normalizeProfiles(urls)).toHaveLength(5);
  });
  test("설립 연도가 범위 밖이면 비운다", () => {
    expect(normalizeFactSheet({ foundedYear: 1800 }).foundedYear).toBeNull();
    expect(normalizeFactSheet({ foundedYear: 2020 }).foundedYear).toBe(2020);
  });
  test("이상한 입력도 터지지 않는다", () => {
    expect(normalizeFactSheet(null)).toEqual(EMPTY_FACT_SHEET);
    expect(normalizeFactSheet("x")).toEqual(EMPTY_FACT_SHEET);
  });
});

describe("확인된 사실만 반영", () => {
  test("확인함+증빙이 있는 것만 usable", () => {
    expect([...usableFacts(sheet)].sort()).toEqual(
      ["oneLiner", "profiles", "scope"].sort()
    );
  });
  test("값은 있어도 확인함이 없으면 JSON-LD 에 안 들어간다", () => {
    const ld = buildOrganizationJsonLd(brand, sheet);
    expect(ld.description).toBe("We make widgets");
    expect(ld.sameAs).toEqual(["https://linkedin.com/company/acme"]);
    expect("foundingDate" in ld).toBe(false);
    expect(ld.legalName).toBe("Acme Inc.");
    expect(ld.url).toBe("https://acme.example");
  });
  test("증빙 유형이 없으면 확인함이어도 반영하지 않는다", () => {
    const s = normalizeFactSheet({
      confirmed: { operator: true },
      operator: "X",
    });
    expect(usableFacts(s).has("operator")).toBe(false);
  });
  test("빈 팩트시트는 이름·주소만 나온다(만들어내지 않는다)", () => {
    const text = buildLlmsText(
      {
        aliases: [],
        legalName: null,
        name: "Acme",
        url: "https://acme.example",
      },
      EMPTY_FACT_SHEET
    );
    expect(text).toBe("# Acme\n\n## Facts\n- Website: https://acme.example\n");
  });
  test("llms 문안은 확인된 항목만 담는다", () => {
    const text = buildLlmsText(brand, sheet);
    expect(text).toContain("> We make widgets");
    expect(text).toContain("What we offer: Widgets for small shops");
    expect(text).not.toContain("Operated by");
  });
  test("별칭에서 브랜드 이름과 같은 값·중복은 뺀다", () => {
    const b = { ...brand, aliases: ["acme", "Acme KR", "acme kr"] };
    expect(buildOrganizationJsonLd(b, EMPTY_FACT_SHEET).alternateName).toEqual([
      "Acme KR",
    ]);
    expect(buildLlmsText(b, EMPTY_FACT_SHEET)).toContain(
      "Also written as: Acme KR\n"
    );
  });
});
