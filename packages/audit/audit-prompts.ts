import { conjunctionParticle, topicParticle } from "./actions";

/** 질문 언어별로 넣을 브랜드 표기. en 은 공식 로마자 표기가 없으면 ko 와 같다. */
export interface PromptBrandNames {
  en: string;
  ko: string;
}

/**
 * 도메인 + 언어 기반 자동 프롬프트 생성 — 무료 Audit 빠른 모드용 6개.
 * v1.0.5 풀 모드는 30~50개로 확장.
 */
export function generateAuditPrompts(
  names: PromptBrandNames,
  language: "ko" | "en" | "both"
): Array<{ text: string; lang: "ko" | "en" }> {
  const brandName = names.ko;
  // 영어 질문에 한글 이름을 넣으면("What does 노우버스 offer") 영어권 AI는 그 표기를
  //   거의 모른다 — 시장 격차가 아니라 질문 설계 결함이다(2026-09-28). 공식 로마자
  //   표기가 있으면 그것으로 묻는다. 없으면 기존처럼 대표명.
  const englishName = names.en;
  // 프롬프트는 두 유형을 균형 있게 섞는다 (P0-a, 2026-07-27):
  //   - 브랜드형: 브랜드 자체를 물어 "AI가 이 브랜드를 아는가/제대로 서술하는가"
  //     (노출·팩트정합·감성) 측정. ⚠️ 이게 없으면 판정(문자열 매칭)이 구조적으로
  //     미언급을 유발함 (경쟁사 나열 답변엔 본인이 잘 안 담김).
  //   - 경쟁사형: 경쟁 대비 순위·SoV 측정 (estimateMentionPosition·경쟁벤치가 의존).
  // 각 배열은 [브랜드형, 브랜드형, 경쟁사형, 경쟁사형] 순 — both 모드가 slice로
  // 앞 2개(브랜드형)+뒤로 경쟁사형을 뽑아도 유형이 섞이도록 배치.
  const ko = [
    `${brandName}${topicParticle(brandName)} 어떤 브랜드이고 어떤 서비스를 제공해?`,
    `${brandName}의 주요 강점과 한계는?`,
    `${brandName}${conjunctionParticle(brandName)} 비슷한 서비스를 제공하는 브랜드 5곳 추천해줘`,
    `${brandName}의 주요 경쟁사를 비교해줘`,
  ];
  // ⚠️ 2026-08-02 F7 — 한/영 프롬프트를 **의미 등가**로 맞춘다.
  //   기존 en[0] = "What is X? Is it worth buying?" 는 ko[0] "X 추천해줘" 와 질문이 달랐다:
  //     ko[0] = X 를 **전제**하고 추천 요청 → 언급 판정에 유리
  //     en[0] = X 가 뭔지 묻는 **개방형** → 모르면 "I'm not familiar with..." → unknown_brand 판정
  //   그리고 both 모드가 뽑는 게 정확히 [ko[0], ko[2], en[0], en[2]] 라 이 비대칭이
  //   그대로 점수에 들어갔다. 즉 한/영 언급률 차이의 일부가 **시장 격차가 아니라 프롬프트 설계 차이**였다.
  //   추가로 "Is it worth buying?" 는 구매 가능한 소비재를 전제해 B2B·병원·반도체엔 무의미하고,
  //   부정 톤 답변이 감성 점수를 왜곡할 수 있었다(업종 편향과 같은 뿌리).
  const en = [
    `What does ${englishName} offer, and who is it for?`,
    `What are the main strengths and limitations of ${englishName}?`,
    `Top alternatives to ${englishName} and how they differ`,
    `Compare the main competitors of ${englishName}`,
  ];

  if (language === "ko") {
    return ko.map((text) => ({ text, lang: "ko" as const }));
  }
  if (language === "en") {
    return en.map((text) => ({ text, lang: "en" as const }));
  }
  // both 모드: 각 언어에서 브랜드형 1 + 경쟁사형 1 → 총 브랜드형 2 + 경쟁사형 2.
  // ko[0]=브랜드형, ko[2]=경쟁사형 / en[0]=브랜드형, en[2]=경쟁사형.
  return [
    { text: ko[0] as string, lang: "ko" as const },
    { text: ko[2] as string, lang: "ko" as const },
    { text: en[0] as string, lang: "en" as const },
    { text: en[2] as string, lang: "en" as const },
  ];
}
