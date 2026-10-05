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

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { log } from "@repo/observability/log";
import { generateObject } from "ai";
import { getDomain } from "tldts";
import { z } from "zod";
import { describeProviderError, isAbortError } from "./engines/provider-error";
import { detectBrandMention } from "./engines/utils";

export { MENTION_VERDICT_VERSION } from "./mention-verdict-version";

const LETSUR_VERDICT_MODEL_ID =
  process.env.FINDABLE_CREW_LETSUR_MODEL ?? "claude-haiku-4-5-20251001";

export async function verdictModel() {
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
 *   unverified — 답변에는 이름이 있으나 판정 서비스 장애(시간초과·오류)로 확인하지 못함.
 *                ⚠️ 「근거가 약함」이 아니라 **판정기 자체가 실패**한 경우에만 쓴다.
 *                (2026-09-28) 근거 부족까지 여기에 섞이면 잠정 결과가 폭증한다.
 */
export type MentionQuality =
  | "confirmed"
  | "different_entity"
  | "unknown_brand"
  | "absent"
  | "unverified";

export interface MentionVerdict {
  /** 점수·SoV에 실제로 반영할 최종 판정. confirmed 만 true. */
  counted: boolean;
  /**
   * 공식 홈페이지를 못 읽어 근거 검사 없이 판정기를 믿은 confirmed(2026-10-06, 무신사 REDIRECT_FAILED).
   * 화면 표시는 사용자 승인 전이라 데이터 플래그로만 남긴다.
   */
  officialProfileUnavailable?: true;
  quality: MentionQuality;
  /** 비집계 판정의 사유(관측·재검증용). 없으면 quality 자체가 사유다. */
  reason?: MentionVerdictReason;
  /** 판정 경로(관측용). rule=규칙만으로 확정, llm=모호해서 LLM 판정, skipped=검증 미실행. */
  via: "rule" | "llm" | "skipped";
}

export type MentionVerdictReason =
  /** LLM이 confirmed라 했지만 공식 사이트 고유 사실·도메인 근거가 답변에 없음. */
  | "official_evidence_missing"
  /** 판정기(LLM) 호출이 재시도·폴백까지 모두 실패함. */
  | "judge_failed";

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

const URL_SCHEME_PREFIX_RE = /^https?:\/\//;
const WWW_PREFIX_RE = /^www\./;
const URL_PATH_SPLIT_RE = /[/?#]/;
const IDENTITY_TOKEN_SPLIT_RE = /[^a-z0-9가-힣]+/;
const ASCII_LETTER_RE = /[a-z]/;
const DIGITS_ONLY_RE = /^\d+$/;
const LONG_HANGUL_NAME_RE = /^[가-힣]{4,}$/;

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

export function mentionsOfficialDomain(
  text: string,
  brandDomain?: string
): boolean {
  if (!brandDomain) {
    return false;
  }
  const domain = brandDomain
    .trim()
    .toLowerCase()
    .replace(URL_SCHEME_PREFIX_RE, "")
    .replace(WWW_PREFIX_RE, "")
    .split(URL_PATH_SPLIT_RE)[0];
  return (
    domain.length > 0 &&
    [
      ...text.matchAll(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?/gi),
    ].some(([candidate]) => isOfficialDomain(candidate, domain))
  );
}

export function normalizedHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(URL_SCHEME_PREFIX_RE, "")
    .replace(WWW_PREFIX_RE, "")
    .split(URL_PATH_SPLIT_RE)[0];
}

export function compactIdentity(value: string): string {
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
  // 홈페이지 상투어는 동명이사 판별 근거가 아니다. 특히 "회사·기술·기업"은
  // IT/클라우드 일반론에도 흔하게 나타나므로 두 개만 겹쳐도 confirmed가 되는
  // 오분류를 만든다. 고유한 설명 또는 공식 출처가 필요하다.
  "회사",
  "기업",
  "기술",
  "코드",
  "대표님",
  "무엇",
  "실력",
  "서비스를",
  "제공하는",
  "클라우드",
  "보안",
  "운영",
]);
const KOREAN_PARTICLE_SUFFIX_RE =
  /(?:에서|으로|에게|부터|까지|처럼|보다|은|는|이|가|을|를|과|와|도|로|의)$/;

function identityTokens(
  value: string,
  minLength = 4,
  asciiMinLength = Math.max(minLength, 5)
): string[] {
  return value
    .toLowerCase()
    .split(IDENTITY_TOKEN_SPLIT_RE)
    .map((token) => token.replace(KOREAN_PARTICLE_SUFFIX_RE, ""))
    .filter(
      (token) =>
        // 단독 2~3글자 낱말은 "기술·회사·실사"처럼 업종 일반론일 확률이 높다.
        // 공식 도메인 없이 엔티티를 확정하는 보조 증거는 충분히 구체적인 토큰만 쓴다.
        // 영문 4글자 단어(`halo`, `care`, `shop`)는 제목의 브랜드 표기 일부이거나
        // 일반 단어인 경우가 많다. 이것을 공식 사실로 쓰면 동명 브랜드 답변이
        // "Melt Halo"의 `Halo` 한 단어만으로 통과할 수 있다. 영문 보조 근거는
        // 최소 5글자로 제한하고, 짧은 제품명은 아래의 한국 제품 메타데이터 경로에서
        // 서로 다른 두 개가 맞을 때만 별도로 허용한다.
        token.length >=
          (ASCII_LETTER_RE.test(token) ? asciiMinLength : minLength) &&
        !IDENTITY_TOKEN_STOPWORDS.has(token) &&
        !DIGITS_ONLY_RE.test(token)
    );
}

/** 등록한 이름 또는 별칭의 일부는, 조사 제거 뒤에도 공식 사실로 세지 않는다. */
function isRegisteredNameFragment(token: string, input: VerifyInput): boolean {
  const compact = compactIdentity(token);
  if (!compact) {
    return true;
  }
  return registeredBrandNames(input)
    .map(compactIdentity)
    .some(
      (registered) =>
        registered.length >= compact.length && registered.includes(compact)
    );
}

/**
 * 한국어 고유 브랜드의 제품 답변은 공식 메타 설명에 3글자짜리 성분·제품군(NAD,
 * 마스크 등)으로 남는 경우가 많다. 긴 브랜드명 + LLM의 엔티티 판정 + 서로 다른
 * 공식 설명 토큰 두 개가 함께 맞을 때만 보조 근거로 허용한다.
 *
 * 단일 3글자 단어를 허용하면 동명이인 오판정이 되므로, 이 함수는 두 토큰을 요구하고
 * 영어·짧은 한글명에는 절대 적용하지 않는다.
 */
function hasKoreanProductMetadataEvidence(input: VerifyInput): boolean {
  if (!LONG_HANGUL_NAME_RE.test(input.brandName.trim())) {
    return false;
  }
  const description = input.officialSite?.description ?? "";
  const tokens = new Set(
    // NAD처럼 3글자 영문 성분도 두 개의 독립 제품 단서가 함께 맞을 때만 쓴다.
    identityTokens(description, 3, 3).filter(
      (token) => !isRegisteredNameFragment(token, input)
    )
  );
  let matches = 0;
  const response = input.text.toLowerCase();
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

/** 등록 도메인의 하위 서비스와 본사 도메인은 같은 공식 소유 범위로 본다. */
export function isOfficialDomain(
  domain: string,
  brandDomain?: string
): boolean {
  const official = brandDomain ? normalizedHost(brandDomain) : "";
  const candidate = normalizedHost(domain);
  return Boolean(
    official &&
      candidate &&
      getDomain(official, { allowPrivateDomains: true }) &&
      getDomain(official, { allowPrivateDomains: true }) ===
        getDomain(candidate, { allowPrivateDomains: true }) &&
      (candidate === official ||
        official.endsWith(`.${candidate}`) ||
        candidate.endsWith(`.${official}`))
  );
}

/** 「함께해요」「만들어요」 같은 슬로건의 서술어 끝 — 회사를 가르는 사실이 아니다. */
const PREDICATE_ENDING_RE = /(?:요|다|니다|세요|하자|해요)$/;
const LEGAL_SUFFIX_RE = /\(주\)|㈜|주식회사|\(유\)|유한회사/g;
/** 슬로건에 흔한 2글자 군말 — 회사를 가르지 못한다. */
const SLOGAN_FILLER = new Set([
  "하나",
  "모든",
  "우리",
  "함께",
  "가장",
  "최고",
  "지금",
  "마침내",
  "당신",
  "누구",
]);

/** 공식 프로필(title·description·H1)에서 엔티티를 가르는 고유 토큰. */
function officialProfileTokens(input: VerifyInput): Set<string> {
  const site = input.officialSite;
  const brandToken = compactIdentity(input.brandName);
  return new Set(
    [site?.title, site?.description, site?.h1]
      .filter((value): value is string => Boolean(value))
      // ⚠️ 2글자 명사는 근거로 받지 않는다(2026-10-06 컨트롤타워 검증): 「금융」⊂「금융권」,
      //   「결제」⊂「결제대행」처럼 업종 일반명사가 동명 타사 답변을 통과시켰다. 슬로건형 브랜드는
      //   토큰 대신 상호·사업자번호·공식 별칭 앵커(hasRegisteredEntityAnchor)로 푼다.
      .flatMap((value) => identityTokens(value))
      .filter((token) => {
        const compact = compactIdentity(token);
        // 조사 제거 과정에서 고유명사 끝 글자까지 떨어져 나올 수 있다
        // (예: `멜트헤일로` → `멜트헤일`). 등록명/별칭의 일부는 독립적인
        // 공식 사실이 아니므로, 그 자체로는 엔티티 근거가 될 수 없다.
        return (
          compact !== brandToken &&
          !isRegisteredNameFragment(token, input) &&
          !PREDICATE_ENDING_RE.test(token) &&
          !SLOGAN_FILLER.has(token)
        );
      })
  );
}

/**
 * 근거 없음 강등을 **요구할 수 있는** 프로필인가(2026-10-06 운영 실측).
 * - 홈페이지를 못 읽어 내용이 비면(무신사 REDIRECT_FAILED) 근거를 만들 재료가 없다.
 * - 슬로건뿐인 홈페이지(당근 24건 중 17건 강등)는 강등을 끄지 않고 앵커(상호·사업자번호·
 *   「당근마켓」 같은 공식 별칭)로 근거를 넓혀 푼다.
 * ⚠️ 「토큰이 적으면 강등 생략」은 쓰지 않는다 — TechDD(「정량 기술 실사」, 4글자 토큰 0)의
 *   해외 동명사를 거르는 이 강등이 실제로 필요했다(회귀 테스트 mention-entity-regression).
 */
export function canDemandOfficialEvidence(input: VerifyInput): boolean {
  const site = input.officialSite;
  return Boolean(
    site &&
      [site.title, site.description, site.h1, site.siteName].some((value) =>
        Boolean(value?.trim())
      )
  );
}

/**
 * 등록 정보로 엔티티를 특정하는 앵커:
 * ① 푸터 상호(「바이오센서연구소」) ② 사업자등록번호 ③ 등록명을 품은 더 긴 공식 별칭
 *   (「당근」 → 「당근마켓」). ③은 등록명 자체·짧은 별칭(「Franz」)은 받지 않는다.
 */
function hasRegisteredEntityAnchor(input: VerifyInput): boolean {
  const text = compactIdentity(input.text);
  const legal = compactIdentity(
    (input.officialSite?.legalName ?? "").replace(LEGAL_SUFFIX_RE, "")
  );
  if (legal.length >= 3 && text.includes(legal)) {
    return true;
  }
  const bizNo = input.officialSite?.businessNumber;
  if (bizNo && input.text.includes(bizNo)) {
    return true;
  }
  const brand = compactIdentity(input.brandName);
  return (input.brandVariants ?? []).some((variant) => {
    const v = compactIdentity(variant);
    return (
      brand.length >= 2 &&
      v.length > brand.length + 1 &&
      v.includes(brand) &&
      text.includes(v)
    );
  });
}

/**
 * LLM이 `confirmed`라고 해도 공식 사이트의 고유 사실이 답변에 실제로 있어야 한다.
 * 도메인 직접 언급/인용은 강한 근거이고, 그 외에는 title·description·H1의 서로 다른
 * 고유 토큰이 최소 2개 일치해야 한다. 이름만 넣은 업종 일반론·환각은 여기서 탈락한다.
 */
export function hasOfficialIdentityEvidence(input: VerifyInput): boolean {
  if (!input.officialSite) {
    return false;
  }
  if (mentionsOfficialDomain(input.text, input.brandDomain)) {
    return true;
  }
  if (hasRegisteredEntityAnchor(input)) {
    return true;
  }
  // Mixed-source lists may contain an unused official search candidate. Require
  // an independent textual anchor to the official owner in that case. This is
  // only a corroborating check AFTER the semantic verifier, never a verdict.
  const ownerToken = getDomain(normalizedHost(input.brandDomain ?? ""), {
    allowPrivateDomains: true,
  })?.split(".")[0];
  const hasOwnerAnchor = Boolean(
    ownerToken &&
      ownerToken.length >= 4 &&
      input.text.toLowerCase().includes(ownerToken)
  );
  if (
    (!hasConflictingBrandDomain(input) || hasOwnerAnchor) &&
    (input.citedDomains ?? []).some((domain) => {
      return isOfficialDomain(domain, input.brandDomain);
    })
  ) {
    return true;
  }

  const tokens = officialProfileTokens(input);
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
  return hasKoreanProductMetadataEvidence(input);
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
  const brandToken = compactIdentity(input.brandName);
  const officialDomain = getDomain(official, { allowPrivateDomains: true });
  const officialStem = compactIdentity(officialDomain?.split(".")[0] ?? "");
  const identityTokens = [brandToken, officialStem].filter(
    (token) => token.length >= 5
  );
  if (identityTokens.length === 0) {
    return false;
  }
  return cited.some(
    (domain) =>
      !isOfficialDomain(domain, input.brandDomain) &&
      identityTokens.some((token) => compactIdentity(domain).includes(token))
  );
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

export interface VerifyInput {
  /** 브랜드 도메인 — 어떤 엔티티인지 특정하는 가장 강한 단서. */
  brandDomain?: string;
  brandName: string;
  /** 고객이 확인한 한글·영문·현지 표기. 탐지와 판별이 같은 사전을 사용해야 한다. */
  brandVariants?: string[];
  /** 엔진이 실제 근거로 제시한 출처 도메인. 동명·동업종 서비스 분별에 사용. */
  citedDomains?: string[];
  /** 업종(있으면 동명이인 분별에 크게 도움). */
  industry?: string;
  /** 공식 홈페이지에서 직접 읽은 엔티티 단서. 판정의 기준 사실로만 사용한다. */
  officialSite?: {
    /** 푸터 사업자등록번호. 판정 v3 근거 전용(v2 판정·프롬프트는 읽지 않는다). */
    businessNumber?: string | null;
    description?: string | null;
    finalUrl?: string;
    h1?: string | null;
    /** 푸터 상호(법인명). 판정 v3 근거 전용(v2 판정·프롬프트는 읽지 않는다). */
    legalName?: string | null;
    siteName?: string | null;
    title?: string | null;
  } | null;
  signal?: AbortSignal;
  text: string;
}

function registeredBrandNames(input: VerifyInput): string[] {
  return [...new Set([input.brandName, ...(input.brandVariants ?? [])])]
    .map((name) => name.trim())
    .filter(Boolean);
}

function matchedBrandNames(input: VerifyInput): string[] {
  const normalizedText = input.text.toLowerCase();
  return registeredBrandNames(input).filter((name) =>
    normalizedText.includes(name.toLowerCase())
  );
}

function buildVerdictPrompt(input: VerifyInput): string {
  const { brandName, brandDomain, citedDomains, industry, officialSite, text } =
    input;
  const names = registeredBrandNames(input);
  const matchedNames = matchedBrandNames(input);
  const identity = [
    `대표 브랜드명: ${brandName}`,
    `등록된 공식 표기: ${names.join(" · ")}`,
    matchedNames.length > 0
      ? `답변에서 감지된 표기: ${matchedNames.join(" · ")}`
      : "답변에서 감지된 표기: 표기 변형 또는 공백 차이로 감지됨",
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

  return `AI 답변에서 등록 브랜드의 표기 중 하나가 감지됐습니다.
그 표기가 **아래 대상 브랜드를 가리키는지**, 그리고 AI가 그 브랜드를 알고 있는지 판정하세요.

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
판정하세요. 언급 방식(주제/비교대상/스쳐지나감)은 상관없습니다.`;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: retry and fallback policy must preserve one provider boundary.
async function llmVerdict(input: VerifyInput): Promise<MentionQuality | null> {
  const prompt = buildVerdictPrompt(input);

  try {
    const { object } = await generateObject({
      model: await verdictModel(),
      schema: VerdictSchema,
      prompt,
      temperature: 0,
      abortSignal: input.signal,
    });
    return object.quality;
  } catch (primaryError) {
    if (isAbortError(primaryError) || input.signal?.aborted) {
      throw primaryError;
    }
    let error: unknown = primaryError;
    const primaryFailure = describeProviderError(primaryError);

    // 일시적인 5xx/연결 오류 한 번으로 실제 브랜드 판별을 포기하면, 고객은
    // "잠정 결과"만 보게 된다. 같은 입력을 한 번만 즉시 재시도한다. 429는
    // 재시도해도 악화될 수 있어 독립 Google 판정기로 바로 넘긴다.
    if (
      primaryFailure.statusCode === null ||
      primaryFailure.statusCode === 408 ||
      primaryFailure.statusCode >= 500
    ) {
      try {
        const { object } = await generateObject({
          model: await verdictModel(),
          schema: VerdictSchema,
          prompt,
          temperature: 0,
          abortSignal: input.signal,
        });
        log.info("mention.verdict.primary_retry_succeeded", {
          brandName: input.brandName,
        });
        return object.quality;
      } catch (retryError) {
        if (isAbortError(retryError) || input.signal?.aborted) {
          throw retryError;
        }
        error = retryError;
      }
    }

    const finalError = describeProviderError(error);
    const googleKey = process.env.GOOGLE_API_KEY;
    if (googleKey && finalError.statusCode === 429) {
      try {
        const google = createGoogleGenerativeAI({ apiKey: googleKey });
        const { object } = await generateObject({
          model: google(
            process.env.FINDABLE_GEMINI_MODEL ?? "gemini-2.5-flash"
          ),
          schema: VerdictSchema,
          prompt,
          temperature: 0,
          abortSignal: input.signal,
        });
        log.info("mention.verdict.google_fallback", {
          brandName: input.brandName,
        });
        return object.quality;
      } catch (fallbackError) {
        if (isAbortError(fallbackError) || input.signal?.aborted) {
          throw fallbackError;
        }
        log.warn("mention.verdict.google_fallback_failed", {
          brandName: input.brandName,
          ...describeProviderError(fallbackError),
        });
      }
    }
    log.warn("mention.verdict.llm_failed", {
      brandName: input.brandName,
      ...describeProviderError(error),
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

  if (
    hasConflictingBrandDomain(input) &&
    !(input.citedDomains ?? []).some((domain) =>
      isOfficialDomain(domain, input.brandDomain)
    ) &&
    !mentionsOfficialDomain(input.text, input.brandDomain)
  ) {
    return { counted: false, quality: "different_entity", via: "rule" };
  }

  if (!needsVerification(input.brandName, input.text)) {
    return { counted: true, quality: "confirmed", via: "rule" };
  }

  // Rule-only decisions are free and deterministic; an invocation deadline
  // must not turn a completed rule result into an unverified row.
  if (input.signal?.aborted) {
    throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
  }

  const quality = await llmVerdict(input);
  if (quality === null) {
    // LLM 실패 → 측정은 완료하되 모호 응답을 성공으로 계산하지 않는다.
    // 이 경우만 진짜 「판별 불가」다(분모에서 빼고 따로 센다).
    return {
      counted: false,
      quality: "unverified",
      via: "skipped",
      reason: "judge_failed",
    };
  }

  if (
    quality === "confirmed" &&
    canDemandOfficialEvidence(input) &&
    !hasOfficialIdentityEvidence(input)
  ) {
    // 판정기는 정상 작동했고, 답변이 공식 사이트의 고유 사실을 하나도 말하지
    // 못했다 = AI가 **이 브랜드**를 안다는 증거가 없다. 판정 실패(unverified)가
    // 아니라 판정 결과다. (2026-09-28 이전엔 unverified 로 섞여 한 회차 전체가
    // 잠정 처리되는 원인이 됐다.)
    return {
      counted: false,
      quality: "unknown_brand",
      via: "llm",
      reason: "official_evidence_missing",
    };
  }

  return {
    counted: quality === "confirmed",
    quality,
    via: "llm",
    ...(quality === "confirmed" && !canDemandOfficialEvidence(input)
      ? { officialProfileUnavailable: true as const }
      : {}),
  };
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
  isOfficialDomain,
  mentionsOfficialDomain,
  buildVerdictPrompt,
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

/** 판정 v3 그림자 결과(저장 전용 — 점수·집계에 쓰지 않는다). */
export interface VerdictV3Shadow {
  evidence?: string;
  quality: string;
  reason?: string;
  via: string;
}

export interface VerifiedResponseFields {
  mentionQuality: MentionQuality;
  officialProfileUnavailable?: true;
  verdictReason?: MentionVerdictReason;
  verdictV3?: VerdictV3Shadow;
  verdictVia: string;
}

interface VerifyBrand {
  brandDomain?: string;
  brandName: string;
  brandVariants?: string[];
  industry?: string;
  officialSite?: VerifyInput["officialSite"];
  signal?: AbortSignal;
}

/** 측정 실패·stub 은 판정 대상이 아니다(null). v2·v3 가 같은 입력을 쓴다. */
function buildVerdictInput(
  r: VerifiableResponse,
  brand: VerifyBrand
): (VerifyInput & { stringMatched: boolean }) | null {
  if (r.errorMessage || r.isStub) {
    return null;
  }
  return {
    brandName: brand.brandName,
    brandVariants: brand.brandVariants,
    brandDomain: brand.brandDomain,
    citedDomains: (r.citedSources ?? [])
      .map((source) => source.domain ?? source.url ?? "")
      .filter(Boolean),
    industry: brand.industry,
    officialSite: brand.officialSite,
    signal: brand.signal,
    text: r.rawResponse ?? "",
    // Adapter flags are an optimization hint, not the source of truth.
    // A live Naver AI Briefing response started with the brand name while
    // its adapter flag was false; passing that flag through made a named
    // answer look absent before the entity verifier could inspect it.
    stringMatched: detectBrandMention(
      r.rawResponse ?? "",
      brand.brandName,
      brand.brandVariants
    ).mentioned,
  };
}

/** 판정 부가 필드(사유·홈페이지 미확인 플래그) — 있는 것만 싣는다. */
function verdictExtras(verdict: MentionVerdict): {
  officialProfileUnavailable?: true;
  verdictReason?: MentionVerdictReason;
} {
  return {
    ...(verdict.reason ? { verdictReason: verdict.reason } : {}),
    ...(verdict.officialProfileUnavailable
      ? { officialProfileUnavailable: true as const }
      : {}),
  };
}

function shadowField(
  shadow: {
    evidence?: string;
    quality: string;
    reason?: string;
    via: string;
  } | null
): { verdictV3?: VerdictV3Shadow } {
  if (!shadow) {
    return {};
  }
  return {
    verdictV3: {
      quality: shadow.quality,
      via: shadow.via,
      ...(shadow.reason ? { reason: shadow.reason } : {}),
      ...(shadow.evidence ? { evidence: shadow.evidence } : {}),
    },
  };
}

function logShadowDistribution(
  out: Array<{ brandMentioned: boolean; verdictV3?: VerdictV3Shadow }>,
  brandName: string
): void {
  const v3Dist: Record<string, number> = {};
  let disagreements = 0;
  for (const r of out) {
    if (!r.verdictV3) {
      continue;
    }
    v3Dist[r.verdictV3.quality] = (v3Dist[r.verdictV3.quality] ?? 0) + 1;
    if ((r.verdictV3.quality === "confirmed") !== r.brandMentioned) {
      disagreements += 1;
    }
  }
  log.info("mention.verdict_v3.shadow_distribution", {
    brandName,
    disagreements,
    ...v3Dist,
  });
}

/** 그림자 판정 청크 상한 — 넘으면 그 청크는 기록하지 않는다(v2 판정은 영향 없음). */
const SHADOW_CHUNK_DEADLINE_MS = 15_000;
/**
 * 그림자 판정을 **시작하지 않는** 남은 시간 하한(2026-10-06).
 * 측정 전체 예산(runner 270초) 중 이만큼도 안 남았으면 그림자는 통째로 건너뛴다 —
 * 점수에 쓰지 않는 기록 때문에 집계·DB 저장이 함수 시간 상한(300초)에 걸리면 안 된다.
 */
export const SHADOW_MIN_REMAINING_MS = 60_000;
/** 호출자가 마감 시각을 주지 않을 때의 기본 예산(runner 의 AUDIT_RUN_TIME_BUDGET_MS 와 같다). */
export const SHADOW_DEFAULT_BUDGET_MS = 270_000;

function withShadowDeadline<T>(
  run: (signal: AbortSignal) => Promise<(T | null)[]>,
  size: number,
  deadlineMs: number,
  parent?: AbortSignal
): Promise<(T | null)[]> {
  // 시간이 지나면 실제로 판정기 호출을 취소한다 — 계속 돌면 다음 단계와 호출 한도를
  //   나눠 가진다(컨트롤타워 검증 2026-10-06).
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  parent?.addEventListener("abort", onParentAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<(T | null)[]>((resolve) => {
    timer = setTimeout(() => {
      log.warn("mention.verdict_v3.shadow_deadline", { size });
      controller.abort();
      resolve(new Array(size).fill(null));
    }, deadlineMs);
  });
  return Promise.race([run(controller.signal), timeout]).finally(() => {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
  });
}

/**
 * v2 판정이 **모두 끝난 뒤에만** 그림자 v3 를 돌려 `verdictV3` 를 덧붙인다(2026-10-06).
 * 남은 예산이 SHADOW_MIN_REMAINING_MS 미만이면 시작하지 않고(청크마다 재확인),
 * 청크 상한도 「남은 시간 − 하한」을 넘지 않는다 → 그림자는 마지막 60초를 절대 쓰지 않는다.
 * v2 결과(brandMentioned·mentionQuality 등)는 건드리지 않는다.
 */
async function attachShadowVerdicts<R extends { verdictV3?: VerdictV3Shadow }>(
  out: R[],
  verdictInputs: Array<(VerifyInput & { stringMatched: boolean }) | null>,
  options: {
    brandName: string;
    deadlineAtMs: number;
    signal?: AbortSignal;
    verifyMentionV3: (
      input: VerifyInput & { stringMatched: boolean }
    ) => Promise<Parameters<typeof shadowField>[0]>;
  }
): Promise<void> {
  const startedAt = Date.now();
  let attached = 0;
  for (let start = 0; start < out.length; start += VERDICT_CONCURRENCY) {
    const remainingMs = options.deadlineAtMs - Date.now();
    let skipReason: "aborted" | "budget" | null = null;
    if (options.signal?.aborted) {
      skipReason = "aborted";
    } else if (remainingMs < SHADOW_MIN_REMAINING_MS) {
      skipReason = "budget";
    }
    if (skipReason) {
      log.info("mention.verdict_v3.shadow_skipped", {
        brandName: options.brandName,
        reason: skipReason,
        remainingMs: Math.round(remainingMs),
        minRemainingMs: SHADOW_MIN_REMAINING_MS,
        skippedRows: out.length - start,
      });
      break;
    }
    const inputs = verdictInputs.slice(start, start + VERDICT_CONCURRENCY);
    const shadows = await withShadowDeadline(
      (shadowSignal) =>
        Promise.all(
          inputs.map((verdictInput) =>
            verdictInput
              ? options
                  .verifyMentionV3({ ...verdictInput, signal: shadowSignal })
                  .catch(() => null)
              : Promise.resolve(null)
          )
        ),
      inputs.length,
      Math.min(SHADOW_CHUNK_DEADLINE_MS, remainingMs - SHADOW_MIN_REMAINING_MS),
      options.signal
    );
    for (const [i, shadow] of shadows.entries()) {
      const row = out[start + i];
      const field = shadowField(shadow);
      if (row && field.verdictV3) {
        row.verdictV3 = field.verdictV3;
        attached += 1;
      }
    }
  }
  log.info("mention.verdict_v3.shadow_finished", {
    brandName: options.brandName,
    durationMs: Date.now() - startedAt,
    rows: out.length,
    attached,
  });
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
    brandVariants?: string[];
    brandDomain?: string;
    industry?: string;
    officialSite?: VerifyInput["officialSite"];
    signal?: AbortSignal;
    /**
     * 측정 전체 마감 시각(epoch ms). 그림자 v3 는 이 시각까지
     * SHADOW_MIN_REMAINING_MS 이상 남았을 때만 돈다. 없으면 호출 시점 + 270초.
     */
    shadowDeadlineAtMs?: number;
  },
  onChunkEvent?: (event: {
    chunkIndex: number;
    responseCount: number;
    phase: "started" | "finished";
  }) => void
): Promise<Array<T & VerifiedResponseFields>> {
  const out: Array<T & VerifiedResponseFields> = new Array(responses.length);
  // 판정 v3 그림자 기록(2026-10-05, 기본 off) — 점수에는 쓰지 않고 나란히 저장만 한다.
  const { isVerdictV3ShadowEnabled, verifyMentionV3 } = await import(
    "./mention-verdict-v3"
  );
  const shadowV3 = isVerdictV3ShadowEnabled();
  const shadowDeadlineAtMs =
    brand.shadowDeadlineAtMs ?? Date.now() + SHADOW_DEFAULT_BUDGET_MS;
  const allVerdictInputs: Array<
    (VerifyInput & { stringMatched: boolean }) | null
  > = new Array(responses.length).fill(null);

  // 인덱스를 청크로 끊어 동시 실행 상한을 지킨다.
  for (let start = 0; start < responses.length; start += VERDICT_CONCURRENCY) {
    const slice = responses.slice(start, start + VERDICT_CONCURRENCY);
    const event = {
      chunkIndex: start / VERDICT_CONCURRENCY,
      responseCount: slice.length,
    };
    try {
      onChunkEvent?.({ ...event, phase: "started" });
    } catch {
      /* logging is best-effort */
    }
    const verdictInputs = slice.map((r) => buildVerdictInput(r, brand));
    for (const [i, verdictInput] of verdictInputs.entries()) {
      allVerdictInputs[start + i] = verdictInput;
    }
    const verdicts = await Promise.all(
      slice.map((r, i): Promise<MentionVerdict> => {
        const verdictInput = verdictInputs[i];
        // 측정 실패/stub 은 판정 대상 아님 — 원본 유지.
        if (!verdictInput) {
          return Promise.resolve({
            counted: r.brandMentioned,
            quality: "absent" as MentionQuality,
            via: "skipped" as const,
          });
        }
        return verifyMention(verdictInput).catch((error) => {
          if (isAbortError(error) || brand.signal?.aborted) {
            return {
              counted: false,
              quality: "unverified" as MentionQuality,
              via: "skipped" as const,
              reason: "judge_failed" as const,
            };
          }
          throw error;
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
        ...verdictExtras(verdict),
      };
    }
    try {
      onChunkEvent?.({ ...event, phase: "finished" });
    } catch {
      /* logging is best-effort */
    }
  }

  // 그림자 v3 는 v2 가 전부 끝난 뒤에만, 남은 예산이 있을 때만 돈다(2026-10-06).
  //   이전엔 청크마다 v2 와 나란히 돌고 청크가 그림자를 기다려(최대 15초×청크 수)
  //   측정 시간을 늘렸다 — 운영 실측: kurly 첫 측정이 판정 단계에서 시간 초과.
  if (shadowV3) {
    await attachShadowVerdicts(out, allVerdictInputs, {
      brandName: brand.brandName,
      deadlineAtMs: shadowDeadlineAtMs,
      signal: brand.signal,
      verifyMentionV3,
    });
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
    unverified: 0,
  };
  const viaDist = { rule: 0, llm: 0, skipped: 0 };
  for (const r of out) {
    dist[r.mentionQuality] += 1;
    viaDist[r.verdictVia as keyof typeof viaDist] += 1;
  }
  if (shadowV3) {
    logShadowDistribution(out, brand.brandName);
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
