// 언급 판정 v3 (2026-10-05) — 그림자 모드 전용. 점수·집계에는 아직 쓰지 않는다.
//
// 왜: 프란츠(franzskincare.com, AuditJob 4408fe00) 실측에서 v2 의 세 결함이 드러났다.
//   1. 「프란츠는 두 가지 주요 브랜드로 확인됩니다」처럼 **여러 동명 대상을 나열**한 답변이
//      우리 회사가 목록에 한 줄 있다는 이유로 confirmed 가 되거나, 같은 모양인데 unknown 이 됐다.
//      (한국어 어순 「브랜드가 여러 가지」를 v2 정규식이 못 잡고, 판정기 지시문은
//      「기준점으로 언급돼도 confirmed」라고 가르쳤다.)
//   2. 판정기는 앞 1,200자만 읽는데 근거 검사는 전문을 본다 → 범위 불일치.
//   3. 공식 형제 도메인(franzskincareusa.com)이 인용되면 「다른 회사」로 확정했다.
// 설계: docs/_적용/측정알고리즘_v3_설계안_20261005.md §2-④
//
// 분류: confirmed / different_entity / ambiguous(여러 대상 나열·되물음) / unknown_brand /
//   absent / unverified(판정기 장애). ambiguous 는 「제대로 앎」이 아니다 — 우리가 목록에
//   있어도 사용자는 어느 쪽인지 모른 채 답을 받는다.
//
// ⚠️ 이 모듈은 v2(mention-verdict.ts)의 결과를 바꾸지 않는다. 운영 전환은
//   그림자 기록 → 차이 사람 검토 → 버전 2→3 + 저장 답변 재판정 순서로만 한다.

import { log } from "@repo/observability/log";
import { generateObject } from "ai";
import { getDomain } from "tldts";
import { z } from "zod";
import { isAbortError } from "./engines/provider-error";
import {
  compactIdentity,
  hasOfficialIdentityEvidence,
  isOfficialDomain,
  mentionsOfficialDomain,
  normalizedHost,
  type VerifyInput,
  verdictModel,
} from "./mention-verdict";

export type MentionQualityV3 =
  | "confirmed"
  | "different_entity"
  | "ambiguous"
  | "unknown_brand"
  | "absent"
  | "unverified";

export type MentionVerdictReasonV3 =
  /** 답변이 어느 대상을 말하는지 되묻거나 「이름이 여러 대상에 쓰인다」고 밝힘. */
  | "clarification"
  /** 인용 출처가 같은 이름의 다른 도메인(형제 도메인 아님). */
  | "rival_domain"
  /** 판정기는 confirmed 라 했지만 공식 사실(도메인·상호·고유 토큰) 근거가 없음. */
  | "official_evidence_missing"
  | "judge_failed";

export interface MentionVerdictV3 {
  counted: boolean;
  /** 판정기가 근거로 든 답변 속 구절(관측·사람 검토용, 최대 200자). */
  evidence?: string;
  quality: MentionQualityV3;
  reason?: MentionVerdictReasonV3;
  via: "rule" | "llm" | "skipped";
}

/**
 * 「어느 대상인지 확정하지 못함」 신호. v2 의 UNRESOLVED_IDENTITY_RE 는 「여러 → 브랜드」
 * 어순만 잡아 실제 답변(「서비스나 브랜드가 여러 가지가 있어」「두 가지 주요 브랜드로
 * 확인됩니다」「어떤 프란츠를 말씀하시는지」)을 놓쳤다. 실측 문장을 그대로 고정해 테스트한다.
 *
 * ⚠️ 「If you mean X the messaging app…」처럼 한쪽을 골라 계속 설명하는 답변은 여기서
 *   잡지 않는다 — 그건 모호가 아니라 다른 대상을 고른 것(판정기가 different_entity 로 본다).
 */
const AMBIGUITY_RE = new RegExp(
  [
    // 한국어 — 이름/브랜드가 여러 대상에 쓰인다
    String.raw`(?:브랜드|서비스|이름|명칭|대상|회사|제품)[가이은는]?\s*(?:여러|몇)\s*(?:가지|개|곳)`,
    String.raw`(?:두|세|네|여러|몇)\s*(?:가지|개|곳)\s*(?:의\s*)?(?:주요\s*)?(?:브랜드|대상|서비스|회사|의미|뜻)`,
    String.raw`(?:이름|명칭)[은는을를]?[\s\S]{0,40}?(?:모두|둘\s*다|각각|여러\s*곳에서)\s*(?:사용|쓰)`,
    String.raw`어떤\s*[^\s?]{0,20}?\s*(?:을|를)?\s*(?:말씀|의미|뜻)하시`,
    String.raw`(?:말씀|의미)하시는\s*(?:것|건|게|브랜드|대상)`,
    String.raw`명확하지\s*않(?:습니다|아요|음)`,
    String.raw`(?:어느|어떤)\s*(?:쪽|분야|브랜드|대상)인지`,
    // 영어
    String.raw`(?:can|could|may)\s+refer\s+to\s+(?:several|multiple|different|a\s+few|two|various)`,
    String.raw`there\s+are\s+(?:several|multiple|two|a\s+few|various)\s+(?:different\s+)?(?:brands?|companies|products|entities|things)\s+(?:called|named)`,
    String.raw`which\s+(?:one|brand|company|\S+)\s+(?:do\s+)?you\s+(?:mean|are\s+referring)`,
    String.raw`could\s+you\s+(?:clarify|specify)`,
  ].join("|"),
  "i"
);

const LEGAL_SUFFIX_RE =
  /\(주\)|㈜|주식회사|\(유\)|유한회사|co\.?,?\s*ltd\.?|inc\.?|corp\.?/gi;

/** 「바이오센서연구소(주)」 → 「바이오센서연구소」. 너무 짧으면(3자 미만) 근거로 쓰지 않는다. */
function legalNameCore(legalName: string | null | undefined): string | null {
  const core = compactIdentity((legalName ?? "").replace(LEGAL_SUFFIX_RE, ""));
  return core.length >= 3 ? core : null;
}

function officialStem(brandDomain?: string): string {
  const host = brandDomain ? normalizedHost(brandDomain) : "";
  return compactIdentity(
    getDomain(host, { allowPrivateDomains: true })?.split(".")[0] ?? ""
  );
}

const SIBLING_MARKET_SUFFIXES = new Set([
  "us",
  "usa",
  "uk",
  "eu",
  "jp",
  "japan",
  "cn",
  "china",
  "kr",
  "korea",
  "tw",
  "hk",
  "sg",
  "vn",
  "th",
  "id",
  "my",
  "ph",
  "au",
  "ca",
  "de",
  "fr",
  "global",
  "intl",
  "international",
  "official",
]);

/**
 * 공식 도메인 이름으로 **시작하는** 다른 등록 도메인 — 해외 법인·지역몰일 가능성이 크다
 * (franzskincare.com ↔ franzskincareusa.com). 소유가 증명된 것은 아니므로 「공식」으로
 * 확정하지 않고, 「다른 회사」로 확정하지도 않는다 → 판정기가 내용으로 가른다.
 */
export function isSiblingDomainCandidate(
  domain: string,
  brandDomain?: string
): boolean {
  const stem = officialStem(brandDomain);
  if (stem.length < 5 || isOfficialDomain(domain, brandDomain)) {
    return false;
  }
  const candidate = compactIdentity(
    getDomain(normalizedHost(domain), { allowPrivateDomains: true })?.split(
      "."
    )[0] ?? ""
  );
  // 「공식 이름 + 국가·지역 표기」만 형제로 본다. 「findable + app」처럼 다른 단어가 붙은
  //   도메인은 실측된 동명 타사였다(findableapp.com) → 여기서 형제로 풀어 주면 안 된다.
  return (
    candidate.startsWith(stem) &&
    SIBLING_MARKET_SUFFIXES.has(candidate.slice(stem.length))
  );
}

/** 이름 토큰을 품은 **형제가 아닌** 다른 도메인이 인용됨 = 동명 타사 근거. */
export function hasRivalDomain(input: VerifyInput): boolean {
  const stem = officialStem(input.brandDomain);
  const brandToken = compactIdentity(input.brandName);
  const tokens = [brandToken, stem].filter((token) => token.length >= 5);
  if (tokens.length === 0) {
    return false;
  }
  return (input.citedDomains ?? []).some((domain) => {
    if (
      isOfficialDomain(domain, input.brandDomain) ||
      isSiblingDomainCandidate(domain, input.brandDomain)
    ) {
      return false;
    }
    const compact = compactIdentity(normalizedHost(domain));
    return tokens.some((token) => compact.includes(token));
  });
}

/** v3 근거: v2 근거 + 상호(법인명) 언급 + 형제 도메인 인용. */
export function hasOfficialEvidenceV3(input: VerifyInput): boolean {
  if (hasOfficialIdentityEvidence(input)) {
    return true;
  }
  const legal = legalNameCore(input.officialSite?.legalName);
  if (legal && compactIdentity(input.text).includes(legal)) {
    return true;
  }
  return (input.citedDomains ?? []).some((domain) =>
    isSiblingDomainCandidate(domain, input.brandDomain)
  );
}

export function detectAmbiguity(text: string): boolean {
  return AMBIGUITY_RE.test(text);
}

/** 판정 창 = 근거 창. v2 는 1,200자만 읽고 근거는 전문에서 찾아 서로 어긋났다. */
const V3_TEXT_LIMIT = 4000;

const VerdictSchemaV3 = z.object({
  quality: z.enum([
    "confirmed",
    "different_entity",
    "ambiguous",
    "unknown_brand",
    "absent",
  ]),
  evidence: z
    .string()
    .describe("판정의 근거가 된 답변 속 구절을 그대로 인용(200자 이내)."),
});

export function buildVerdictPromptV3(input: VerifyInput): string {
  const site = input.officialSite;
  const profile = [
    `대표 브랜드명: ${input.brandName}`,
    input.brandVariants?.length
      ? `등록된 표기: ${[input.brandName, ...input.brandVariants].join(" · ")}`
      : null,
    input.brandDomain ? `공식 도메인: ${input.brandDomain}` : null,
    site?.legalName ? `운영 회사(상호): ${site.legalName}` : null,
    input.industry ? `업종: ${input.industry}` : null,
    site?.siteName ? `공식 사이트명: ${site.siteName.slice(0, 180)}` : null,
    site?.title ? `공식 페이지 제목: ${site.title.slice(0, 240)}` : null,
    site?.description
      ? `공식 페이지 설명: ${site.description.slice(0, 500)}`
      : null,
    site?.h1 ? `공식 페이지 대표 문구: ${site.h1.slice(0, 300)}` : null,
    input.citedDomains?.length
      ? `답변 인용 도메인: ${input.citedDomains.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `AI 답변에 등록 브랜드의 이름이 나왔습니다. 그 이름이 **아래 대상 회사**를 가리키는지 판정하세요.

[대상 회사 프로필 — 공식 사이트에서 직접 읽은 사실]
${profile}

[AI 답변 전문]
${input.text.slice(0, V3_TEXT_LIMIT)}

분류(하나만):
- confirmed: 답변이 **대상 회사 하나로 특정**해서, 프로필과 맞는 구체적 사실(제품·업종·회사·도메인)로 설명한다.
  다른 브랜드를 추천·비교하는 글에서 대상 회사를 기준점으로 쓴 경우도, 대상이 하나로 특정돼 있으면 confirmed.
- ambiguous: 같은 이름의 대상을 **둘 이상 나열**하거나 「어느 쪽을 말하는지」 되묻고, 하나로 정하지 않는다.
  ⚠️ 나열 안에 대상 회사가 한 줄 들어 있어도 ambiguous 다(사용자는 어느 쪽인지 모른 채 답을 받는다).
- different_entity: 이름이 **다른 대상**(동명의 앱·회사·사람·작품·일반명사)을 가리킨다.
  「If you mean X the app…」처럼 한쪽을 골라 설명했는데 그게 대상 회사가 아니면 different_entity.
- unknown_brand: 대상 회사를 모른다 — 모른다고 하거나, 이름만 반복하며 업종 일반론·근거 없는 내용을 지어낸다.
- absent: 이름이 실제로 없다(거의 고르지 마세요).

evidence 에는 판정 근거가 된 답변 구절을 그대로 옮기세요.`;
}

async function llmVerdictV3(
  input: VerifyInput
): Promise<{ evidence: string; quality: MentionQualityV3 } | null> {
  try {
    const { object } = await generateObject({
      model: await verdictModel(),
      schema: VerdictSchemaV3,
      prompt: buildVerdictPromptV3(input),
      temperature: 0,
      abortSignal: input.signal,
    });
    return { quality: object.quality, evidence: object.evidence.slice(0, 200) };
  } catch (error) {
    if (isAbortError(error) || input.signal?.aborted) {
      throw error;
    }
    log.warn("mention.verdict_v3.llm_failed", { brandName: input.brandName });
    return null;
  }
}

export async function verifyMentionV3(
  input: VerifyInput & { stringMatched: boolean }
): Promise<MentionVerdictV3> {
  if (!input.stringMatched) {
    return { counted: false, quality: "absent", via: "rule" };
  }
  // 공식 도메인을 스스로 적어 대상을 특정한 답변은 되묻는 문구가 있어도 판정기에 넘긴다.
  if (
    detectAmbiguity(input.text) &&
    !mentionsOfficialDomain(input.text, input.brandDomain)
  ) {
    return {
      counted: false,
      quality: "ambiguous",
      reason: "clarification",
      via: "rule",
    };
  }
  const officialCited = (input.citedDomains ?? []).some((domain) =>
    isOfficialDomain(domain, input.brandDomain)
  );
  if (
    hasRivalDomain(input) &&
    !officialCited &&
    !mentionsOfficialDomain(input.text, input.brandDomain)
  ) {
    return {
      counted: false,
      quality: "different_entity",
      reason: "rival_domain",
      via: "rule",
    };
  }
  if (input.signal?.aborted) {
    throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  const judged = await llmVerdictV3(input);
  if (!judged) {
    return {
      counted: false,
      quality: "unverified",
      reason: "judge_failed",
      via: "skipped",
    };
  }
  if (
    judged.quality === "confirmed" &&
    input.officialSite &&
    !hasOfficialEvidenceV3(input)
  ) {
    return {
      counted: false,
      evidence: judged.evidence,
      quality: "unknown_brand",
      reason: "official_evidence_missing",
      via: "llm",
    };
  }
  return {
    counted: judged.quality === "confirmed",
    evidence: judged.evidence,
    quality: judged.quality,
    via: "llm",
  };
}

/** 그림자 기록 스위치 — 기본 off. 켜면 판정기 호출이 이름이 나온 답변 수만큼 늘어난다. */
export function isVerdictV3ShadowEnabled(): boolean {
  return process.env.MENTION_VERDICT_V3_SHADOW === "true";
}
