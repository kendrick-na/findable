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

import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { gateway } from "ai";
import { z } from "zod";

// 원가전략(2026-07-27): CrewAI 심층분석은 "측정"이 아니라 "내부 해석 리포트"라
// 모델 자유. sonnet→haiku(1/3 가격)로 낮추고, Letsur 크레딧으로 호출(Vercel 크레딧
// 아낌). Letsur 키 있으면 Letsur haiku, 없으면 Vercel Gateway haiku로 폴백.
//   - FINDABLE_CREW_MODEL: Vercel 폴백용 슬러그(점 표기).
//   - FINDABLE_CREW_LETSUR_MODEL: Letsur 슬러그(하이픈 표기).
const MODEL_DEFAULT_ID =
  process.env.FINDABLE_CREW_MODEL ?? "anthropic/claude-haiku-4.5";
const MODEL_FAST_ID =
  process.env.FINDABLE_CREW_MODEL_FAST ?? "anthropic/claude-haiku-4.5";
const LETSUR_CREW_MODEL_ID =
  process.env.FINDABLE_CREW_LETSUR_MODEL ?? "claude-haiku-4-5-20251001";

function resolveCrewModel(vercelSlug: string) {
  const letsurKey = process.env.LETSUR_API_KEY;
  if (letsurKey) {
    const letsur = createOpenAI({
      baseURL: "https://gw.letsur.ai/v1",
      apiKey: letsurKey,
    });
    return letsur(LETSUR_CREW_MODEL_ID);
  }
  return gateway(vercelSlug);
}

const MODEL_DEFAULT = resolveCrewModel(MODEL_DEFAULT_ID);
const MODEL_FAST = resolveCrewModel(MODEL_FAST_ID);

// ──────────────────────────────────────────────────────────────────
// 출력 스키마 (Zod) — 4 에이전트가 반환할 구조화된 응답
// 마크다운 raw 출력 대신 이 스키마를 강제해 UI가 깔끔하게 렌더링.
// ──────────────────────────────────────────────────────────────────

/** 모든 에이전트 공통 — Findings 항목 */
export const findingSchema = z.object({
  title: z
    .string()
    .describe(
      "발견 핵심을 25자 이내 한국어로 (예: '한국 엔진 12개 모두 미응답')"
    ),
  whyItMatters: z
    .string()
    .describe("왜 중요한지 50자 이내 한국어 한 문장 (임원 즉시 이해 가능)"),
  detail: z
    .string()
    .describe("배경 설명 200자 이내. 데이터 인용 OK. 마크다운 X, 평문만"),
  severity: z
    .enum(["red", "amber", "green"])
    .describe("R=즉시 / A=이번 주 / G=양호"),
});

/** 분석가 에이전트 (민지·Alex·수진) 공통 출력 */
export const analystOutputSchema = z.object({
  executiveSummary: z
    .string()
    .describe(
      "임원이 이 한 문장만 읽어도 결정 가능한 요약. 80자 이내 한국어. 데이터 1개 포함"
    ),
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
  title: z
    .string()
    .describe(
      "액션 핵심 30자 이내 한국어 (예: 'Wikipedia 한국어 페이지 신설')"
    ),
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
  impact: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe("예상 임팩트 1(낮음)~5(매우 높음)"),
  effort: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe("예상 노력 1(쉬움)~5(매우 어려움)"),
  expectedTimeframe: z
    .string()
    .describe("예상 효과 시점 (예: '4주 내 SoV +5')"),
  channel: z
    .enum([
      // 공통
      "wikipedia",
      "owned_site",
      "press_release",
      "industry_media",
      "other",
      // B2B·기술 (2026-08-02 추가: 기존 enum이 소비재 채널뿐이라 B2B 액션을
      // 도출해도 담을 칸이 없었다 — 반도체에 amazon/reddit이 찍히던 원인 중 하나)
      "official_docs",
      "review_platform",
      "developer_community",
      "case_study",
      "ir_disclosure",
      // 소비자
      "reddit",
      "naver_blog",
      "naver_cafe",
      "naver_jisikin",
      "tistory",
      "brunch",
      "youtube",
      "amazon",
    ])
    .describe(
      "실행 채널. 반드시 업종 컨텍스트의 유효 채널과 정합해야 한다. B2B 브랜드에 소비자 리뷰 채널(amazon·reddit 등)을 고르지 말 것."
    ),
});

/** 준호 (액션 전략가) 출력 */
export const strategistOutputSchema = z.object({
  mondayActionOne: z
    .object({
      title: z
        .string()
        .describe("이번 주 월요일 09:00에 시작할 단 1개 액션. 40자 이내"),
      whyThisOne: z.string().describe("왜 이게 1순위인지 80자 이내"),
      expectedOutcome: z
        .string()
        .describe("실행 시 예상 결과 60자 이내 (수치 포함)"),
    })
    .describe("이번 주 월요일 액션 1건 — Findable 시그니처 deliverable"),
  topActions: z
    .array(actionItemSchema)
    .min(3)
    .max(7)
    .describe("우선순위 정렬된 Top 3~7 액션"),
  executiveSummary: z
    .string()
    .describe(
      "임원이 이 한 문장만 읽어도 결정 가능. 80자 이내, 데이터·기간·예상 결과 포함"
    ),
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
2. **Position vs competitors**: Rank order among the competitors that actually appear in the measured responses. Use the competitor names observed in the data — never invent an illustrative pair.
3. **English-language source signals**: Which source types actually drive this brand's citation pattern? Judge from the observed cited domains, and stay within the channel list in the 업종 컨텍스트 block.
4. **Global vs home-market positioning**: Where is the brand over/under-indexed in English LLM answers relative to its position in Korean engines?
5. **Citation source concentration**: Quantify which domains carry this brand's English-language visibility, and whether the mix is concentrated or diverse.

## ⚠️ 업종 준수 (필수)
사용자 프롬프트의 "업종 컨텍스트" 블록에 이 브랜드의 업종과 유효 채널이 있다.
- 그 블록에 없는 채널·플랫폼을 예시로 들지 말 것. 다른 업종의 사례를 끌어오지 말 것.
- 업종이 "확인되지 않음"이면 채널을 단정하지 말고 dataGaps에 남길 것.

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
1. **실제 인용 도메인 분석**: 데이터에 실제로 등장한 도메인만 평가한다. 등장하지 않은 플랫폼을 "없어서 문제"라고 지적하려면, 그 채널이 이 브랜드 업종에서 실제로 유효한 경우에만 한다(업종 컨텍스트 참조).
2. **도메인 권위 평가**: 관측된 도메인을 유형별(자사·위키·언론·업계매체·커뮤니티·커머스)로 분류해 정성 평가.
3. **출처 다양성**: 단일 출처 의존(편향 위험) vs 다양한 출처 합성. 집중도를 수치로 제시.
4. **한국 vs 영어 출처 분포**: 같은 브랜드인데 한국어 답변과 영어 답변이 서로 다른 출처를 근거로 삼는지, 한쪽에만 출처가 쏠려 있는지.
5. **통제 가능성 구분**: 자사가 직접 고칠 수 있는 출처(자사 도메인·공식 문서)와 제3자 출처를 나눠 표시.
6. **부정 인용 탐지**: 부정 맥락 출처 별도 표시 (브랜드 안전성 리스크).

## ⚠️ 업종 준수 (필수)
사용자 프롬프트의 "업종 컨텍스트" 블록에 이 브랜드의 업종과 유효 채널이 있다.
- 그 블록에 없는 채널을 "여기에 인용되어야 한다"고 제안하지 말 것.
- 업종이 "확인되지 않음"이면 채널을 단정하지 말고 dataGaps에 남길 것.

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
1. **이번 주 실행 가능 우선**: 담당자·장소·산출물이 특정되는 수준으로 쓸 것. "콘텐츠 전략 수립" 같은 추상 액션 절대 금지.
2. **데이터 기반**: 민지·Alex·수진 분석을 명시적으로 인용 ("민지 분석에 따르면 HyperCLOVA에서 brand mention이 0건이므로...").
3. **임팩트×노력 매트릭스**: impact 4~5 + effort 1~3 액션을 우선순위 1~3에 배치.
4. **채널 다양화**: 한두 채널에 몰지 말 것. 단, 채널은 **업종 컨텍스트에 제시된 목록 안에서만** 고를 것.
5. **측정된 약점에 직결**: 각 액션은 데이터에서 관측된 특정 결손(미언급 엔진·쏠린 출처·낮은 순위)을 겨냥해야 한다.

## ⚠️ 업종 준수 (최우선 규칙)
사용자 프롬프트의 "업종 컨텍스트" 블록에 이 브랜드의 업종·고객층·유효 채널·금지 채널이 있다.
- **금지 채널을 제안하면 그 리포트는 실패**로 간주한다. 반도체 회사에 화장품 리뷰 채널을 제안하는 식의 오류가 실제로 발생했다.
- 유효 채널 목록 밖의 채널을 쓰려면 엔진 응답에서 관측된 근거가 있어야 한다.
- 업종이 "확인되지 않음"이면 업종 특화 채널을 단정하지 말고, 업종 무관하게 안전한 채널(자사 공식 페이지·위키·언론·업계 디렉터리)만 제안할 것.
- B2B 브랜드에는 일반 소비자 리뷰·후기 채널을 제안하지 말 것(구매 결정 경로가 다르다).

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

/**
 * 재작성(critique 후 압축) 전용 에이전트 — `MODEL_FAST` 실사용처 (2026-08-09).
 *
 * 이전에는 `void MODEL_FAST;` 로 **정의만 하고 버리는 죽은 코드**였다.
 * 여기서 실제로 쓴다: 재작성은 "새 판단"이 아니라 **압축**이라 빠른 모델이면 충분하다.
 *
 * ⚠️ 실측(2026-08-09): 현재 `MODEL_FAST_ID` 와 `MODEL_DEFAULT_ID` 는 **같은 haiku-4.5** 다.
 *   즉 지금은 속도·비용 차이가 없고, `FINDABLE_CREW_MODEL_FAST` 로 더 싼 모델을 지정하면
 *   그때 효과가 난다. 배선을 먼저 열어둔다(모델 교체가 env 한 줄이 되도록).
 */
export const rewriterAgent = new Agent({
  id: "rewriter",
  name: "압축 리라이터",
  model: MODEL_FAST,
  instructions: `당신은 GEO 리포트 압축 전문가입니다.

주어진 JSON 리포트를 **같은 스키마로** 반환하되, 지적된 필드만 길이 규정에 맞게 줄입니다.

## 절대 규칙
- **판단·우선순위·수치를 바꾸지 않는다.** 당신의 일은 재분석이 아니라 **압축**이다.
- 액션의 rank·channel·impact·effort·princetonStrategy 는 **원본 값 그대로** 복사한다
  (다른 화면이 같은 숫자를 쓰므로 바뀌면 화면 간 숫자가 어긋난다).
- 사실·수치는 버리지 않는다. 수식어·중복 설명·접속어를 먼저 덜어낸다.
- 한 필드에 여러 문장이 있으면 가장 중요한 한 문장만 남긴다.
- 한국어 "~합니다" 존댓말. 마크다운·이모지·테이블 금지.`,
});

// ──────────────────────────────────────────────────────────────────
// 출력 타입 (TypeScript)
// ──────────────────────────────────────────────────────────────────

export type Finding = z.infer<typeof findingSchema>;
export type AnalystOutput = z.infer<typeof analystOutputSchema>;
export type ActionItem = z.infer<typeof actionItemSchema>;
export type StrategistOutput = z.infer<typeof strategistOutputSchema>;
