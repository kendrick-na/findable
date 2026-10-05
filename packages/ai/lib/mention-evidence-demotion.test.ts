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

// 공식 프로필은 운영 DB 의 최신 측정(2026-10-06)에서 그대로 옮겼다.
const DAANGN = {
  brandName: "당근",
  brandVariants: ["당근마켓", "Daangn"],
  brandDomain: "daangn.com",
  stringMatched: true,
  officialSite: {
    title: "당신 근처의 당근",
    description:
      "중고 거래부터 동네 정보까지, 이웃과 함께해요. 가깝고 따뜻한 당신의 근처를 만들어요.",
    h1: "당신 근처의 당근",
    legalName: "당근마켓(주)",
  },
};
const TOSS_SITE = {
  title: "토스",
  description: "금융부터 일상까지 마침내 토스 하나로.",
  h1: null,
  legalName: "(주)비바리퍼블리카",
};
const KNOWVERSE_SITE = {
  title: "노우버스 | AI 전략 · CTO 구독 · 기술실사 · AI 교육",
  description:
    "노우버스는 AI 기술실사, CTO 구독, AI 강의, AI 도구와 온라인 교육으로 기업의 기술 의사결정과 AI 전환을 지원합니다.",
  h1: "노우버스 — AI 기술실사(TechDD), CTO 구독, AX/DX 컨설팅, AI 강의·교육, AI 도구",
};
const INDIGO_SITE = {
  title: "Indigochild",
  description:
    "인디고차일드는 사람과 아이디어, 문화와 기술을 연결합니다. 창의성과 전략을 바탕으로, 브랜드와 커뮤니티가 함께 성장하는 미래를 만들겠습니다.",
  h1: "We Create the Future",
};

// 2026-10-06 운영 실측: 정답인데 「공식 근거 없음」으로 강등되던 답변.
it("counts a correct answer anchored by the official alias / legal name (daangn)", async () => {
  judgeSays("confirmed");
  expect(
    await verifyMention({
      ...DAANGN,
      text: "당근(구 당근마켓): 중고거래·동네생활 플랫폼",
    })
  ).toMatchObject({ counted: true, quality: "confirmed" });
});

it("accepts the footer legal name as evidence (toss)", async () => {
  judgeSays("confirmed");
  expect(
    await verifyMention({
      brandName: "토스",
      brandDomain: "toss.im",
      stringMatched: true,
      officialSite: TOSS_SITE,
      text: "토스는 비바리퍼블리카가 운영하는 간편송금·금융 플랫폼입니다.",
    })
  ).toMatchObject({ counted: true, quality: "confirmed" });
});

it("trusts the judge when the homepage could not be read, and flags it (musinsa)", async () => {
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
    officialProfileUnavailable: true,
  });
});

// 컨트롤타워 속임수 사례(2026-10-06): 업종 일반명사로 통과하면 안 되는 동명 타사 답변.
it.each([
  [
    "A 토스 · 독일 결제 단말기",
    { brandName: "토스", brandDomain: "toss.im", officialSite: TOSS_SITE },
    "토스는 독일 베를린의 결제 단말기 스타트업으로, 결제와 송금 기능을 제공합니다.",
  ],
  [
    "E 토스 · 영국 결제대행",
    { brandName: "토스", brandDomain: "toss.im", officialSite: TOSS_SITE },
    "토스는 영국 금융권 대상 결제대행 소프트웨어 회사입니다.",
  ],
  [
    "B 노우버스 · 미국 교육 플랫폼",
    {
      brandName: "노우버스",
      brandDomain: "knowverse.net",
      officialSite: KNOWVERSE_SITE,
    },
    "노우버스는 미국 온라인 교육 플랫폼으로 강의 영상과 학습 도구를 월 구독으로 제공합니다.",
  ],
  [
    "C 인디고차일드 · LA 음악 레이블",
    {
      brandName: "인디고차일드",
      brandDomain: "indigochild.kr",
      officialSite: INDIGO_SITE,
    },
    "인디고차일드는 LA 인디 음악 레이블로 힙합 문화와 미래 세대 커뮤니티를 다룹니다.",
  ],
])("still demotes the namesake case %s", async (_label, brand, text) => {
  judgeSays("confirmed");
  expect(
    await verifyMention({ ...brand, stringMatched: true, text })
  ).toMatchObject({
    counted: false,
    quality: "unknown_brand",
    reason: "official_evidence_missing",
  });
});
