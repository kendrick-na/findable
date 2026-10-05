import { generateObject } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  detectAmbiguity,
  hasRivalDomain,
  isSiblingDomainCandidate,
  verifyMentionV3,
} from "./mention-verdict-v3";

vi.mock("ai", () => ({ generateObject: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(generateObject).mockReset();
});

// 실측 원문(2026-10-05 AuditJob 4408fe00, 프란츠 / franzskincare.com)에서 판정에 쓰인 구절만 옮겼다.
const FRANZ = {
  brandName: "프란츠",
  brandVariants: ["Franz", "franzskincare"],
  brandDomain: "franzskincare.com",
  industry: "beauty",
  officialSite: {
    title: "프란츠 스킨케어 FRANZ SKINCARE",
    siteName: "프란츠 스킨케어",
    description: null,
    h1: null,
    legalName: "바이오센서연구소(주)",
  },
};

const GEMINI_RECOMMEND =
  '"프란츠"라는 이름의 서비스나 브랜드가 여러 가지가 있어 어떤 프란츠를 말씀하시는지 명확하지 않습니다. 현재 확인되는 "프란츠" 관련 서비스는 다음과 같습니다.\n1. **프란츠 (출판 및 복합문화공간):** 음악과 예술 관련 서적\n2. **Franz (데스크톱 앱):** WhatsApp, Slack';
const GEMINI_ABOUT =
  "'프란츠'는 두 가지 주요 브랜드로 확인됩니다. 하나는 스킨케어 브랜드이며, 다른 하나는 출판 및 문화 콘텐츠 브랜드입니다.\n**1. 프란츠 스킨케어 (FRANZ Skincare)**\n* 서울대학교 출신 연구원들이 설립한 바이오센서연구소가 2017년에 론칭한 뷰티 브랜드입니다.";
const PERPLEXITY_ABOUT =
  "‘프란츠’라는 이름은 **음악 브랜드**와 **스킨케어 브랜드**가 모두 사용합니다. 질문하신 브랜드가 어느 쪽인지에 따라 제공하는 것이 다릅니다.\n- **뷰티 브랜드 프란츠**: 바이오센서연구소가 운영하는 코스메틱 브랜드로";
const CHATGPT_ABOUT =
  "“프란츠”는 문맥에 따라 여러 브랜드를 가리킬 수 있어서, 먼저 어떤 **프란츠**를 말씀하시는지 확인이 필요합니다.\n1. **FRANZ(프란츠)** — 뷰티/헬스케어 계열 브랜드\n2. **Franz(프란츠)** — 도자기/테이블웨어 브랜드";
const CLAUDE_ABOUT =
  "## 프란츠(FRANZ) 브랜드 소개\n프란츠(FRANZ)는 **한국의 프리미엄 스킨케어 브랜드**입니다.\n바이오센서연구소(주)는 서울대학교 출신 연구원들이 설립하여 2017년 프란츠 스킨케어 브랜드를 론칭하였습니다.";
const CHATGPT_EN_APP =
  "If you mean **Franz** the messaging/workspace aggregator app, the main alternatives are:\n1. **Rambox** — Often seen as the closest direct competitor";

describe("판정 v3 — 여러 동명 대상을 나열하거나 되묻는 답변", () => {
  it.each([
    ["Gemini 추천 질문", GEMINI_RECOMMEND],
    ["Gemini 소개 질문(우리 회사가 목록 첫 줄)", GEMINI_ABOUT],
    ["Perplexity 소개 질문", PERPLEXITY_ABOUT],
    ["ChatGPT 되물음", CHATGPT_ABOUT],
  ])("%s 은 ambiguous 로 규칙 판정한다", async (_label, text) => {
    expect(detectAmbiguity(text)).toBe(true);
    expect(
      await verifyMentionV3({ ...FRANZ, text, stringMatched: true })
    ).toEqual({
      counted: false,
      quality: "ambiguous",
      reason: "clarification",
      via: "rule",
    });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("대상을 하나로 특정한 답변과 한쪽을 골라 설명한 답변은 규칙으로 잡지 않는다", () => {
    expect(detectAmbiguity(CLAUDE_ABOUT)).toBe(false);
    expect(detectAmbiguity(CHATGPT_EN_APP)).toBe(false);
  });
});

describe("판정 v3 — 형제 도메인과 동명 타사 도메인", () => {
  it("공식 도메인 이름으로 시작하는 해외몰 도메인은 다른 회사로 확정하지 않는다", () => {
    expect(
      isSiblingDomainCandidate("franzskincareusa.com", "franzskincare.com")
    ).toBe(true);
    expect(
      hasRivalDomain({
        ...FRANZ,
        text: "",
        citedDomains: ["franzskincareusa.com"],
      })
    ).toBe(false);
  });

  it("이름을 품은 무관한 도메인은 동명 타사 근거다", () => {
    expect(
      hasRivalDomain({
        brandName: "Findable",
        brandDomain: "findable.co.kr",
        text: "",
        citedDomains: ["findableapp.com"],
      })
    ).toBe(true);
  });
});

describe("판정 v3 — 판정기와 공식 근거", () => {
  it("상호(법인명)가 답변에 있으면 판정기의 confirmed 를 근거 있는 것으로 받는다", async () => {
    vi.stubEnv("LETSUR_API_KEY", "test-key");
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: { quality: "confirmed", evidence: "바이오센서연구소(주)는" },
    } as never);
    expect(
      await verifyMentionV3({
        ...FRANZ,
        text: CLAUDE_ABOUT,
        stringMatched: true,
      })
    ).toMatchObject({ counted: true, quality: "confirmed", via: "llm" });
  });

  it("공식 사실이 하나도 없는 confirmed 는 unknown_brand 로 내린다", async () => {
    vi.stubEnv("LETSUR_API_KEY", "test-key");
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: { quality: "confirmed", evidence: "프란츠는 좋은 브랜드" },
    } as never);
    expect(
      await verifyMentionV3({
        ...FRANZ,
        text: "프란츠는 많은 사람들이 좋아하는 좋은 브랜드입니다.",
        stringMatched: true,
      })
    ).toMatchObject({
      counted: false,
      quality: "unknown_brand",
      reason: "official_evidence_missing",
    });
  });

  it("한쪽(다른 대상)을 골라 설명한 답변은 판정기 결과를 그대로 쓴다", async () => {
    vi.stubEnv("LETSUR_API_KEY", "test-key");
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: {
        quality: "different_entity",
        evidence: "Franz the messaging/workspace aggregator app",
      },
    } as never);
    expect(
      await verifyMentionV3({
        ...FRANZ,
        text: CHATGPT_EN_APP,
        stringMatched: true,
      })
    ).toMatchObject({
      counted: false,
      quality: "different_entity",
      via: "llm",
    });
  });

  it("판정기가 실패하면 unverified(judge_failed)", async () => {
    vi.stubEnv("LETSUR_API_KEY", "test-key");
    vi.mocked(generateObject).mockRejectedValueOnce(new Error("boom"));
    expect(
      await verifyMentionV3({
        ...FRANZ,
        text: CLAUDE_ABOUT,
        stringMatched: true,
      })
    ).toEqual({
      counted: false,
      quality: "unverified",
      reason: "judge_failed",
      via: "skipped",
    });
  });
});
