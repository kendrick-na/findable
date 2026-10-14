import { describe, expect, it } from "vitest";
import { findEngineName } from "./engine-names";

describe("findEngineName — 질문 속 AI 엔진 이름(오표기 포함)", () => {
  it("실제 사고 문장: '지메인이나 클로드 같은 …'", () => {
    expect(
      findEngineName(
        "지메인이나 클로드 같은 다양한 AI 모델에서 우리 브랜드가 나와?"
      )
    ).not.toBeNull();
  });

  it.each([
    "챗GPT에서 추천해줘",
    "ChatGPT 말고 뭐 있어?",
    "제미나이는 뭐라고 해?",
    "퍼플렉시티에 물어보면?",
    "Claude가 추천하는 곳",
    "제미니에서는 어때?",
    "지매니 같은 AI",
    "네이버에서 1위인 곳",
  ])("엔진명이 있으면 찾는다: %s", (text) => {
    expect(findEngineName(text)).not.toBeNull();
  });

  it.each([
    "민감성 피부 보습 크림 추천해줘",
    "B2B 소프트웨어 도입 전에 뭘 봐야 해?",
    "고객 관리 도구 가격은 어때?",
    "What should I look for when choosing B2B software?",
    "아이 간식 뭐가 좋아?",
    "다음 주에 배송돼?",
    "클라우드 서비스 보안은 어때?",
  ])("정상 질문은 건드리지 않는다: %s", (text) => {
    expect(findEngineName(text)).toBeNull();
  });
});
