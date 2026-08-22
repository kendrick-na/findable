// 업종 감지 + 업종별 GEO 채널 프로파일 (세션M, 2026-08-02)
//
// 문제(사용자 지적 "말이 이상하다"의 뿌리):
//   반도체 회사(SK하이닉스)에 "Sephora 리뷰"·"Reddit r/buildapc 댓글" 처방이 나갔다.
//   실측 원인 3중:
//     ① AuditJob.industry가 71건 전부 null (route가 zod로 받기만 하고 저장 안 함)
//     ② crew-runner가 industry를 조회도 전달도 안 함
//     ③ crew 에이전트 프롬프트에 K-뷰티가 하드코딩
//        (Alex "Sephora reviews", 수진 "K-뷰티 골든 트라이앵글 즉시 진단",
//         준호 "골든 트라이앵글 적극 활용")
//   → 에이전트는 업종을 알 방법이 없는 상태에서 K-뷰티 예시만 보고 추론했고,
//     "소비재 커뮤니티" 틀을 유지한 채 서브레딧만 반도체용으로 바꿔 끼웠다.
//
// 해결: 도메인 → 업종 판정(정적사전 → LLM → other 폴백) → 업종별 채널 프로파일을
//       런타임에 프롬프트로 주입. 에이전트 프롬프트에서 업종 고유명사를 전부 제거한다.
//
// 설계 원칙:
//   - Industry enum(DB)만으로는 부족하다. 반도체는 b2b_saas가 아니라 제조 B2B다.
//     → audience 축(b2b/b2c/mixed)을 함께 판정해 채널 선택의 실제 기준으로 쓴다.
//   - 확신 없으면 other/mixed. 추측으로 채우지 않는다(환각 방지, brand-identity 동일 정책).
//   - LLM 실패해도 동작해야 한다 → 전 구간 폴백.

import { createOpenAI } from "@ai-sdk/openai";
import { log } from "@repo/observability/log";
import { generateObject } from "ai";
import { z } from "zod";
import { models } from "./models";

/** DB Industry enum과 정렬 (packages/database/prisma/schema.prisma). */
export const INDUSTRY_KEYS = [
  "beauty",
  "fashion",
  "food",
  "b2b_saas",
  "content_ip",
  "retail",
  "finance",
  "healthcare",
  "education",
  "manufacturing",
  "other",
] as const;

export type IndustryKey = (typeof INDUSTRY_KEYS)[number];

/** 구매 결정 주체 — 채널 선택의 실제 기준(업종보다 강한 신호). */
export type AudienceKey = "b2b" | "b2c" | "mixed";

export interface IndustryProfile {
  audience: AudienceKey;
  /**
   * 이 업종에 제안하면 안 되는 채널 — 반도체에 Sephora가 나가는 사고의 직접 방어.
   */
  avoidChannels: string[];
  /**
   * 이 업종에서 AI가 실제로 근거로 삼는 채널.
   * 에이전트 프롬프트에 그대로 주입되어 K-뷰티 하드코딩을 대체한다.
   */
  channels: string[];
  /** 판정 근거. "확인필요"를 UI가 구분할 수 있게 한다. */
  confidence: "dictionary" | "inferred" | "unknown";
  industry: IndustryKey;
  /** 사람이 읽는 업종 라벨 (프롬프트·UI 표기용). */
  label: string;
}

// ──────────────────────────────────────────────────────────────────
// 업종별 채널 프로파일
//
// 출처 원칙: 실제 AI 답변이 인용하는 채널 유형만 넣는다. 특정 브랜드명(Sephora 등)은
// 넣지 않는다 — 그게 이번 사고의 원인이었다. 채널은 "유형"으로 기술한다.
// ──────────────────────────────────────────────────────────────────

const CONSUMER_REVIEW_CHANNELS = [
  "네이버 블로그·카페 후기",
  "유튜브 리뷰·비교 영상",
  "커머스 플랫폼 상품평",
  "가격비교·랭킹 큐레이션",
];

const B2B_TECH_CHANNELS = [
  "공식 기술문서·데이터시트·스펙 페이지",
  "업계 전문매체·산업 분석 리포트",
  "Wikipedia(한/영) 기업·기술 항목",
  "IR·공시·보도자료(실적·로드맵 근거)",
  "기술 컨퍼런스 발표·백서",
];

const PROFILES: Record<
  IndustryKey,
  { label: string; audience: AudienceKey; channels: string[]; avoid: string[] }
> = {
  beauty: {
    label: "뷰티·화장품",
    audience: "b2c",
    channels: [
      ...CONSUMER_REVIEW_CHANNELS,
      "성분·피부고민 기반 Q&A",
      "글로벌 뷰티 커뮤니티(영문 진출 시)",
    ],
    avoid: ["기술 백서", "IR·공시 자료"],
  },
  fashion: {
    label: "패션·의류",
    audience: "b2c",
    channels: [
      ...CONSUMER_REVIEW_CHANNELS,
      "스타일링·코디 콘텐츠",
      "패션 플랫폼 랭킹·브랜드관",
    ],
    avoid: ["기술 백서", "데이터시트"],
  },
  food: {
    label: "식품·F&B",
    audience: "b2c",
    channels: [
      ...CONSUMER_REVIEW_CHANNELS,
      "맛집·레시피 콘텐츠",
      "원재료·영양성분 정보 페이지",
    ],
    avoid: ["기술 백서", "데이터시트"],
  },
  retail: {
    label: "리테일·커머스",
    audience: "b2c",
    channels: [
      ...CONSUMER_REVIEW_CHANNELS,
      "카테고리별 '추천 TOP' 큐레이션",
      "배송·교환정책 안내 페이지",
    ],
    avoid: ["데이터시트"],
  },
  b2b_saas: {
    label: "B2B SaaS·소프트웨어",
    audience: "b2b",
    channels: [
      "공식 문서(docs)·API 레퍼런스",
      "소프트웨어 리뷰·비교 플랫폼",
      "개발자 커뮤니티·기술 Q&A",
      "도입 사례(케이스 스터디)·고객사 로고",
      "업계 전문매체·분석 리포트",
    ],
    avoid: ["상품평", "뷰티·패션 커뮤니티"],
  },
  manufacturing: {
    label: "제조·산업재",
    audience: "b2b",
    channels: [
      ...B2B_TECH_CHANNELS,
      "제품 카탈로그·인증·규격 페이지",
      "공급망·파트너사 문서",
    ],
    avoid: ["상품평", "뷰티·패션 커뮤니티", "맛집·레시피 콘텐츠"],
  },
  finance: {
    label: "금융·핀테크",
    audience: "mixed",
    channels: [
      "금리·수수료 등 조건 비교 페이지",
      "금융당국·협회 공시 자료",
      "경제·금융 전문매체",
      "Wikipedia(한/영) 기업 항목",
      "이용 후기·앱스토어 리뷰",
    ],
    avoid: ["맛집·레시피 콘텐츠", "스타일링 콘텐츠"],
  },
  healthcare: {
    label: "헬스케어·의료",
    audience: "mixed",
    channels: [
      "임상·논문 근거 페이지",
      "의료기관·전문가 검수 콘텐츠",
      "인허가·인증 정보(식약처 등)",
      "환자 경험·증상별 Q&A",
    ],
    avoid: ["스타일링 콘텐츠", "가격비교 랭킹"],
  },
  education: {
    label: "교육",
    audience: "mixed",
    channels: [
      "커리큘럼·수강 후기",
      "합격·성과 사례 페이지",
      "교육 전문매체·기관 인증",
      "학습자 커뮤니티 Q&A",
    ],
    avoid: ["데이터시트", "IR·공시 자료"],
  },
  content_ip: {
    label: "콘텐츠·IP",
    audience: "mixed",
    channels: [
      "위키·팬덤 아카이브",
      "작품 정보 DB·플랫폼 페이지",
      "리뷰·평점 커뮤니티",
      "언론 보도·인터뷰",
    ],
    avoid: ["데이터시트", "성분 정보"],
  },
  other: {
    label: "업종 미확인",
    audience: "mixed",
    channels: [
      "자사 공식 소개·서비스 페이지",
      "Wikipedia(한/영) 항목",
      "언론 보도·보도자료",
      "업계 디렉터리 등재",
    ],
    // 업종을 모를 때는 특정 채널을 금지하지 않는다.
    // 대신 에이전트에게 "업종 특화 채널을 단정하지 말라"고 지시한다(buildIndustryGuidance).
    avoid: [],
  },
};

/**
 * 도메인 → 업종 정적 사전.
 * 확실한 케이스는 LLM 콜 없이 즉시·정확(비용 0·환각 0). brand-identity와 동일 정책.
 * key는 등록 도메인(호스트, www 제외).
 */
const STATIC_INDUSTRY_DICTIONARY: Record<
  string,
  { industry: IndustryKey; audience?: AudienceKey }
> = {
  "skhynix.com": { industry: "manufacturing" },
  "samsung.com": { industry: "manufacturing", audience: "mixed" },
  "nvidia.com": { industry: "manufacturing", audience: "mixed" },
  "lg.com": { industry: "manufacturing", audience: "mixed" },
  "hyundai.com": { industry: "manufacturing", audience: "mixed" },
  "sulwhasoo.com": { industry: "beauty" },
  "amorepacific.com": { industry: "beauty" },
  "innisfree.com": { industry: "beauty" },
  "laneige.com": { industry: "beauty" },
  "medicube.co.kr": { industry: "beauty" },
  "oliveyoung.co.kr": { industry: "retail" },
  "musinsa.com": { industry: "fashion" },
  "coupang.com": { industry: "retail" },
  "kurly.com": { industry: "retail" },
  "baemin.com": { industry: "food" },
  "toss.im": { industry: "finance" },
  "kakao.com": { industry: "b2b_saas", audience: "mixed" },
  "naver.com": { industry: "b2b_saas", audience: "mixed" },
};

const PROTOCOL_RE = /^https?:\/\//;
const WWW_RE = /^www\./;

function normalizeHost(domain: string): string {
  return (
    domain.replace(PROTOCOL_RE, "").replace(WWW_RE, "").split("/")[0] ?? domain
  ).toLowerCase();
}

function toProfile(
  industry: IndustryKey,
  confidence: IndustryProfile["confidence"],
  audienceOverride?: AudienceKey
): IndustryProfile {
  const p = PROFILES[industry];
  return {
    industry,
    audience: audienceOverride ?? p.audience,
    label: p.label,
    channels: p.channels,
    avoidChannels: p.avoid,
    confidence,
  };
}

/** 업종 미확인 폴백 — 어떤 실패 경로에서도 이걸 반환하면 안전하다. */
export function unknownIndustryProfile(): IndustryProfile {
  return toProfile("other", "unknown");
}

const industryLlmSchema = z.object({
  industry: z
    .enum(INDUSTRY_KEYS)
    .describe(
      "이 회사의 주력 업종. 반도체·부품·기계·소재는 manufacturing. 확실하지 않으면 other."
    ),
  audience: z
    .enum(["b2b", "b2c", "mixed"])
    .describe(
      "주 구매 결정 주체. 기업 대상이면 b2b, 일반 소비자면 b2c, 둘 다면 mixed."
    ),
  confident: z
    .boolean()
    .describe("이 회사를 실제로 아는 경우에만 true. 추측이면 false."),
});

const LETSUR_MODEL_ID =
  process.env.FINDABLE_CREW_LETSUR_MODEL ?? "claude-haiku-4-5-20251001";

function industryInferModel() {
  const letsurKey = process.env.LETSUR_API_KEY;
  if (letsurKey) {
    const letsur = createOpenAI({
      baseURL: "https://gw.letsur.ai/v1",
      apiKey: letsurKey,
    });
    return letsur(LETSUR_MODEL_ID);
  }
  return models.chat;
}

/**
 * 업종 판정 (3층 체인).
 *   1. 명시 업종 — 사용자가 앱에서 고쳐둔 값이 있으면 최우선(자동감지보다 사람이 우선).
 *   2. 정적 사전 — 확실한 케이스는 즉시(비용 0).
 *   3. LLM 추론 — 롱테일. confident일 때만 채택.
 *   4. other 폴백 — 위 모두 실패 시. 추측으로 채우지 않는다.
 *
 * @param domain 대상 도메인
 * @param explicitIndustry DB에 저장된 사용자 확정 업종(있으면 최우선)
 * @param brandName 브랜드명(있으면 LLM 판정 정확도 상승)
 */
export async function resolveIndustryProfile(
  domain: string,
  explicitIndustry?: string | null,
  brandName?: string
): Promise<IndustryProfile> {
  // 1. 사용자가 앱에서 명시한 업종이 있으면 그것을 신뢰한다.
  const explicit = explicitIndustry?.trim();
  if (explicit && (INDUSTRY_KEYS as readonly string[]).includes(explicit)) {
    return toProfile(explicit as IndustryKey, "dictionary");
  }

  // 2. 정적 사전.
  const dict = STATIC_INDUSTRY_DICTIONARY[normalizeHost(domain)];
  if (dict) {
    return toProfile(dict.industry, "dictionary", dict.audience);
  }

  // 3. LLM 추론.
  try {
    const host = normalizeHost(domain);
    const { object: out } = await generateObject({
      model: industryInferModel(),
      schema: industryLlmSchema,
      prompt: `다음 회사의 업종과 주 고객층을 판정해줘. 실제로 아는 회사일 때만 답하고, 모르면 confident=false로 표시해.\n도메인: ${host}${brandName ? `\n브랜드명: ${brandName}` : ""}`,
    });
    if (out.confident && out.industry !== "other") {
      return toProfile(out.industry, "inferred", out.audience);
    }
  } catch (error) {
    log.warn("industry.llm_infer.failed", { domain, error: String(error) });
  }

  // 4. 폴백.
  return unknownIndustryProfile();
}

/**
 * 에이전트 프롬프트에 주입할 업종 가이드 블록.
 *
 * 이 블록이 K-뷰티 하드코딩을 대체한다. 에이전트는 여기 적힌 채널만 근거로
 * 처방해야 하며, 업종 미확인이면 채널을 단정하지 않도록 지시한다.
 */
const AUDIENCE_LABEL: Record<AudienceKey, string> = {
  b2b: "기업 고객(B2B) — 구매 결정자는 실무자·의사결정권자이지 일반 소비자가 아님",
  b2c: "일반 소비자(B2C)",
  mixed: "기업·소비자 혼합",
};

export function buildIndustryGuidance(profile: IndustryProfile): string {
  const audienceLabel = AUDIENCE_LABEL[profile.audience];

  if (profile.confidence === "unknown") {
    return `## 업종 컨텍스트
- 업종: 확인되지 않음
- 고객층: 확인되지 않음

업종 판정 규칙 (엄수):
1. 업종이 확인되지 않았으므로 **특정 업종을 전제한 채널을 단정하지 말 것**.
2. 먼저 엔진 응답 내용에서 이 브랜드가 무엇을 파는 회사인지 파악하고, 그에 맞는 채널만 제안할 것.
3. 근거 없이 소비자 리뷰 커뮤니티·뷰티 플랫폼 등을 제안하지 말 것. 확실한 것만 제안하고, 불확실하면 dataGaps에 "업종 확인 필요"로 남길 것.
4. 업종 무관하게 안전한 채널: ${PROFILES.other.channels.join(" · ")}`;
  }

  const avoidLine = profile.avoidChannels.length
    ? `\n\n**이 업종에 제안 금지**: ${profile.avoidChannels.join(" · ")} — 구매 결정 경로와 무관해 신뢰를 잃는다.`
    : "";

  return `## 업종 컨텍스트
- 업종: ${profile.label}
- 고객층: ${audienceLabel}

**이 업종에서 AI가 실제로 근거로 삼는 채널** (처방은 이 안에서 고를 것):
${profile.channels.map((c) => `- ${c}`).join("\n")}${avoidLine}

업종 판정 규칙 (엄수):
1. 위 채널 목록 밖의 채널을 제안하려면 **엔진 응답에서 실제로 관측된 근거**가 있어야 한다.
2. 다른 업종의 사례·플랫폼을 예시로 끌어오지 말 것. 이 브랜드의 고객이 실제로 가는 곳만 말할 것.
3. 채널명을 쓸 때는 이 브랜드 업종에서 통용되는 것인지 먼저 확인할 것.`;
}
