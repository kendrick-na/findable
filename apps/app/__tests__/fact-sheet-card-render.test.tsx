import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import en from "../../../packages/internationalization/dictionaries/en.json";
import ko from "../../../packages/internationalization/dictionaries/ko.json";
import { FactSheetCard } from "../app/(authenticated)/features/brand/fact-sheet-card";
import { EMPTY_FACT_SHEET, normalizeFactSheet } from "../lib/brand/fact-sheet";

const brand = {
  aliases: [],
  legalName: null,
  name: "Acme",
  url: "acme.example",
};
const onCompare = async () => ({ error: "x" });
const onSave = async () => ({ ok: true }) as const;

describe("FactSheetCard 렌더", () => {
  test("빈 상태: 안내와 빈 미리보기 문구, 치환 안 된 자리표시자 없음", () => {
    const html = renderToStaticMarkup(
      <FactSheetCard
        brand={brand}
        brandId="b1"
        initial={EMPTY_FACT_SHEET}
        onCompare={onCompare}
        onSave={onSave}
        t={ko.app.factSheet}
      />
    );
    expect(html).toContain("내 브랜드 정보");
    expect(html).toContain("사이트와 비교하기");
    expect(html).toContain("아직 확인한 사실이 없어요");
    expect(html).toContain("사이트에는 자동으로 올라가지 않아요");
    expect(html).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  test("확인한 사실은 미리보기(JSON-LD·llms)에 나온다 — 영어도 같은 구조", () => {
    const initial = normalizeFactSheet({
      confirmed: { oneLiner: true },
      evidence: { oneLiner: "site" },
      oneLiner: "We make widgets",
    });
    const html = renderToStaticMarkup(
      <FactSheetCard
        brand={brand}
        brandId="b1"
        initial={initial}
        onCompare={onCompare}
        onSave={onSave}
        t={en.app.factSheet}
      />
    );
    expect(html).toContain("We make widgets");
    expect(html).toContain("&quot;@type&quot;: &quot;Organization&quot;");
    expect(html).toContain("# Acme");
    expect(html).not.toContain("No confirmed facts yet");
  });
});
