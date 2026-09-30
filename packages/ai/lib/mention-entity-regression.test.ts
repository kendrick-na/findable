import { generateObject } from "ai";
import { afterEach, expect, it, vi } from "vitest";
import { __internal, verifyMention, verifyMentions } from "./mention-verdict";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(generateObject).mockReset();
});

it("rechecks raw answer text when an adapter forgot to set brandMentioned", async () => {
  // Live regression: Naver AI Briefing began with “멜트헤일로 …” but persisted
  // brandMentioned=false, making the public report show “모름”.
  vi.stubEnv("LETSUR_API_KEY", "test-key");
  vi.mocked(generateObject).mockResolvedValue({
    object: { quality: "confirmed" },
  } as never);

  const [verified] = await verifyMentions(
    [
      {
        brandMentioned: false,
        citedSources: [{ domain: "melthalo.com" }],
        errorMessage: null,
        isStub: false,
        rawResponse:
          "멜트헤일로의 공식 사이트 melthalo.com은 스킨케어 제품을 소개합니다.",
      },
    ],
    {
      brandName: "멜트헤일로",
      brandDomain: "melthalo.com",
      officialSite: { title: "멜트헤일로 스킨케어" },
    }
  );

  expect(verified).toMatchObject({
    brandMentioned: true,
    mentionQuality: "confirmed",
  });
});

it("confirms a Korean product answer with two official product descriptors", async () => {
  // Live regression: Naver AI Briefing named 멜트헤일로 and its product, but
  // the homepage identity gate discarded it because NAD and 마스크 are 3 chars.
  vi.stubEnv("LETSUR_API_KEY", "test-key");
  vi.mocked(generateObject).mockResolvedValue({
    object: { quality: "confirmed" },
  } as never);

  await expect(
    verifyMention({
      brandName: "멜트헤일로",
      brandDomain: "melthalo.com",
      stringMatched: true,
      officialSite: {
        description: "멜트헤일로 스킨케어 | NAD 마스크, 재생 크림, 톤업크림, 선세럼",
        title: "멜트헤일로 | 만져지는 변화, NAD+ / Metl Halo",
      },
      text: "멜트헤일로 PDRN 리쥬비네이팅 마스크팩은 NAD+ 성분을 담은 제품입니다.",
    })
  ).resolves.toMatchObject({ counted: true, quality: "confirmed" });
});

it("rejects a same-name creative studio even if the LLM initially says confirmed", async () => {
  // Live regression: the model called a 3D/CG studio "멜트헤일로". The
  // entity judge must not accept the mere spelling as recognition of the
  // registered skincare brand.
  vi.stubEnv("LETSUR_API_KEY", "test-key");
  vi.mocked(generateObject).mockResolvedValue({
    object: { quality: "confirmed" },
  } as never);

  await expect(
    verifyMention({
      brandName: "멜트헤일로",
      brandDomain: "melthalo.com",
      stringMatched: true,
      officialSite: {
        title: "멜트헤일로 | 만져지는 변화, NAD+ / Metl Halo",
        description:
          "멜트헤일로 스킨케어 | NAD 마스크, 재생 크림, 톤업크림, 선세럼",
        h1: "{#pc_thumb_tag}",
      },
      text:
        "멜트헤일로와 유사하게 브랜드/제품용 3D·CG 비주얼, 모션 그래픽, 광고용 디지털 콘텐츠 제작 쪽 서비스를 찾는다면 아래 브랜드를 비교해 보세요.",
    })
  ).resolves.toMatchObject({
    counted: false,
    quality: "unknown_brand",
    reason: "official_evidence_missing",
  });
});

it("does not mistake an official subdomain for a namesake", () => {
  expect(
    __internal.isOfficialDomain("product.example.com", "example.com")
  ).toBe(true);
  expect(__internal.isOfficialDomain("com", "example.com")).toBe(false);
  expect(
    __internal.mentionsOfficialDomain(
      "https://example.com.evil.test",
      "example.com"
    )
  ).toBe(false);
  expect(__internal.isOfficialDomain("co.uk", "product.example.co.uk")).toBe(
    false
  );
  expect(__internal.isOfficialDomain("github.io", "customer.github.io")).toBe(
    false
  );
  expect(
    __internal.isOfficialDomain("other.github.io", "customer.github.io")
  ).toBe(false);
});

it("rejects a namesake company supported only by its own domain", async () => {
  expect(
    await verifyMention({
      brandName: "TechDD",
      brandDomain: "dd.knowverse.net",
      stringMatched: true,
      text: "TechDD offers 2–3 week due diligence and board advisory services.",
      citedDomains: ["techdd.co.uk", "www.linkedin.com"],
      officialSite: { title: "TechDD", description: "폐쇄망 정량 기술실사" },
    })
  ).toMatchObject({ counted: false, quality: "different_entity" });
  expect(generateObject).not.toHaveBeenCalled();
});

it("rejects a romanized namesake domain for a Hangul brand", async () => {
  expect(
    await verifyMention({
      brandName: "인디고차일드",
      brandDomain: "indigochild.kr",
      stringMatched: true,
      text: "인디고차일드 is an English academy for young children.",
      citedDomains: ["www.indigochild.education", "www.amazingtalker.co.kr"],
      officialSite: {
        title: "Indigochild",
        description: "사람과 아이디어, 문화와 기술을 연결하는 마케팅 회사",
      },
    })
  ).toMatchObject({ counted: false, quality: "different_entity", via: "rule" });
  expect(generateObject).not.toHaveBeenCalled();
});

it("sends mixed official/namesake sources to the verifier instead of vetoing a correct answer", async () => {
  vi.stubEnv("LETSUR_API_KEY", "test-key");
  vi.mocked(generateObject).mockResolvedValue({
    object: { quality: "confirmed" },
  } as never);
  expect(
    await verifyMention({
      brandName: "TechDD",
      brandDomain: "dd.knowverse.net",
      stringMatched: true,
      officialSite: { title: "TechDD", description: "정량 기술 실사" },
      citedDomains: ["knowverse.net", "techdd.co.uk"],
      text: "노우버스(KNOWVERSE)의 TechDD는 AI 기술실사와 TechScan을 제공합니다.",
    })
  ).toMatchObject({ counted: true, quality: "confirmed", via: "llm" });
  expect(generateObject).toHaveBeenCalledOnce();
});

// 2026-09-28 — 판정기는 정상 작동했고 답변에 공식 사이트 고유 사실이 없다 = 「이
//   브랜드를 안다는 증거 없음」이라는 **판정 결과**다. 판정기 장애(unverified)와
//   섞으면 한 회차 전체가 잠정으로 떨어진다. 집계에서는 여전히 제외된다(counted=false).
it("treats an LLM 'confirmed' without official identity evidence as not this brand, not as a judge failure", async () => {
  vi.stubEnv("LETSUR_API_KEY", "test-key");
  vi.mocked(generateObject).mockResolvedValue({
    object: { quality: "confirmed" },
  } as never);
  expect(
    await verifyMention({
      brandName: "TechDD",
      brandDomain: "dd.knowverse.net",
      stringMatched: true,
      officialSite: { title: "TechDD", description: "정량 기술 실사" },
      text: "TechDD는 클라우드 인프라 구축과 시스템 통합 서비스를 제공합니다.",
    })
  ).toEqual({
    counted: false,
    quality: "unknown_brand",
    via: "llm",
    reason: "official_evidence_missing",
  });
});

it("does not use an incidental official search candidate to validate a foreign namesake", async () => {
  vi.stubEnv("LETSUR_API_KEY", "test-key");
  vi.mocked(generateObject).mockResolvedValue({
    object: { quality: "confirmed" },
  } as never);
  expect(
    await verifyMention({
      brandName: "TechDD",
      brandDomain: "dd.knowverse.net",
      stringMatched: true,
      officialSite: { title: "TechDD", description: "정량 기술 실사" },
      citedDomains: ["techdd.co.uk", "dd.knowverse.net"],
      text: "TechDD offers independent technology due diligence, board-level advisory and reports in 2–3 weeks.[1]",
    })
  ).toMatchObject({
    counted: false,
    quality: "unknown_brand",
    reason: "official_evidence_missing",
  });
});
