import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkBrandNameAgainstSite } from "./brand-name-check";
import { withRecomputedAuditMetrics } from "./normalize-stored-metrics";

const FIXTURES = join(import.meta.dirname, "__fixtures__", "public-audits");

function fixture(id: string) {
  const data = JSON.parse(readFileSync(join(FIXTURES, `${id}.json`), "utf8"));
  return {
    domain: data.domain as string,
    result: data.result as {
      brandName: string;
      measurementContext: {
        officialSiteIdentity: Record<string, string | null>;
      };
    },
  };
}

function check(id: string) {
  const { domain, result } = fixture(id);
  return checkBrandNameAgainstSite(
    result.brandName,
    domain,
    result.measurementContext.officialSiteIdentity
  );
}

describe("브랜드명 ↔ 공식 사이트 표기", () => {
  it("🔴 「Findable OAuth Verification」 ↔ 사이트명 「Findable」 = 불일치", () => {
    for (const id of [
      "00e40b02-cf16-48c8-bb61-ace0c1da692f",
      "39a89fdb-0d20-4bc2-900f-66bdf332aac2",
    ]) {
      const result = check(id);
      expect(result.status).toBe("mismatch");
      expect(result.siteNames[0]).toBe("Findable");
    }
  });
  it("노우버스는 제목에 이름이 있다 = 일치", () => {
    expect(check("b7f319e1-1d96-4875-a1e1-e7f5e0e814c9").status).toBe("match");
  });
  it("한글 이름 ↔ 영문만 있는 사이트는 음역을 추측하지 않는다 = 판단 보류(경고 없음)", () => {
    expect(check("fcccedb7-a7de-4578-b1be-f42bd162f341").status).toBe(
      "unknown"
    );
    // 같은 회사가 설명에 한글 이름을 쓴 회차는 일치
    expect(check("d5dd90b4-1bf3-4022-bfa6-76de64ab8496").status).toBe("match");
  });
  it("사이트 이름에 단어가 덧붙은 한/영 혼합 이름도 불일치(로마자 규칙만으론 못 잡는다)", () => {
    const site = { siteName: "Findable", title: "GEO audit | Findable" };
    expect(
      checkBrandNameAgainstSite("Findable 인증팀", "findable.co.kr", site)
        .status
    ).toBe("mismatch");
    // 전혀 다른 로마자 이름
    expect(
      checkBrandNameAgainstSite("Acme", "findable.co.kr", site).status
    ).toBe("mismatch");
  });
  it("도메인 이름과 같은 표기는 본문에 없어도 일치", () => {
    expect(
      checkBrandNameAgainstSite("Olive Young", "oliveyoung.co.kr", {
        title: "올리브영 온라인몰",
      }).status
    ).toBe("match");
  });
  it("재계산 경로가 과거 회차에도 대조 결과를 붙인다(API 가 경고를 싣는다)", () => {
    const { result } = fixture("00e40b02-cf16-48c8-bb61-ace0c1da692f");
    const recomputed = withRecomputedAuditMetrics({
      ...result,
      domain: "findable.co.kr",
    }) as unknown as {
      measurementContext: { brandNameCheck: { status: string } };
    };
    expect(recomputed.measurementContext.brandNameCheck.status).toBe(
      "mismatch"
    );
  });
});
