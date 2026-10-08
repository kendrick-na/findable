/** @vitest-environment node */
import { describe, expect, test } from "vitest";
import {
  audienceTags,
  classifyIndustry,
  INDUSTRIES,
  industryFromKsic,
  industryFromName,
  industryFromProducts,
  normalizeHomepage,
  normalizeTags,
  regionFromSidoCode,
  regionFromText,
  sizeBucket,
} from "@/lib/ax-mail/discovery/taxonomy";

describe("업종 — KSIC 코드", () => {
  test.each([
    ["20423", "beauty"], // 화장품 제조업
    ["20411", "manufacturing"], // 같은 20 이라도 화장품이 아니면 제조
    ["47813", "beauty"],
    ["14111", "fashion"],
    ["47411", "fashion"],
    ["10712", "food"],
    ["56111", "food"],
    ["21210", "healthcare"],
    ["27111", "healthcare"],
    ["27211", "manufacturing"],
    ["58211", "content_ip"], // 게임 소프트웨어
    ["58221", "b2b_saas"], // 시스템·응용 소프트웨어
    ["62010", "b2b_saas"],
    ["63120", "b2b_saas"],
    ["64191", "finance"],
    ["85501", "education"],
    ["47911", "retail"], // 전자상거래 소매
    ["46101", "retail"],
    ["264", "manufacturing"], // DART 는 3자리만 주기도 한다
    ["68112", "other"],
  ])("%s → %s", (code, industry) => {
    expect(industryFromKsic(code)).toBe(industry);
  });
  test("빈 값·한 자리 → null", () => {
    expect(industryFromKsic(null)).toBeNull();
    expect(industryFromKsic("4")).toBeNull();
  });
});

describe("업종 — 이름·취급품목", () => {
  test.each([
    ["화장품 제조업", "beauty"],
    ["화장품책임판매", "beauty"],
    ["그 외 기타 정보 서비스업", "b2b_saas"],
    ["정보처리S/W", "b2b_saas"],
    ["게임 소프트웨어 개발 및 공급업", "content_ip"],
    ["건강기능식품 제조업", "food"],
    ["의료용 기기 제조업", "healthcare"],
    ["남녀용 겉옷 소매업", "fashion"],
    ["전자상거래 소매업", "retail"],
    ["도소매업", "retail"],
    ["기타 광학기기 및 사진기 제조업", "manufacturing"],
    ["사업시설 유지관리 서비스업", null],
  ])("%s → %s", (name, industry) => {
    expect(industryFromName(name)).toBe(industry);
  });
  test("공정위 취급품목", () => {
    expect(industryFromProducts("의류/패션/잡화/뷰티")).toBe("fashion");
    expect(industryFromProducts("건강/식품")).toBe("food");
    expect(industryFromProducts("의류/패션/잡화/뷰티 건강/식품")).toBe(
      "retail"
    );
    expect(industryFromProducts("종합몰 건강/식품")).toBe("retail");
    expect(industryFromProducts("플라스틱 화장품 용기")).toBe("beauty");
    expect(industryFromProducts("기타")).toBeNull();
  });
  test("우선순위 KSIC → 이름 → 품목, 근거 표시", () => {
    expect(
      classifyIndustry({ industryCode: "62010", industryName: "화장품" })
    ).toEqual({ basis: "ksic", industry: "b2b_saas" });
    expect(
      classifyIndustry({ industryName: "화장품 제조업", products: "건강/식품" })
    ).toEqual({ basis: "name", industry: "beauty" });
    expect(classifyIndustry({ products: "건강/식품" })).toEqual({
      basis: "products",
      industry: "food",
    });
    expect(classifyIndustry({})).toEqual({ basis: null, industry: null });
  });
  test("분류 결과는 언제나 Findable 11업종 안", () => {
    for (const code of [
      "01",
      "05",
      "13",
      "20423",
      "35",
      "41",
      "49",
      "55",
      "61",
      "70",
      "71",
      "86",
      "90",
      "96112",
      "99",
    ]) {
      const v = industryFromKsic(code);
      expect(v === null || (INDUSTRIES as readonly string[]).includes(v)).toBe(
        true
      );
    }
  });
});

describe("태그·규모·지역·도메인", () => {
  test("고객 유형 태그(추정 규칙)", () => {
    expect(
      audienceTags({ industry: "beauty", isMailOrderSeller: true })
    ).toEqual(["b2c", "commerce"]);
    expect(audienceTags({ industry: "retail", industryCode: "47911" })).toEqual(
      ["b2c", "commerce"]
    );
    expect(audienceTags({ industry: "retail", industryCode: "46443" })).toEqual(
      ["b2b"]
    );
    expect(audienceTags({ industry: "manufacturing" })).toEqual(["b2b"]);
    expect(
      audienceTags({ industry: "fashion", industryName: "남녀용 겉옷 소매업" })
    ).toEqual(["b2c"]);
    expect(audienceTags({ industry: null })).toEqual([]);
  });
  test("태그 정규화", () => {
    expect(normalizeTags([" Venture", "venture", "VC invested", ""])).toEqual([
      "vc_invested",
      "venture",
    ]);
  });
  test.each([
    [null, null],
    [0, null],
    [1, "1-4"],
    [4, "1-4"],
    [5, "5-9"],
    [10, "10-49"],
    [49, "10-49"],
    [50, "50-99"],
    [100, "100-499"],
    [499, "100-499"],
    [500, "500+"],
    [120_000, "500+"],
  ])("직원 %s → %s", (n, bucket) => {
    expect(sizeBucket(n)).toBe(bucket);
  });
  test("지역", () => {
    expect(regionFromText("서울특별시 관악구")).toBe("서울");
    expect(regionFromText("강원특별자치도 춘천시")).toBe("강원");
    expect(regionFromText("전북특별자치도 전주시")).toBe("전북");
    expect(regionFromText("충청남도 천안시")).toBe("충남");
    expect(regionFromText("경남")).toBe("경남");
    expect(regionFromText("해외")).toBeNull();
    expect(regionFromSidoCode("41")).toBe("경기");
    expect(regionFromSidoCode("51")).toBe("강원");
    expect(regionFromSidoCode("99")).toBeNull();
  });
  test("도메인 — 자체 사이트 vs 입점몰", () => {
    expect(normalizeHomepage("www.alphachips.co.kr")).toEqual({
      domain: "alphachips.co.kr",
      storeUrl: null,
    });
    expect(normalizeHomepage("https://WWW.Franz.com/ko/about")).toEqual({
      domain: "franz.com",
      storeUrl: null,
    });
    expect(normalizeHomepage("https://smartstore.naver.com/abc")).toEqual({
      domain: null,
      storeUrl: "https://smartstore.naver.com/abc",
    });
    expect(normalizeHomepage("instagram.com/brand")).toEqual({
      domain: null,
      storeUrl: "http://instagram.com/brand",
    });
    expect(normalizeHomepage("null")).toEqual({ domain: null, storeUrl: null });
    expect(normalizeHomepage("없음")).toEqual({ domain: null, storeUrl: null });
  });
});
