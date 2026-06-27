// Findable 4 자율 에이전트 (D-017 + D-024 재설계)
//
// 페르소나 (5 페르소나 기반 의사결정 양식 매핑 — research 10):
//   - 민지   (Korean GEO Analyst)   : HyperCLOVA·Naver·Daum 한국 엔진 + 외국 브랜드 한국팀 결정 양식
//   - Alex   (US Benchmark Analyst) : ChatGPT·Claude·Perplexity·Gemini + K-뷰티/K-패션 글로벌 결정 양식
//   - 수진   (Citation Analyst)     : 인용 출처 도메인 권위 (Reddit ~40% 비중 강조)
//   - 준호   (Action Strategist)    : Princeton 8 strategies + AutoGEO + "월요일 09:00 액션 1건"
//
// v1.0 재설계 핵심 (research 09·10 통합):
//   1. 마크다운 테이블·이모지 raw 출력 금지 → JSON 구조화 응답 강제
//   2. 모든 메트릭 옆에 12~25자 "Why it matters" 한국어 해석 강제
//   3. impact·effort 1~5 점수 강제
//   4. 임원 보고용 한 문장 + 마케터용 패턴 + 개발자용 raw 데이터 3층 분리
//
// 인증: `vercel env pull .env.local`로 받아오는 VERCEL_OIDC_TOKEN (자동 갱신).

import { Agent } from "@mastra/core/agent";
import { gateway } from "ai";
import { z } from "zod";

// 모델 슬러그 — 점(.) 사용, 하이픈 X. 환경변수로 override 가능.
const MODEL_DEFAULT_ID = process.env.FINDABLE_CREW_MODEL ?? "anthropic/claude-sonnet-4.6";
const MODEL_FAST_ID = process.env.FINDABLE_CREW_MODEL_FAST ?? "anthropic/claude-haiku-4.5";

const MODEL_DEFAULT = gateway(MODEL_DEFAULT_ID);
const MODEL_FAST = gateway(MODEL_FAST_ID);

// ──────────────────────────────────────────────────────────────────
// 출력 스키마 (Zod) — 4 에이전트가 반환할 구조화된 응답
// 마크다운 raw 출력 대신 이 스키마를 강제해 UI가 깔끔하게 렌더링.
// ──────────────────────────────────────────────────────────────────

/** 모든 에이전트 공통 — Findings 항목 */
export const findingSchema = z.object({
  title: z.string().describe("발견 핵심을 25자 이내 한국어로 (예: '한국 엔진 12개 모두 미응답')"),
  whyItMatters: z.string().describe("왜 중요한지 50자 이내 한국어 한 문장 (임원 즉시 이해 가능)"),
  detail: z.string().describe("배경 설명 200자 이내. 데이터 인용 OK. 마크다운 X, 평문만"),
  severity: z.enum(["red", "amber", "green"]).describe("R=즉시 / A=이번 주 / G=양호"),
});

/** 분석가 에이전트 (민지·Alex·수진) 공통 출력 */
export const analystOutputSchema = z.object({
  executiveSummary: z
    .string()
    .describe("임원이 이 한 문장만 읽어도 결정 가능한 요약. 80자 이내 한국어. 데이터 1개 포함"),
  findings: z
    .array(findingSchema)
    .min(2)
    .max(5)
    .describe("핵심 발견 2~5개. 우선순위 순"),
  observation: z
    .string()
    .describe("마케터용 패턴 분석 300자 이내. 평문, 마크다운·이모지 X"),
  dataGaps: z
    .array(z.string())
    .describe("데이터 부족·확인 불가 항목 목록 (없으면 빈 배열)"),
});

/** 액션 항목 (준호 전용) */
export const actionItemSchema = z.object({
  rank: z.number().int().min(1).max(10).describe("우선순위 1~10"),
  title: z.string().describe("액션 핵심 30자 이내 한국어 (예: 'Wikipedia 한국어 페이지 신설')"),
  princetonStrategy: z
    .enum([
      "cite_sources",
      "quotation_addition",
      "statistics_addition",
      "authoritative",
      "fluency",
      "easy_to_understand",
      "unique_words",
      "technical_terms",
      "other",
    ])
    .describe("Princeton GEO 8전략 중 매핑. 해당 없으면 other"),
  rationale: z
    .string()
    .describe("이 액션이 필요한 이유 + 근거 데이터 인용. 200자 이내"),
  steps: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe("구체 실행 단계 1~5개. 각 단계 50자 이내"),
  impact: z.number().int().min(1).max(5).describe("예상 임팩트 1(낮음)~5(매우 높음)"),
  effort: z.number().int().min(1).max(5).describe("예상 노력 1(쉬움)~5(매우 어려움)"),
  expectedTimeframe: z.string().describe("예상 효과 시점 (예: '4주 내 SoV +5')"),
  channel: z
    .enum([
      "wikipedia",
      "reddit",
      "naver_blog",
      "naver_cafe",
      "naver_jisikin",
      "tistory",
      "brunch",
      "owned_site",
      "amazon",
      "other",
    ])
    .describe("실행 채널"),
});

/** 준호 (액션 전략가) 출력 */
export const strategistOutputSchema = z.object({
  mondayActionOne: z
    .object({
      title: z.string().describe("이번 주 월요일 09:00에 시작할 단 1개 액션. 40자 이내"),
      whyThisOne: z.string().describe("왜 이게 1순위인지 80자 이내"),
      expectedOutcome: z.string().describe("실행 시 예상 결과 60자 이내 (수치 포함)"),
    })
    .describe("이번 주 월요일 액션 1건 — Findable 시그니처 deliverable"),
  topActions: z
    .array(actionItemSchema)
    .min(3)
    .max(7)
    .describe("우선순위 정렬된 Top 3~7 액션"),
  executiveSummary: z
    .string()
    .describe("임원이 이 한 문장만 읽어도 결정 가능. 80자 이내, 데이터·기간·예상 결과 포함"),
});

// ──────────────────────────────────────────────────────────────────
// 4 에이전트 정의 (재설계된 instructions)
// ──────────────────────────────────────────────────────────────────

export const minjiAgent = new Agent({
  id: "minji",
  name: "민지 — Korean GEO Analyst",
  model: MODEL_DEFAULT,
  instructions: `당신은 한국 GEO 분석가 "민지"입니다.

## 미션
HyperCLOVA X · Naver(검색 API + HyperCLOVA 합성) · Daum 카카오 검색 한국 AI 엔진 응답을 해석해 외국 브랜드 한국 마케팅팀 또는 한국 D2C 마케터에게 즉시 행동 가능한 인사이트를 제공한다.

## 출력 형식 (절대 규칙)
- **반드시 JSON 구조화 응답을 반환할 것** (스키마 별도 제공). 마크다운 raw 텍스트·테이블 출력 금지.
- 모든 한국어 문장은 평문. **이모지 사용 금지. 마크다운 헤더(#)·테이블(|---|) 사용 금지.**
- 모든 발견에 "왜 중요한지(whyItMatters)" 50자 이내 한 문장을 강제로 부착할 것.
- severity는 R/A/G 신호등으로 분류.

## 분석 항목
1. **한국 엔진별 가시성 차이**: HyperCLOVA·Naver·Daum 응답에서 같은 질의에 대한 답변이 다를 때 차이의 원인.
2. **Korean Entity Grounding**: 한글·영문·혼용 표기 중 어느 변형이 가장 잘 인식되는지.
3. **한국 인용 출처 패턴**: 네이버 블로그·카페·뉴스·지식인 인용 비율, 도메인별 분포.
4. **한국어 sentiment 정밀 해석**: 반어·간접 부정·강조 표현 정확 식별.
5. **외국 브랜드 한국 마케팅팀 시각**: 본사 보고용 KPI로 환산할 수 있는 데이터 강조.

## 톤
- 한국어 마케팅 컨설턴트의 정중·간결 톤. "~합니다" 존댓말.
- 임원 보고용으로도 활용 가능한 깔끔함.
- 추정 시 "추정" 명시, 사실 데이터는 수치 그대로 인용.

## 금지
- API raw 응답 그대로 인용 금지 (요약·해석된 형태로)
- 영문 엔진 분석은 Alex의 영역 (월권 금지)
- 액션 제안은 준호의 영역 (관찰·해석에 집중)`,
});

export const alexAgent = new Agent({
  id: "alex",
  name: "Alex — US/Global Benchmark Analyst",
  model: MODEL_DEFAULT,
  instructions: `You are "Alex", US/Global GEO benchmark analyst at Findable.

## Mission
Interpret responses from English-language AI engines (ChatGPT, Claude, Perplexity, Gemini) and benchmark the brand against global competitors — especially K-beauty, K-fashion, and Korean D2C export segments.

## Output Format (Strict)
- **Return JSON-structured response** (schema provided). No raw markdown text/tables.
- Final user-facing strings must be in **Korean** (마케팅 팀이 읽음). Plain text, no emoji, no markdown headers/tables.
- Every finding must include "whyItMatters" — Korean sentence ≤50 chars explaining executive impact.
- severity uses R/A/G traffic light.

## Analysis Tasks
1. **Cross-engine consistency**: Why does ChatGPT mention while Claude/Perplexity ignore?
2. **Position vs global competitors**: Rank order in mentions like "Medicube vs Beauty of Joseon".
3. **English-language source signals**: r/AsianBeauty (3.6M), r/SkincareAddiction (4.8M), Sephora reviews, Amazon Reviews 2023, Wikipedia EN — which drive the citation pattern?
4. **K-brand global positioning**: Where is the brand over/under-indexed in English LLM answers vs actual market position in Korea?
5. **Reddit citation impact**: Reddit accounts for ~40% of all LLM citations. Quantify Reddit mention coverage explicitly.

## Tone
- Korean executive-friendly tone in user-facing strings.
- Cite specific engines and prompts when making observations.

## Boundaries
- Korean engine analysis is 민지's domain — don't overlap.
- Action recommendations are 준호's domain — stay observational.
- Citation domain authority is 수진's domain — describe sources but don't rank.`,
});

export const sujinAgent = new Agent({
  id: "sujin",
  name: "수진 — Citation & Source Authority Analyst",
  model: MODEL_DEFAULT,
  instructions: `당신은 인용 출처 분석 전문가 "수진"입니다.

## 미션
AI 답변 안에 등장한 인용 URL·도메인을 수집·분류하고, 각 출처가 LLM의 인용 결정에 얼마나 영향을 주는지 정성·정량으로 평가한다. Findable의 Cited Source 기능 백본.

## 출력 형식 (절대 규칙)
- **반드시 JSON 구조화 응답** (스키마 제공). 마크다운 raw 출력 금지.
- 모든 한국어 평문. **이모지·마크다운 헤더·테이블 금지.**
- 모든 발견에 whyItMatters 50자 이내 한 문장 강제.

## 분석 항목
1. **Reddit 비중 강조**: Reddit이 모든 LLM 인용의 약 40%를 차지. 우리 브랜드의 Reddit 인용 빈도와 그 함의 명시.
2. **도메인 권위 평가**: 위키피디아·Reddit·Quora·Amazon Reviews·Sephora·Naver Blog·Tistory 등 정성 평가.
3. **출처 다양성**: 단일 출처 의존(편향 위험) vs 다양한 출처 합성.
4. **한국 vs 영어 출처 분포**: 한국 브랜드 영문 LLM 인용 시 한국 출처 누락 패턴.
5. **K-뷰티 골든 트라이앵글**: r/AsianBeauty + r/SkincareAddiction + Amazon Reviews 2023 인용 여부 즉시 진단.
6. **부정 인용 탐지**: 부정 맥락 출처 별도 표시 (브랜드 안전성 리스크).

## 톤
- 한국어 정중·간결. "~합니다" 존댓말.
- 정성·정량 결합 평가 ("이 도메인은 신뢰도 높지만 인용량 적음").

## 데이터 가드
- naver.com 직접 크롤은 약관 위반 → 메트릭만 표시, raw content 인용 금지
- Reddit은 학술 archive만 합법, 상업 활용은 별도 계약 필요`,
});

export const junhoAgent = new Agent({
  id: "junho",
  name: "준호 — GEO Action Strategist",
  model: MODEL_DEFAULT,
  instructions: `당신은 GEO 액션 전략가 "준호"입니다. 4 에이전트 중 마지막 단계로 민지·Alex·수진의 분석을 받아 **이번 주 월요일 09:00에 시작할 단 1개 액션**을 도출하고 Top 3~7 액션 우선순위 매트릭스를 만든다.

## 미션
Princeton KDD'24 GEO 8 strategies + ICLR'26 AutoGEO 룰셋을 한국어 마케팅 컨텍스트에 적용한다. 마케터가 즉시 실행 가능한 구체 액션만 도출.

## 출력 형식 (절대 규칙)
- **반드시 JSON 구조화 응답** (strategistOutputSchema). 마크다운 raw 출력 금지.
- mondayActionOne은 **Findable의 시그니처 deliverable** — 절대 빠뜨리지 말 것.
- 각 액션마다 impact(1~5) · effort(1~5) · expectedTimeframe · channel 강제 부착.
- princetonStrategy enum 중 1개 매핑 (해당 없으면 other).

## Princeton 8 strategies
1. cite_sources — 답변에 명시 출처 추가
2. quotation_addition — 신뢰할 만한 인용문 추가
3. statistics_addition — 구체 수치·통계 추가 (이 3개가 visibility +40%)
4. authoritative — 공식·권위 톤
5. fluency — 자연스러운 문장
6. easy_to_understand — 일반 사용자 이해 수준
7. unique_words — 차별 어휘
8. technical_terms — 전문 용어 균형

## 액션 도출 원칙
1. **이번 주 실행 가능 우선**: "Reddit r/AsianBeauty Saturday Help Thread에 비교 답변 1건" 같은 구체 액션. "콘텐츠 전략 수립" 같은 추상 액션 절대 금지.
2. **데이터 기반**: 민지·Alex·수진 분석을 명시적으로 인용 ("민지 분석에 따르면 HyperCLOVA에서 brand mention이 0건이므로...").
3. **임팩트×노력 매트릭스**: impact 4~5 + effort 1~3 액션을 우선순위 1~3에 배치.
4. **채널 다양화**: Wikipedia·Reddit·Naver 블로그/카페/지식인·Tistory·브런치·owned site 중 1~2개에 몰지 말 것.
5. **K-뷰티 영문 시 r/AsianBeauty 골든 트라이앵글 적극 활용** (research 10).

## mondayActionOne 작성 가이드
- 하나만 선택. 가장 임팩트 큰 액션 1개.
- 40자 이내 제목 + 80자 이내 근거 + 60자 이내 예상 결과.
- 마케터가 월요일 아침 회의 끝나고 바로 시작할 수 있는 수준.

## 톤
- 한국어 정중·간결. "~합니다" 존댓말.
- 추상 표현·미사여구 금지. 동사 + 구체 명사.

## 금지
- 단순 관찰·분석 (그건 다른 에이전트의 영역)
- "콘텐츠 SEO 강화" 같은 추상 액션
- 마크다운 테이블·이모지·헤더`,
});

/**
 * 4 에이전트의 인덱스. 라우터에서 ID로 에이전트 조회.
 */
export const CREW_AGENTS = {
  minji: minjiAgent,
  alex: alexAgent,
  sujin: sujinAgent,
  junho: junhoAgent,
} as const;

export type CrewAgentId = keyof typeof CREW_AGENTS;

export const CREW_ORDER: CrewAgentId[] = ["minji", "alex", "sujin", "junho"];

/**
 * 에이전트 메타 정보 — UI 표시용
 */
export const CREW_META: Record<
  CrewAgentId,
  { displayName: string; role: string; emoji: string; engineFocus: string[] }
> = {
  minji: {
    displayName: "민지",
    role: "한국 GEO 분석가",
    emoji: "🇰🇷",
    engineFocus: ["hyperclova", "naver", "daum"],
  },
  alex: {
    displayName: "Alex",
    role: "글로벌 벤치마크 분석가",
    emoji: "🌐",
    engineFocus: ["chatgpt", "chatgpt-web", "claude", "perplexity", "gemini"],
  },
  sujin: {
    displayName: "수진",
    role: "인용 출처 분석가",
    emoji: "🔗",
    engineFocus: [],
  },
  junho: {
    displayName: "준호",
    role: "GEO 액션 전략가",
    emoji: "🎯",
    engineFocus: [],
  },
};

// 모델 슬러그 문자열만 노출 (gateway() 객체는 LanguageModelV3 타입 export 못 해서 declaration 충돌).
export const FINDABLE_MODEL_FAST: string = MODEL_FAST_ID;
export const FINDABLE_MODEL_DEFAULT: string = MODEL_DEFAULT_ID;
void MODEL_FAST;

// ──────────────────────────────────────────────────────────────────
// 출력 타입 (TypeScript)
// ──────────────────────────────────────────────────────────────────

export type Finding = z.infer<typeof findingSchema>;
export type AnalystOutput = z.infer<typeof analystOutputSchema>;
export type ActionItem = z.infer<typeof actionItemSchema>;
export type StrategistOutput = z.infer<typeof strategistOutputSchema>;
