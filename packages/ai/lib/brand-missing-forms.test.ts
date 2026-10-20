import { describe, expect, it } from "vitest";
import {
  expandBrandVariants,
  guardQuestions,
  type PlanQuestion,
} from "./question-plan";

/**
 * `brand_missing`(이름 질문 전부 폐기)의 원인을 **코드 수준에서 확정**하는 표현 변형 시험(2026-10-19).
 * 진단은 「이름 표기가 어긋난다」를 추정만 했다 — 여기서 표기 유형별로 현재 검사가 통과시키는지 직접 센다.
 *  - 통과(이미): 띄어쓰기·대소문자·하이픈·도메인 라벨·별칭
 *  - 변형 허용 켜면 통과: 법인 꼬리표(주식회사·(주)·Corp.), 제목·H1 앞부분, 첫 낱말
 *  - 어떤 경우에도 불통: 번역·음역(Findable↔파인더블), 임의 약칭(한국전력공사→한전) → 고정 문형 보증이 받는다
 */
interface Case {
  /** 모델이 쓴 질문 속 표기. */
  asked: string;
  brandName: string;
  /** [변형 허용 꺼짐, 켜짐] 에서 이름 질문으로 통과하는가. */
  expect: [boolean, boolean];
  extraNames?: string[];
  label: string;
  sources?: (string | null)[];
}

const CASES: Case[] = [
  {
    label: "띄어쓰기",
    brandName: "토스 페이먼츠",
    asked: "토스페이먼츠 후기 어때?",
    expect: [true, true],
  },
  {
    label: "대소문자·하이픈",
    brandName: "Find-able",
    asked: "FINDABLE 후기 어때?",
    expect: [true, true],
  },
  {
    label: "도메인 라벨",
    brandName: "프란츠",
    extraNames: ["franz"],
    asked: "franz 후기 어때?",
    expect: [true, true],
  },
  {
    label: "법인명 (주)",
    brandName: "(주)코스맥스",
    asked: "코스맥스 후기 어때?",
    expect: [false, true],
  },
  {
    label: "법인명 주식회사",
    brandName: "주식회사 프란츠",
    asked: "프란츠 후기 어때?",
    expect: [false, true],
  },
  {
    label: "영문 법인 꼬리표",
    brandName: "Acme Corp.",
    asked: "Acme 후기 어때?",
    expect: [false, true],
  },
  {
    label: "코리아 꼬리표",
    brandName: "에이스 코리아",
    asked: "에이스 후기 어때?",
    expect: [false, true],
  },
  {
    label: "제목 앞부분",
    brandName: "Franz",
    sources: ["프란츠 | 스킨케어"],
    asked: "프란츠 후기 어때?",
    expect: [false, true],
  },
  {
    label: "H1 첫 낱말",
    brandName: "Franz",
    sources: ["프란츠 스킨케어 연구소"],
    asked: "프란츠 후기 어때?",
    expect: [false, true],
  },
  {
    label: "한글↔영문 음역",
    brandName: "Findable",
    asked: "파인더블 후기 어때?",
    expect: [false, false],
  },
  {
    label: "임의 약칭",
    brandName: "한국전력공사",
    asked: "한전 후기 어때?",
    expect: [false, false],
  },
];

const verdict = (c: Case, variantsOn: boolean): boolean => {
  const q: PlanQuestion = { language: "ko", text: c.asked, type: "brand" };
  const variants = expandBrandVariants([c.brandName, ...(c.sources ?? [])]);
  const out = guardQuestions([q], {
    brandNames: [c.brandName, ...(c.extraNames ?? [])],
    ...(variantsOn ? { brandVariants: variants } : {}),
    siteText: "",
  });
  return out.kept.length === 1;
};

describe("brand_missing 원인 확정 — 표기 유형별 통과 여부", () => {
  for (const c of CASES) {
    it(`${c.label}: 꺼짐 ${c.expect[0] ? "통과" : "폐기"} / 켜짐 ${c.expect[1] ? "통과" : "폐기"}`, () => {
      expect(verdict(c, false)).toBe(c.expect[0]);
      expect(verdict(c, true)).toBe(c.expect[1]);
    });
  }

  it("변형 허용은 이름 없는 질문 판정을 바꾸지 않는다(이름 없는 질문에 변형이 들어가도 예전과 같이 통과)", () => {
    const q: PlanQuestion = {
      language: "ko",
      text: "민감성 피부 크림 추천해줘",
      type: "category",
    };
    const variants = expandBrandVariants(["(주)프란츠"]);
    const base = { brandNames: ["(주)프란츠"], siteText: "" };
    expect(guardQuestions([q], base).kept).toHaveLength(1);
    expect(
      guardQuestions([q], { ...base, brandVariants: variants }).kept
    ).toHaveLength(1);
  });

  it("변형은 글자만 바꾼다 — 너무 짧거나 흔한 말은 만들지 않는다", () => {
    expect(expandBrandVariants(["(주)A", "Co."])).toEqual([]);
  });
});
