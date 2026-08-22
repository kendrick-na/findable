// 브랜드 아이덴티티 해석 — 도메인 → 한/영 브랜드 변형 (P0-b, 2026-07-27)
//
// 문제: audit 진입점이 도메인만 받으면 브랜드명이 영문("Sulwhasoo")뿐이라,
// 한국어 답변의 "설화수"를 판정(detectBrandMention)이 못 잡아 미언급 오판정.
// 해결: 폼 입력 → 정적 사전 → LLM 추론 → 영문 폴백의 4층 체인으로 한/영 변형 확보.
// 판정(detectBrandMention)은 [brandName, ...variants] 전부를 substring 매칭하므로
// variants에 "설화수"가 들어가기만 하면 됨. 프롬프트에는 대표명(한글 우선) 사용.

import { createOpenAI } from "@ai-sdk/openai";
import { log } from "@repo/observability/log";
import { generateObject } from "ai";
import { z } from "zod";
import { models } from "./models";

// LLM 추론 모델 — Letsur 키 우선(결함감사 §20-보강, 2026-07-30).
// 기존 models.chat=openai("gpt-4o-mini")는 OPENAI_API_KEY 전제인데 프로덕션에
// 미설정 → LLM 추론이 항상 조용히 실패해 브랜드 변형이 빈 배열이었다.
// crew와 동일한 Letsur haiku로 라우팅(구조화 출력 라이브 검증됨).
const LETSUR_BRAND_MODEL_ID =
  process.env.FINDABLE_CREW_LETSUR_MODEL ?? "claude-haiku-4-5-20251001";

function brandInferModel() {
  const letsurKey = process.env.LETSUR_API_KEY;
  if (letsurKey) {
    const letsur = createOpenAI({
      baseURL: "https://gw.letsur.ai/v1",
      apiKey: letsurKey,
    });
    return letsur(LETSUR_BRAND_MODEL_ID);
  }
  return models.chat;
}

export interface BrandIdentity {
  /** 프롬프트·표시에 쓸 대표 브랜드명 (한글 우선, 없으면 영문). */
  brandName: string;
  /** 판정용 한/영 변형 전체 (대표명 제외, detectBrandMention에 넘김). */
  brandVariants: string[];
}

/**
 * 유명 한국 브랜드 도메인 → 한/영 변형 정적 사전.
 * 확실한 브랜드는 LLM 콜 없이 즉시·정확하게 해결 (비용 0, 환각 0).
 * 롱테일은 사전에 없으므로 LLM 폴백이 받는다. key는 등록 도메인(호스트, www 제외).
 */
const STATIC_BRAND_DICTIONARY: Record<
  string,
  { brandName: string; variants: string[] }
> = {
  "sulwhasoo.com": { brandName: "설화수", variants: ["Sulwhasoo"] },
  "amorepacific.com": {
    brandName: "아모레퍼시픽",
    variants: ["Amorepacific", "AmorePacific"],
  },
  "innisfree.com": { brandName: "이니스프리", variants: ["Innisfree"] },
  "laneige.com": { brandName: "라네즈", variants: ["Laneige"] },
  "musinsa.com": { brandName: "무신사", variants: ["Musinsa"] },
  "oliveyoung.co.kr": {
    brandName: "올리브영",
    variants: ["Olive Young", "OliveYoung"],
  },
  "kakao.com": { brandName: "카카오", variants: ["Kakao"] },
  "naver.com": { brandName: "네이버", variants: ["Naver"] },
  "coupang.com": { brandName: "쿠팡", variants: ["Coupang"] },
  "baemin.com": { brandName: "배달의민족", variants: ["배민", "Baemin"] },
  "toss.im": { brandName: "토스", variants: ["Toss"] },
  "kurly.com": {
    brandName: "마켓컬리",
    variants: ["컬리", "Kurly", "Market Kurly"],
  },
  "hyundai.com": { brandName: "현대", variants: ["Hyundai"] },
  "samsung.com": { brandName: "삼성", variants: ["Samsung"] },
  "lg.com": { brandName: "엘지", variants: ["LG"] },
};

const PROTOCOL_RE = /^https?:\/\//;
const WWW_RE = /^www\./;

/**
 * 도메인에서 영문 브랜드명 추출 — 최후 폴백 휴리스틱.
 * (사전·LLM 모두 실패 시. 기존 inferBrandName과 동일 동작 보존.)
 */
export function inferBrandNameFromDomain(domain: string): string {
  const cleaned =
    domain.replace(PROTOCOL_RE, "").replace(WWW_RE, "").split("/")[0] ?? domain;
  const tld = cleaned.split(".")[0] ?? cleaned;
  return tld.charAt(0).toUpperCase() + tld.slice(1);
}

/** 호스트 정규화 — 프로토콜·www·경로 제거, 소문자. */
function normalizeHost(domain: string): string {
  return (
    domain.replace(PROTOCOL_RE, "").replace(WWW_RE, "").split("/")[0] ?? domain
  ).toLowerCase();
}

/**
 * 정적 사전만 조회 — LLM 호출 없음(원가 0·즉시). 온보딩 1단계에서 도메인 입력 시
 * 이름 칸을 자동으로 채우는 데 쓴다(2026-08-21 10번 · Scrunch의 "Confirm your
 * details" 처럼 값을 미리 채워 확인만 하게 함 — 경쟁사 실측 근거).
 * ⚠️ 사전에 없는 롱테일 브랜드는 null — 그때는 사용자가 직접 입력한다(👤 결정,
 *   LLM 자동추정은 이번 범위에 넣지 않음).
 */
export function lookupStaticBrandName(domain: string): string | null {
  const host = normalizeHost(domain);
  return STATIC_BRAND_DICTIONARY[host]?.brandName ?? null;
}

const brandLlmSchema = z.object({
  koreanName: z
    .string()
    .describe("한국어 브랜드명. 확실하지 않으면 빈 문자열.")
    .default(""),
  englishName: z
    .string()
    .describe("영어/로마자 브랜드명. 확실하지 않으면 빈 문자열.")
    .default(""),
  aliases: z
    .array(z.string())
    .describe("자주 쓰이는 약칭·별칭 (한글/영문). 없으면 빈 배열.")
    .default([]),
  confident: z
    .boolean()
    .describe(
      "이 도메인의 브랜드를 실제로 아는 경우에만 true. 추측이면 false."
    ),
});

/**
 * LLM으로 도메인 → 한/영 브랜드명 추론.
 * confident=false거나 콜 실패 시 null 반환 (폴백에 맡김) — 환각 방지.
 */
async function inferBrandViaLlm(
  domain: string
): Promise<{ brandName: string; variants: string[] } | null> {
  try {
    const host = normalizeHost(domain);
    const { object: out } = await generateObject({
      model: brandInferModel(),
      schema: brandLlmSchema,
      prompt: `다음 웹사이트 도메인의 브랜드명을 한국어와 영어로 알려줘. 실제로 아는 브랜드일 때만 답하고, 모르면 confident=false로 표시해. 도메인: ${host}`,
    });
    if (!out.confident) {
      return null;
    }
    const korean = out.koreanName.trim();
    const english = out.englishName.trim();
    const aliases = out.aliases.map((a) => a.trim()).filter(Boolean);
    if (!(korean || english)) {
      return null;
    }
    // 대표명: 한글 우선 (한국어 답변 판정이 핵심이므로).
    const brandName = korean || english;
    const variants = [korean, english, ...aliases]
      .filter(Boolean)
      .filter((v) => v !== brandName);
    return { brandName, variants: dedupe(variants) };
  } catch (error) {
    log.warn("brand.llm_infer.failed", { domain, error: String(error) });
    return null;
  }
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (item && !seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * 브랜드 아이덴티티 해석 (4층 체인).
 *   1. 폼 입력(formBrandName) — 있으면 대표명으로. 사전에 매칭되면 변형 병합.
 *   2. 정적 사전 — 유명 K-브랜드는 즉시·정확 (LLM 콜 없음).
 *   3. LLM 추론 — 롱테일 커버, confident일 때만.
 *   4. 영문 폴백 — 위 모두 실패 시 도메인 휴리스틱(기존 동작).
 */
export async function resolveBrandIdentity(
  domain: string,
  formBrandName?: string
): Promise<BrandIdentity> {
  const host = normalizeHost(domain);
  const dict = STATIC_BRAND_DICTIONARY[host];

  // 1. 폼 입력이 있으면 그것을 대표명으로. 사전 변형이 있으면 판정 폭을 위해 병합.
  //    사전 미스면 LLM으로 변형을 보강한다(2026-07-30 결함감사 §20 뿌리):
  //    이전엔 폼명이 있으면 무조건 변형 0개 → "엔비디아"만 알고 "NVIDIA"를 몰라
  //    영문 위주 답변(네이버 AI 브리핑 등)에서 명백한 언급을 미언급으로 오판정.
  const formName = formBrandName?.trim();
  if (formName) {
    if (dict) {
      return {
        brandName: formName,
        brandVariants: dedupe(
          [dict.brandName, ...dict.variants].filter((v) => v !== formName)
        ),
      };
    }
    const llm = await inferBrandViaLlm(domain);
    const merged = llm
      ? dedupe([llm.brandName, ...llm.variants].filter((v) => v !== formName))
      : [];
    return { brandName: formName, brandVariants: merged };
  }

  // 2. 정적 사전.
  if (dict) {
    return { brandName: dict.brandName, brandVariants: dedupe(dict.variants) };
  }

  // 3. LLM 추론.
  const llm = await inferBrandViaLlm(domain);
  if (llm) {
    return { brandName: llm.brandName, brandVariants: llm.variants };
  }

  // 4. 영문 폴백.
  return { brandName: inferBrandNameFromDomain(domain), brandVariants: [] };
}
