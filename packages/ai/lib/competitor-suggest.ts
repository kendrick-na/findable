// 경쟁사 추천 — 도메인·업종 → LLM 추론 (2026-08-21, 온보딩 §4)
//
// 배경(👤 결정): "자동으로 채워지고, 수정하거나 선택할 수 있게" — 단 Otterly 의 실패
//   (AI 가 자동으로 다 채워서 오분류된 경쟁사가 그대로 측정에 들어간 사고)를 반면교사로,
//   이 함수는 **후보만 만든다**. 화면에 기본 선택할지·수정 가능하게 둘지는 UI 몫이다.
//
// 왜 LLM 인가(크롤링·기존데이터 재활용이 아니라): `competitor-extract.ts` 의
//   `extractCompetitorLandscape` 는 이미 저장된 AI 답변을 재파싱해 원가 0 으로 경쟁
//   지형을 뽑는다 — 하지만 그건 **측정을 한 번 돌린 뒤**에만 쓸 수 있는 데이터다.
//   온보딩 4단계는 측정 **전** 단계라 그 재료가 아직 없다. 경쟁사(Scrunch, f021 실측
//   `docs/_경쟁사_UIUX/전체화면플로우지도_2026-08-21.md`)도 같은 이유로 온보딩에서는
//   그 자리에서 즉시 LLM 호출로 추천한다 — Findable도 같은 방식이 맞다.
//
// `brand-identity.ts` 의 4층 체인과 같은 패턴(Letsur haiku · generateObject+zod ·
//   confident 게이트로 환각 방지)을 재사용한다. 새 모델 라우팅을 만들지 않는다.

import { log } from "@repo/observability/log";
import { generateObject } from "ai";
import { z } from "zod";
import { findEngineName } from "./engine-names";
import {
  HELPER_GATEWAY_MODEL_ID,
  letsurModelWithFallback,
} from "./letsur-fallback";
import { models } from "./models";

const LETSUR_COMPETITOR_MODEL_ID =
  process.env.FINDABLE_CREW_LETSUR_MODEL ?? "claude-haiku-4-5-20251001";

function competitorSuggestModel() {
  // 🔴 Letsur 불가(유닛 소진·만료·인증)면 같은 호출을 Gateway 로 명시적 폴백(letsur-fallback.ts).
  const letsur = letsurModelWithFallback(LETSUR_COMPETITOR_MODEL_ID, {
    callSite: "competitor-suggest",
    gatewayModelId: HELPER_GATEWAY_MODEL_ID,
  });
  if (letsur) {
    return letsur;
  }
  return models.chat;
}

const suggestSchema = z.object({
  competitors: z
    .array(z.string())
    .describe("실제로 아는 경쟁사 브랜드명 3~5개(한국어 우선). 모르면 빈 배열.")
    .default([]),
  confident: z
    .boolean()
    .describe(
      "이 브랜드의 업종·시장을 실제로 아는 경우에만 true. 추측이면 false."
    ),
});

const PROTOCOL_RE = /^https?:\/\//;
const WWW_RE = /^www\./;

function normalizeHost(domain: string): string {
  return (
    domain.replace(PROTOCOL_RE, "").replace(WWW_RE, "").split("/")[0] ?? domain
  ).toLowerCase();
}

/**
 * 도메인·브랜드명·업종으로 경쟁사 후보를 추천한다.
 *
 * ⚠️ **후보만 반환한다 — 담긴 상태가 아니다.** 화면이 기본 선택 여부를 결정한다.
 *   (전자상거래법 "특정옵션 사전선택" 회피 원칙 — 재설계안 §7-D-4 와 같은 결.)
 * ⚠️ `confident=false` 거나 호출 실패 시 빈 배열 — 모르는데 지어내지 않는다.
 */
export async function suggestCompetitors(input: {
  brandName: string;
  domain: string;
  industry?: string | null;
}): Promise<string[]> {
  try {
    const host = normalizeHost(input.domain);
    const industryHint = input.industry
      ? ` 업종은 ${input.industry}로 분류돼 있어.`
      : "";
    const { object: out } = await generateObject({
      model: competitorSuggestModel(),
      schema: suggestSchema,
      prompt:
        `"${input.brandName}"(${host})의 실제 주요 경쟁사 브랜드를 3~5개 알려줘.${industryHint} ` +
        "실제로 아는 시장일 때만 답하고, 모르면 confident=false로 표시해. " +
        "브랜드명만 답해(설명·URL 없이).",
    });
    if (!out.confident) {
      return [];
    }
    return out.competitors.map((c: string) => c.trim()).filter(Boolean);
  } catch (error) {
    log.warn("competitor.suggest.failed", {
      domain: input.domain,
      error: String(error),
    });
    return [];
  }
}

// ── 웹 검색으로 근거를 둔 경쟁사 후보 (2026-10-15 · 대표 승인) ─────────────────────
//
// 왜: 위 `suggestCompetitors` 는 모델의 **기억**에만 기댄다. 신생 카테고리(예: Findable 의 GEO)는 모델이 몰라서
//   `confident=false` → 항상 빈 배열이 됐다(재현 3/3 · 사이트 설명을 줘도 SEO 도구만 나열). 같은 질문을 **웹 검색이 되는
//   엔진(ChatGPT)** 에 던지면 실제 경쟁사(Profound·Peec AI·Otterly·Scrunch·AthenaHQ…)가 나왔다.
// 후보만 만든다(사람이 고른 것만 저장 — Otterly 오분류 사고 반면교사). 자사 이름·AI 엔진 이름은 후보에서 뺀다.

export interface GroundedSite {
  bodySnippet?: string | null;
  description?: string | null;
  headings?: readonly string[] | null;
  title?: string | null;
}

export interface GroundedDeps {
  /** 사이트 재료 → 서비스 분야 한 줄(고유명사 없음). 못 만들면 null. */
  categoryOf: (input: {
    brandName: string;
    industry?: string | null;
    site: GroundedSite;
  }) => Promise<string | null>;
  /** 답변에서 나열된 브랜드 이름. 실패면 null. */
  extract: (answer: string) => Promise<string[] | null>;
  /** 웹 검색이 되는 엔진에 질문해 답변 본문을 받는다. 실패면 null. */
  search: (question: string) => Promise<string | null>;
}

const MAX_GROUNDED = 6;
const NON_IDENTITY_RE = /[^a-z0-9가-힣]/g;
const compactKey = (v: string) => v.toLowerCase().replace(NON_IDENTITY_RE, "");

/** 후보에서 자사 이름·AI 엔진 이름·중복을 뺀다(순수 함수). */
export function filterCompetitorCandidates(
  names: readonly string[],
  ownNames: readonly string[]
): string[] {
  const own = ownNames.map(compactKey).filter((k) => k.length >= 2);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const k = compactKey(name);
    if (
      k.length < 2 ||
      seen.has(k) ||
      own.some((o) => k.includes(o) || o.includes(k)) ||
      findEngineName(name)
    ) {
      continue;
    }
    seen.add(k);
    out.push(name);
  }
  return out.slice(0, MAX_GROUNDED);
}

const categorySchema = z.object({
  category: z
    .string()
    .describe(
      "이 회사가 제공하는 서비스 분야를 한 줄로(20자 안팎). 회사·브랜드·제품 고유명사와 AI 서비스 이름은 넣지 말 것. 모르면 빈 문자열."
    )
    .default(""),
});

const defaultDeps: GroundedDeps = {
  async categoryOf({ brandName, industry, site }) {
    try {
      const { object } = await generateObject({
        model: competitorSuggestModel(),
        schema: categorySchema,
        prompt: `"${brandName}"의 공식 사이트 문구로 이 회사가 제공하는 **서비스 분야**를 한 줄로 써줘(예: '신생아용 보습 스킨케어', '기업용 협업 소프트웨어'). 회사 이름·제품 고유명사는 쓰지 마.\n업종: ${industry ?? "알 수 없음"}\n제목: ${site.title ?? ""}\n설명: ${site.description ?? ""}\n소제목: ${(site.headings ?? []).slice(0, 8).join(" / ")}\n본문: ${(site.bodySnippet ?? "").slice(0, 500)}`,
      });
      const category = object.category.trim();
      return category.length >= 4 && category.length <= 60 ? category : null;
    } catch {
      return null;
    }
  },
  async search(question) {
    // 순환 import 를 피하려고 필요할 때만 불러온다.
    const { queryEngine } = await import("./engines");
    const res = await queryEngine({
      engineId: "chatgpt",
      language: "ko",
      prompt: question,
    });
    return res.errorMessage || res.isStub || !res.rawResponse
      ? null
      : res.rawResponse;
  },
  async extract(answer) {
    const { extractListedBrands } = await import("./answer-brands");
    return extractListedBrands(answer);
  },
};

/**
 * 서비스 분야 질문을 웹 검색 엔진에 던져 실제 경쟁사 후보를 만든다. 실패·근거 없음이면 빈 배열(지어내지 않는다).
 * 호출: 분야 정리 1(Haiku) + 웹 검색 1(ChatGPT) + 이름 추출 1(Haiku) — 온보딩에서 브랜드당 1번.
 */
export async function suggestCompetitorsGrounded(
  input: {
    aliases?: readonly string[];
    brandName: string;
    domain: string;
    industry?: string | null;
    site: GroundedSite;
  },
  deps: GroundedDeps = defaultDeps
): Promise<string[]> {
  try {
    const category = await deps.categoryOf(input);
    if (!category) {
      return [];
    }
    const answer = await deps.search(
      `${category} 분야에서 많이 쓰는 유명한 서비스·브랜드를 5~8곳 알려줘`
    );
    if (!answer) {
      return [];
    }
    const brands = await deps.extract(answer);
    const stem = normalizeHost(input.domain).split(".")[0] ?? "";
    return filterCompetitorCandidates(brands ?? [], [
      input.brandName,
      ...(input.aliases ?? []),
      stem,
    ]);
  } catch (error) {
    log.warn("competitor.suggest.grounded_failed", {
      domain: input.domain,
      error: String(error),
    });
    return [];
  }
}
