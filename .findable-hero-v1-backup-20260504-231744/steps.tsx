// Findable 4단계 진행 인디케이터 — D-037 Adaline 패턴 카피
// Server: 정적 콘텐츠 + sticky 마커 / Client: IntersectionObserver

import type { Dictionary } from "@repo/internationalization";
import { StepsClient } from "./steps-client";

const STEPS = [
  {
    num: "01",
    ko: "측정",
    en: "Measure",
    title: "도메인 입력 한 번으로 7개 AI 엔진을 동시에",
    body: "ChatGPT · HyperCLOVA · Perplexity · 네이버 · Claude · 다음 · Gemini를 병렬 호출합니다. 평균 25초 안에 한국어와 영어 답변을 모두 수집합니다.",
    bullets: [
      "글로벌 4 + 한국 3 = 7개 엔진 동시 호출",
      "Princeton GEO-Bench 산식 기반 SoV 정직 산정 (89% 검증)",
      "Korean Entity Grounding으로 브랜드 표기 변형 통합",
    ],
  },
  {
    num: "02",
    ko: "분석",
    en: "Analyze",
    title: "한국어 변형까지 빠짐없이 추적하는 Korean Entity Grounding",
    body: "아모레 / Amorepacific / 아모레퍼시픽 — 같은 브랜드의 한국어·영어·혼용 표기를 자동 통합합니다. 글로벌 어떤 GEO 도구도 못 잡는 한국 모트입니다.",
    bullets: [
      "Citation Source URL 단위 인용 도메인 메트릭",
      "5축 점수: Citation 30 · Sentiment 30 · Position 20 · Trend 10 · Korean 10",
      "산업별 자동 분류 (K-뷰티 / D2C / B2B / F500 한국 지사)",
    ],
  },
  {
    num: "03",
    ko: "추천",
    en: "Recommend",
    title: "Princeton KDD'24 GEO 8 strategies로 다음 액션을 안내",
    body: "Cite Sources · Quotation · Statistics 3개 전략으로 가시성 +40% 검증된 학술 기반 룰셋. 추측이 아닌 증거 기반 액션 카드를 제공합니다.",
    bullets: [
      "Top 3 Action Card — 우선순위·예상 효과·구현 난이도",
      "산업별 K-뷰티 D2C / 외국 한국지사 / 내수 D2C 맞춤 가이드",
      "월간 자동 리포트 (Notion · Google Docs Export)",
    ],
  },
  {
    num: "04",
    ko: "행동",
    en: "Act",
    title: "Cafe24 · 네이버 스마트스토어 · WordPress 원클릭 발행",
    body: "v1.5 — 인사이트로 끝나지 않습니다. AI가 답하는 콘텐츠를 직접 CMS에 발행해 인용 가능성을 즉시 강화합니다.",
    bullets: [
      "AirOps 패턴 채택 — Greylock $40M 베팅 검증",
      "Brand Guardrails 감사 (K-뷰티 톤앤매너)",
      "Agentic Commerce — AI 답변 → 구매 트래킹 (Shopify · Cafe24)",
    ],
  },
];

interface StepsProps {
  dictionary?: Dictionary;
}

export const Steps = ({ dictionary: _dictionary }: StepsProps) => {
  return (
    <section className="bg-[color:var(--findable-mist-50)] text-[color:var(--findable-sumi-900)]">
      <StepsClient steps={STEPS} />
    </section>
  );
};
