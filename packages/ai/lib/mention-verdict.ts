// 언급 품질 판정 (2026-07-31 세션K) — 측정 정확도의 핵심 레이어.
//
// 배경: 판정이 `text.indexOf(brandName)` 하나였다. 라이브 실측에서 3종류 오판정이 확인됨:
//   A. 동명이인   — kia.com 측정에 "푸에기아(향수)"·"기아 타이거즈(야구단)"가 언급으로 잡힘
//   B. 미인지     — forget.sh 측정에서 AI가 영어 단어 "forget" 뜻풀이를 했는데 언급으로 잡힘
//   C. 되물음/회피 — "무슨 의미의 기아를 원하시나요?"가 언급으로 잡힘
// → 세 경우 모두 SoV·GEO 점수를 부풀린다(무명 브랜드가 나이키와 같은 점수를 받은 원인).
//
// 설계 근거(경쟁사·학술 리서치 2026-07-31, docs/_적용/측정정확도_전면진단_2026-07-31.md):
//   · 상용 툴 12곳 중 이 문제의 해법을 공개한 곳 0곳. Ahrefs "string matches"·Scrunch
//     "pattern matching"·daydream "exact whole-word matching"으로 자기 문서에서 인정.
//     업계 관행인 alias 등록은 누락(FN)만 줄이고 오탐(FP)은 못 줄이는 비대칭 처리.
//   · ZELDA(EACL 2023): 가려진 엔티티에서 단순 매칭 정확도 0.149(=85% 오답).
//     순진한 LLM zero-shot도 0.746에 그치고, 후보+객관식+NIL을 붙여야 0.920(EntGPT).
//     → 그래서 yes/no 가 아니라 **분류 + "판단 불가" 선택지**로 묻는다.
//   · ARTER(EMNLP 2025): 모호한 것만 LLM 라우팅 → 토큰 58% 절감.
//     → 명확한 경우는 규칙으로 끝내고, 애매한 것만 LLM에 보낸다(원가 보호).
//
// ⚠️ 이 모듈은 "언급을 더 엄격하게" 만든다. 즉 SoV·GEO 점수가 전반적으로 내려간다.
//    그게 의도다 — 기존 점수가 부풀려져 있었다.

import { createOpenAI } from "@ai-sdk/openai";
import { log } from "@repo/observability/log";
import { generateObject } from "ai";
import { z } from "zod";

const LETSUR_VERDICT_MODEL_ID =
  process.env.FINDABLE_CREW_LETSUR_MODEL ?? "claude-haiku-4-5-20251001";

async function verdictModel() {
  const letsurKey = process.env.LETSUR_API_KEY;
  if (letsurKey) {
    const letsur = createOpenAI({
      baseURL: "https://gw.letsur.ai/v1",
      apiKey: letsurKey,
    });
    return letsur(LETSUR_VERDICT_MODEL_ID);
  }
  // `models` reads server-only API keys at module evaluation time. Load it only
  // when an ambiguous response really needs an LLM verdict; pure rule tests and
  // clear-brand measurements should not require model credentials.
  const { models } = await import("./models");
  return models.chat;
}

/**
 * 언급의 질. brandMentioned(boolean) 하나로는 표현할 수 없던 구분을 명시한다.
 *   confirmed — AI가 이 브랜드를 실제로 인지하고 서술함(= 진짜 언급)
 *   different_entity — 같은 이름의 다른 대상(동명이인·부분 문자열)
 *   unknown_brand — AI가 브랜드를 모름. 일반명사 해석·되물음·"모른다" 응답
 *   absent — 브랜드 문자열 자체가 없음
 */
export type MentionQuality =
  | "confirmed"
  | "different_entity"
  | "unknown_brand"
  | "absent";

export interface MentionVerdict {
  /** 점수·SoV에 실제로 반영할 최종 판정. confirmed 만 true. */
  counted: boolean;
  quality: MentionQuality;
  /** 판정 경로(관측용). rule=규칙만으로 확정, llm=모호해서 LLM 판정, skipped=검증 미실행. */
  via: "rule" | "llm" | "skipped";
}

// ─────────────────────────────────────────────────────────
// 1단계: 규칙 — 명확한 것은 LLM 없이 끝낸다(원가·지연 보호)
// ─────────────────────────────────────────────────────────

/**
 * 되물음·모호성 호소 신호. AI가 "무엇을 말하는지 모르겠다"고 되묻는 답변은
 * 브랜드를 인지했다는 증거가 아니다(오히려 반대 증거).
 * 실측: 무명·모호 브랜드 25~32% vs 명확한 대기업 7~14%로 분리됨.
 */
const CLARIFICATION_RE =
  /(무슨|어떤|어느)\s*(의미|뜻|종류|분야|브랜드|것|걸|거)|무엇을\s*(의미|뜻)|알려주시면|말씀해\s*주시면|어떤 걸|더 구체적으로|(?:두|여러)\s*가지\s*(뜻|의미)|which .{0,20}(do you mean|are you)|could you (clarify|specify)|what kind of .{0,20}\?/i;

/** AI가 명시적으로 모른다고 말하는 신호. */
const UNKNOWN_RE =
  /(들어본 적|알지 못|찾을 수 없|정보가 없|확인되지 않|잘 모르|알려진 바가 없)|(don't|do not) have (any )?(information|knowledge)|(i'm|i am) not (familiar|aware)|no information (about|on)|couldn't find/i;

/**
 * 브랜드명이 일반 단어인지(=B 유형 위험). 사전이 아니라 형태로 판정한다:
 * 영문 단문 소문자 단어("forget")는 일반명사일 가능성이 높다.
 * ⚠️ 이건 "모호 후보"를 고르는 신호일 뿐, 그 자체로 미인지 판정을 하지 않는다.
 */
const COMMON_WORD_RE = /^[a-z]{3,12}$/;

/** 한글 2~3글자 브랜드는 다른 단어에 섞여들 위험이 크다("기아"⊂"푸에기아", "현대"⊂"현대적"). */
const SHORT_HANGUL_RE = /^[가-힣]{2,3}$/;

/**
 * 이름이 같기 쉬운 **대상 유형** 신호.
 *
 * 긴 한글 이름은 예전 규칙에서 곧바로 confirmed 처리됐다. 실제로
 * `인디고차일드`는 영어학원·노래·웹툰 설명이 모두 브랜드 인지로 집계됐다.
 * 길이는 엔티티 고유성의 증거가 아니므로, 답변이 다른 대상 유형을 명시하면
 * 업종·도메인을 함께 보는 LLM 판정으로 보낸다.
 */
const ENTITY_AMBIGUITY_RE =
  /(영어\s*학원|학원|교육\s*(기관|콘텐츠)|유치원|학교|대학|노래|음원|앨범|곡|웹툰|만화|영화|드라마|소설|작품|캐릭터|선수|인물|지명|아동복|유아용품|키즈\s*패션|의류|쇼핑몰|가상화폐|암호화폐|NFT|academy|school|kindergarten|song|album|webtoon|comic|film|novel|character|athlete|place name|kids?\s*(fashion|apparel)|baby\s*(goods|products?)|cryptocurrency)/i;

/** 질문의 전제를 사실처럼 되풀이한 뒤 업종 일반론만 말하는 환각 신호. */
const UNSUPPORTED_KNOWLEDGE_RE =
  /(로|으로)\s*알려져\s*있(습니다|어요)[\s\S]{0,180}?(보통\s*(이런|이러한)|일반적으로)|(?:is|are)\s+(?:known|described)\s+as[\s\S]{0,180}?(generally|typically)/i;

/** 이름은 보이지만 어느 동명 대상을 뜻하는지 답변 스스로 확정하지 못한 신호. */
const UNRESOLVED_IDENTITY_RE =
  /(?:can|could|may)\s+refer\s+to[\s\S]{0,100}?(?:different|several|multiple|few)|refers?\s+to\s+(?:a\s+few|several|multiple)\s+(?:different\s+|distinct\s+)?(?:entities|products?|brands?|services?)|which\s+one\s+you\s+mean|(?:여러|몇)\s*(?:가지|개의)?\s*(?:다른|동명)?\s*(?:대상|브랜드|서비스|제품)|어느\s*(?:것|브랜드|서비스)을?\s*(?:뜻|의미)/i;

function mentionsOfficialDomain(text: string, brandDomain?: string): boolean {
  if (!brandDomain) {
    return false;
  }
  const domain = brandDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
  return domain.length > 0 && text.toLowerCase().includes(domain);
}

function normalizedHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
}

function compactIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
}

const IDENTITY_TOKEN_STOPWORDS = new Set([
  "브랜드",
  "서비스",
  "사이트",
  "공식",
  "주요",
  "제공",
  "확인",
  "오늘",
  "이번",
  "전국",
  "지역",
  "무료",
  "주말",
  "the",
  "and",
  "for",
  "with",
  "official",
  "service",
]);
const KOREAN_PARTICLE_SUFFIX_RE = /(?:에서|으로|에게|부터|까지|처럼|보다|은|는|이|가|을|를|과|와|도|로|의)$/;

function identityTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/)
    .map((token) => token.replace(KOREAN_PARTICLE_SUFFIX_RE, ""))
    .filter(
      (token) =>
        token.length >= 2 &&
        !IDENTITY_TOKEN_STOPWORDS.has(token) &&
        !/^\d+$/.test(token)
    );
}

/**
 * LLM이 `confirmed`라고 해도 공식 사이트의 고유 사실이 답변에 실제로 있어야 한다.
 * 도메인 직접 언급/인용은 강한 근거이고, 그 외에는 title·description·H1의 서로 다른
 * 고유 토큰이 최소 2개 일치해야 한다. 이름만 넣은 업종 일반론·환각은 여기서 탈락한다.
 */
function hasOfficialIdentityEvidence(input: VerifyInput): boolean {
  if (!input.officialSite) {
    return false;
  }
  if (mentionsOfficialDomain(input.text, input.brandDomain)) {
    return true;
  }
  const officialHost = input.brandDomain
    ? normalizedHost(input.brandDomain)
    : "";
  if (
    officialHost &&
    (input.citedDomains ?? []).some((domain) => {
      const cited = normalizedHost(domain);
      return cited === officialHost || cited.endsWith(`.${officialHost}`);
    })
  ) {
    return true;
  }

  const brandToken = compactIdentity(input.brandName);
  const tokens = new Set(
    [
      input.officialSite.title,
      input.officialSite.description,
      input.officialSite.h1,
    ]
      .filter((value): value is string => Boolean(value))
      .flatMap(identityTokens)
      .filter((token) => compactIdentity(token) !== brandToken)
  );
  const response = input.text.toLowerCase();
  let matches = 0;
  for (const token of tokens) {
    if (response.includes(token)) {
      matches += 1;
      if (matches >= 2) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 공식 도메인은 인용되지 않았는데, 인용 출처가 같은 이름의 **다른 도메인**인 경우.
 *
 * 업종까지 같은 동명 서비스는 답변 문장만 보고는 구별할 수 없다. 실측에서
 * findable.ai/findableapp.com/find-ables.com을 근거로 만든 답변이 findable.co.kr의
 * 언급으로 통과했다. 출처가 이 충돌을 명시적으로 드러내면 LLM 추측보다 우선해
 * 보수적으로 다른 엔티티로 처리한다.
 */
function hasConflictingBrandDomain(input: {
  brandDomain?: string;
  brandName: string;
  citedDomains?: string[];
}): boolean {
  const official = input.brandDomain ? normalizedHost(input.brandDomain) : "";
  const cited = (input.citedDomains ?? []).map(normalizedHost).filter(Boolean);
  if (!(official && cited.length)) {
    return false;
  }
  if (cited.some((domain) => domain === official || domain.endsWith(`.${official}`))) {
    return false;
  }

  const brandToken = compactIdentity(input.brandName);
  if (brandToken.length < 5) {
    return false;
  }
  return cited.some((domain) => compactIdentity(domain).includes(brandToken));
}

function isShortHangul(name: string): boolean {
  return SHORT_HANGUL_RE.test(name.trim());
}

/**
 * 문자열이 일치한 응답은 이름 형태와 무관하게 엔티티 판정을 거친다.
 *
 * 과거에는 이름 길이·문자 종류·일부 동명이인 정규식으로 LLM 호출을 줄였지만,
 * 그 목록 밖의 대상은 곧바로 confirmed가 됐다. `Findable` 오탐은 그 구조에서
 * 나온 것이므로 규칙을 계속 늘리는 대신 이 우회 경로를 없앤다. 이 함수는
 * `stringMatched=true`인 경우에만 호출되므로, 이름이 없는 응답에는 비용이 들지 않는다.
 */
function needsVerification(_brandName: string, _text: string): boolean {
  return true;
}

// ─────────────────────────────────────────────────────────
// 2단계: LLM 판정 — 객관식 + "판단 불가"(NIL). yes/no 로 묻지 않는다.
// ─────────────────────────────────────────────────────────

const VerdictSchema = z.object({
  quality: z
    .enum(["confirmed", "different_entity", "unknown_brand", "absent"])
    .describe(
      "confirmed: 답변이 이 브랜드(해당 업종/도메인의 그 회사)를 실제로 인지하고 서술함. " +
        "different_entity: 같은 이름이 나오지만 다른 대상(동명의 사람·지명·다른 업종 브랜드·일반명사의 일부). " +
        "unknown_brand: 브랜드를 모름 — 일반 단어로 해석했거나, 무엇을 묻는지 되물었거나, 모른다고 답함. " +
        "absent: 브랜드가 답변에 등장하지 않음."
    ),
});

/** 판정에 넣을 답변 길이 상한 — 토큰·지연 보호. 앞부분에 판단 근거가 몰려 있다. */
const VERDICT_TEXT_LIMIT = 1200;

interface VerifyInput {
  /** 브랜드 도메인 — 어떤 엔티티인지 특정하는 가장 강한 단서. */
  brandDomain?: string;
  brandName: string;
  /** 엔진이 실제 근거로 제시한 출처 도메인. 동명·동업종 서비스 분별에 사용. */
  citedDomains?: string[];
  /** 업종(있으면 동명이인 분별에 크게 도움). */
  industry?: string;
  /** 공식 홈페이지에서 직접 읽은 엔티티 단서. 판정의 기준 사실로만 사용한다. */
  officialSite?: {
    description?: string | null;
    finalUrl?: string;
    h1?: string | null;
    siteName?: string | null;
    title?: string | null;
  } | null;
  text: string;
}

async function llmVerdict(input: VerifyInput): Promise<MentionQuality | null> {
  const {
    brandName,
    brandDomain,
    citedDomains,
    industry,
    officialSite,
    text,
  } = input;
  const identity = [
    `브랜드명: ${brandName}`,
    brandDomain ? `공식 도메인: ${brandDomain}` : null,
    industry ? `업종: ${industry}` : null,
    officialSite?.siteName
      ? `공식 사이트명: ${officialSite.siteName.slice(0, 180)}`
      : null,
    officialSite?.title
      ? `공식 페이지 제목: ${officialSite.title.slice(0, 240)}`
      : null,
    officialSite?.description
      ? `공식 페이지 설명: ${officialSite.description.slice(0, 500)}`
      : null,
    officialSite?.h1
      ? `공식 페이지 대표 문구: ${officialSite.h1.slice(0, 300)}`
      : null,
    citedDomains?.length
      ? `답변 인용 도메인: ${citedDomains.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const { object } = await generateObject({
      model: await verdictModel(),
      schema: VerdictSchema,
      prompt: `AI 답변에 "${brandName}"라는 표현이 등장합니다.
그 표현이 **아래 대상 브랜드를 가리키는지**, 그리고 AI가 그 브랜드를 알고 있는지 판정하세요.

[대상 브랜드]
${identity}

[AI 답변]
${text.slice(0, VERDICT_TEXT_LIMIT)}

판정 기준:
- 위 공식 사이트 정보는 **대상 엔티티를 특정하는 기준 사실**이다. AI 답변이 공식 정보와
  다른 업종·제품·서비스·소유관계·작품을 설명하면 이름이 정확히 같아도 confirmed가 아니다.
- confirmed: 그 표현이 대상 브랜드를 가리키며, 공식 정보와 양립 가능한 구체적 사실로
  AI가 그 브랜드를 실제로 아는 것이 확인된다.
  ⚠️ **답변의 주제가 브랜드가 아니어도 confirmed 다.** 경쟁사를 나열하면서 기준점으로
  언급하는 경우("${brandName} 말고 다른 브랜드는…", "${brandName}와 같은 카테고리의 브랜드는…")도
  브랜드를 정확히 인지한 것이므로 confirmed.
- different_entity: 그 글자가 대상 브랜드가 아닌 **다른 것**을 가리킨다 — 동명의 사람·지명·
  작품·다른 업종의 브랜드이거나, 더 긴 단어의 일부일 뿐인 경우(예: "기아"가 향수 "푸에기아"의
  일부, "기아" 야구단, "forget"이 영어 단어 '잊다'의 뜻).
- unknown_brand: 그 브랜드를 모르는 정황이다 — 무엇을 말하는지 되묻거나, 모른다고 하거나,
  이름만 반복하거나 질문의 전제를 받아 업종 일반론·근거 없는 기능을 만들어낼 뿐
  그 브랜드에 대한 실제 정보가 없다.
- absent: 답변에 그 표현이 실제로 존재하지 않는다. (**웬만하면 고르지 마세요** — 표현이
  있다는 전제로 판정을 요청한 것입니다.)

핵심: "이 답변이 브랜드를 소개하는 글인가"가 아니라, "여기 나온 이 이름이 그 브랜드가 맞는가"를
판정하세요. 언급 방식(주제/비교대상/스쳐지나감)은 상관없습니다.`,
      temperature: 0,
    });
    return object.quality;
  } catch (error) {
    log.warn("mention.verdict.llm_failed", {
      brandName,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ─────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────

/**
 * 문자열 매칭 결과(stringMatched)를 받아 언급의 질을 판정한다.
 *
 * 라우팅:
 *   · 문자열이 없으면 → absent (LLM 호출 0)
 *   · 모호하지 않으면 → confirmed (기존 동작 유지, LLM 호출 0)
 *   · 모호하면        → LLM 판정 (실패 시 집계에서 제외)
 *
 * 모호 응답은 검증 장애 시 **보수적으로 제외**한다. 측정 작업은 완료하되,
 * 오탐을 확정 언급으로 부풀리지 않는다.
 */
export async function verifyMention(
  input: VerifyInput & { stringMatched: boolean }
): Promise<MentionVerdict> {
  if (!input.stringMatched) {
    return { counted: false, quality: "absent", via: "rule" };
  }

  // 답변이 스스로 여러 동명 후보 중 어느 것인지 모른다고 밝히면 브랜드 인지로
  // 부풀리지 않는다. 단, 공식 도메인을 실제로 적어 대상을 특정한 경우는 LLM이
  // 설명의 정확성까지 판정하도록 넘긴다.
  if (
    UNRESOLVED_IDENTITY_RE.test(input.text) &&
    !mentionsOfficialDomain(input.text, input.brandDomain)
  ) {
    return { counted: false, quality: "unknown_brand", via: "rule" };
  }

  if (hasConflictingBrandDomain(input)) {
    return { counted: false, quality: "different_entity", via: "rule" };
  }

  if (!needsVerification(input.brandName, input.text)) {
    return { counted: true, quality: "confirmed", via: "rule" };
  }

  const quality = await llmVerdict(input);
  if (quality === null) {
    // LLM 실패 → 측정은 완료하되 모호 응답을 성공으로 계산하지 않는다.
    return { counted: false, quality: "unknown_brand", via: "skipped" };
  }

  if (quality === "confirmed" && input.officialSite) {
    if (!hasOfficialIdentityEvidence(input)) {
      return { counted: false, quality: "unknown_brand", via: "llm" };
    }
  }

  return { counted: quality === "confirmed", quality, via: "llm" };
}

/** 테스트·오프라인 분석용 — LLM 없이 규칙만으로 모호 여부를 본다. */
export const __internal = {
  needsVerification,
  CLARIFICATION_RE,
  UNKNOWN_RE,
  ENTITY_AMBIGUITY_RE,
  UNSUPPORTED_KNOWLEDGE_RE,
  UNRESOLVED_IDENTITY_RE,
  hasConflictingBrandDomain,
  hasOfficialIdentityEvidence,
  mentionsOfficialDomain,
};

// ─────────────────────────────────────────────────────────
// 러너용 일괄 적용
// ─────────────────────────────────────────────────────────

/** verifyMention 이 다룰 수 있는 최소 응답 형태(구조적 타이핑 — @repo/audit 역의존 회피). */
export interface VerifiableResponse {
  brandMentioned: boolean;
  citedSources?: Array<{ domain?: string; url?: string }>;
  errorMessage: string | null;
  isStub?: boolean;
  mentionPosition?: number | null;
  rawResponse: string;
}

/**
 * LLM 판정 동시 실행 상한 — 한 측정에서 모호 응답이 다수면 레이트리밋·지연이 커진다.
 * 프롬프트 8 × 엔진 7 = 최대 56행이지만, 실제로 LLM까지 가는 건 모호한 소수다.
 */
const VERDICT_CONCURRENCY = 6;

/**
 * 엔진 응답 배열에 언급 품질 검증을 일괄 적용해 `brandMentioned` 를 교정한다.
 * 오류·stub 응답은 건너뛴다(그 자체가 측정 실패이지 미언급이 아니다 — D5 원칙과 동일).
 *
 * 반환은 새 배열이며 원본을 변형하지 않는다. quality/via 는 관측용으로 함께 실어 보낸다.
 */
export async function verifyMentions<T extends VerifiableResponse>(
  responses: T[],
  brand: {
    brandName: string;
    brandDomain?: string;
    industry?: string;
    officialSite?: VerifyInput["officialSite"];
  }
): Promise<Array<T & { mentionQuality: MentionQuality; verdictVia: string }>> {
  const out: Array<T & { mentionQuality: MentionQuality; verdictVia: string }> =
    new Array(responses.length);

  // 인덱스를 청크로 끊어 동시 실행 상한을 지킨다.
  for (let start = 0; start < responses.length; start += VERDICT_CONCURRENCY) {
    const slice = responses.slice(start, start + VERDICT_CONCURRENCY);
    const verdicts = await Promise.all(
      slice.map((r): Promise<MentionVerdict> => {
        // 측정 실패/stub 은 판정 대상 아님 — 원본 유지.
        if (r.errorMessage || r.isStub) {
          return Promise.resolve({
            counted: r.brandMentioned,
            quality: "absent" as MentionQuality,
            via: "skipped" as const,
          });
        }
        return verifyMention({
          brandName: brand.brandName,
          brandDomain: brand.brandDomain,
          citedDomains: (r.citedSources ?? [])
            .map((source) => source.domain ?? source.url ?? "")
            .filter(Boolean),
          industry: brand.industry,
          officialSite: brand.officialSite,
          text: r.rawResponse ?? "",
          stringMatched: r.brandMentioned,
        });
      })
    );

    for (const [i, verdict] of verdicts.entries()) {
      const original = slice[i] as T;
      out[start + i] = {
        ...original,
        brandMentioned: verdict.counted,
        mentionPosition: verdict.counted ? original.mentionPosition : null,
        mentionQuality: verdict.quality,
        verdictVia: verdict.via,
      };
    }
  }

  // 판정 분포 관측(2026-08-03 세션N) — 이 판정은 계산·과금까지 하고 **아무 곳에도
  //   기록되지 않았다**(로그는 llm_failed 하나뿐). 그래서 `different_entity`(오인)가
  //   실제로 몇 건 나는지 알 수 없었고, 표본 1(클로드)로 UI 를 설계할 위험이 있었다.
  //   여기서 브랜드별 1줄만 남긴다 — 응답당 로그는 측정 1건에 22~28줄이라 과하다.
  //   via 분포도 함께: rule 만 나오면 게이트가 오인을 못 잡고 있다는 신호다
  //   (오인 답변은 되묻지도 모른다고도 하지 않아 텍스트 정규식에 안 걸린다 →
  //    브랜드명 형태만으로 게이트를 통과해야 하고, 4글자 이상 한글은 통과하지 못한다).
  const dist = {
    confirmed: 0,
    different_entity: 0,
    unknown_brand: 0,
    absent: 0,
  };
  const viaDist = { rule: 0, llm: 0, skipped: 0 };
  for (const r of out) {
    dist[r.mentionQuality] += 1;
    viaDist[r.verdictVia as keyof typeof viaDist] += 1;
  }
  log.info("mention.verdict.distribution", {
    brandName: brand.brandName,
    industry: brand.industry ?? null,
    total: out.length,
    ...dist,
    viaRule: viaDist.rule,
    viaLlm: viaDist.llm,
    viaSkipped: viaDist.skipped,
  });

  return out;
}
