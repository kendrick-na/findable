import { describe, expect, test } from "vitest";
import { compareWithSite } from "../lib/brand/fact-sheet-compare";

const mine = { businessNumber: "123-45-67890", legalName: "(주)에이컴퍼니" };

describe("사이트 비교", () => {
  test("법인 형태 표기·공백 차이는 같은 상호", () => {
    const r = compareWithSite(mine, {
      businessNumber: "1234567890",
      legalName: "주식회사 에이컴퍼니",
    });
    expect(r.legalName.status).toBe("match");
    expect(r.businessNumber.status).toBe("match");
  });
  test("다른 상호·번호는 differs 로 두 값을 모두 돌려준다", () => {
    const r = compareWithSite(mine, {
      businessNumber: "999-99-99999",
      legalName: "비컴퍼니",
    });
    expect(r.legalName).toEqual({
      mine: "(주)에이컴퍼니",
      site: "비컴퍼니",
      status: "differs",
    });
    expect(r.businessNumber.status).toBe("differs");
  });
  test("사이트를 못 읽었거나 푸터에 없으면 notFound(추정 안 함)", () => {
    expect(compareWithSite(mine, null).legalName.status).toBe("notFound");
    expect(
      compareWithSite(mine, { businessNumber: null, legalName: null })
        .businessNumber.status
    ).toBe("notFound");
  });
  test("내가 안 적은 항목은 notEntered(사이트 값만 참고로)", () => {
    const r = compareWithSite(
      { businessNumber: null, legalName: null },
      { businessNumber: "123-45-67890", legalName: "에이" }
    );
    expect(r.legalName).toEqual({
      mine: null,
      site: "에이",
      status: "notEntered",
    });
    expect(r.businessNumber.status).toBe("notEntered");
  });
});
