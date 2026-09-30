import { describe, expect, it } from "vitest";
import { __internal } from "./mention-verdict";

const techDdOfficialSite = {
  description: "기술의 진짜 실력을, 유출 걱정 없이. 근거와 숫자로 말하는 정량 기술 실사.",
  h1: "대표님 회사의 코드 안에, 무엇이 들어 있는지 아십니까?",
  title: "TechDD",
};

describe("official identity evidence", () => {
  it("does not treat generic company-and-technology words as evidence for a same-name company", () => {
    expect(
      __internal.hasOfficialIdentityEvidence({
        brandName: "TechDD",
        brandDomain: "dd.knowverse.net",
        officialSite: techDdOfficialSite,
        text: "TechDD는 대한민국의 IT/클라우드 전문 브랜드(기업명: ㈜테크디디)로 알려져 있으며, 주로 클라우드 인프라 구축·운영, DevOps/자동화, 시스템 통합(SI), 보안, 모니터링/관제 같은 기업용 기술 서비스를 제공합니다. 정확한 브랜드 정의와 최신 서비스는 공식 홈페이지에서 확인하는 것이 좋습니다.",
      })
    ).toBe(false);
  });

  it("flags a response that mixes the official domain with another same-name company domain", () => {
    expect(
      __internal.hasConflictingBrandDomain({
        brandName: "TechDD",
        brandDomain: "dd.knowverse.net",
        citedDomains: ["dd.knowverse.net", "techdd.co.uk"],
      })
    ).toBe(true);
  });

  it("accepts the company root domain as an official source for a product subdomain", () => {
    expect(
      __internal.hasOfficialIdentityEvidence({
        brandName: "TechDD",
        brandDomain: "dd.knowverse.net",
        citedDomains: ["knowverse.net"],
        officialSite: techDdOfficialSite,
        text: "TechDD(노우버스)는 폐쇄망에서 정량 기술 실사를 지원합니다.",
      })
    ).toBe(true);
  });

  it("does not validate a namesake creative-studio answer with a skincare brand's metadata", () => {
    // Live regression (멜트헤일로): the answer names a 3D/CG studio and has no
    // official source. A literal brand-name match must never turn that into
    // evidence for the skincare brand.
    expect(
      __internal.hasOfficialIdentityEvidence({
        brandName: "멜트헤일로",
        brandDomain: "melthalo.com",
        officialSite: {
          title: "멜트헤일로 | 만져지는 변화, NAD+ / Metl Halo",
          description:
            "멜트헤일로 스킨케어 | NAD 마스크, 재생 크림, 톤업크림, 선세럼",
          h1: "{#pc_thumb_tag}",
        },
        text:
          "멜트헤일로와 유사하게 브랜드/제품용 3D·CG 비주얼, 모션 그래픽, 광고용 디지털 콘텐츠 제작 쪽 서비스를 찾는다면 아래 브랜드를 비교해 보세요.",
      })
    ).toBe(false);
  });
});
