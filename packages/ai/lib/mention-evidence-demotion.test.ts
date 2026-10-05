import { generateObject } from "ai";
import { afterEach, expect, it, vi } from "vitest";

import { canDemandOfficialEvidence, verifyMention } from "./mention-verdict";

vi.mock("ai", () => ({ generateObject: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(generateObject).mockReset();
});

const judgeSays = (quality: string) => {
  vi.stubEnv("LETSUR_API_KEY", "test-key");
  vi.mocked(generateObject).mockResolvedValue({ object: { quality } } as never);
};

// 2026-10-06 운영 실측(컨트롤타워): 정답인데 「공식 근거 없음」으로 강등된 답변들.
const DAANGN = {
  brandName: "당근",
  brandVariants: ["당근마켓", "Daangn"],
  brandDomain: "daangn.com",
  stringMatched: true,
  officialSite: {
    title: "당근 - 당신 근처의 당근",
    description:
      "중고 거래부터 동네 정보까지, 이웃과 함께해요. 가깝고 따뜻한 당신의 근처를 만들어요.",
    h1: null,
  },
};

it("counts a correct slogan-site answer through 2-character nouns (daangn)", async () => {
  judgeSays("confirmed");
  expect(
    await verifyMention({
      ...DAANGN,
      text: "당근은 중고거래와 동네생활 정보를 나누는 지역 기반 플랫폼입니다.",
    })
  ).toMatchObject({ counted: true, quality: "confirmed" });
});

it("accepts a longer official alias that contains the brand name as an anchor", async () => {
  judgeSays("confirmed");
  expect(
    await verifyMention({
      ...DAANGN,
      text: "당근(구 당근마켓): 지역 기반 직거래 서비스",
    })
  ).toMatchObject({ counted: true, quality: "confirmed" });
});

it("does not demote when the homepage could not be read (musinsa REDIRECT_FAILED)", async () => {
  judgeSays("confirmed");
  const input = {
    brandName: "무신사",
    brandDomain: "musinsa.com",
    stringMatched: true,
    officialSite: { title: null, description: null, h1: null },
    text: "무신사는 국내 최대 패션 온라인 플랫폼입니다.",
  };
  expect(canDemandOfficialEvidence(input)).toBe(false);
  expect(await verifyMention(input)).toMatchObject({
    counted: true,
    quality: "confirmed",
  });
});

it("accepts the footer legal name as evidence (toss)", async () => {
  judgeSays("confirmed");
  expect(
    await verifyMention({
      brandName: "토스",
      brandDomain: "toss.im",
      stringMatched: true,
      officialSite: {
        title: "토스",
        description: "금융부터 일상까지 마침내 토스 하나로.",
        h1: null,
        legalName: "(주)비바리퍼블리카",
      },
      text: "토스는 비바리퍼블리카가 운영하는 간편송금·금융 플랫폼입니다.",
    })
  ).toMatchObject({ counted: true, quality: "confirmed" });
});

it("still demotes a namesake answer on a thin profile with a legal name", async () => {
  judgeSays("confirmed");
  expect(
    await verifyMention({
      brandName: "토스",
      brandDomain: "toss.im",
      stringMatched: true,
      officialSite: {
        title: "토스",
        description: "금융부터 일상까지 마침내 토스 하나로.",
        h1: null,
        legalName: "(주)비바리퍼블리카",
      },
      text: "토스는 배구에서 공을 띄워 올려 주는 기술을 말합니다.",
    })
  ).toMatchObject({
    counted: false,
    quality: "unknown_brand",
    reason: "official_evidence_missing",
  });
});
