import { conjunctionParticle, objectParticle, topicParticle } from "./actions";
import type { PromptKind } from "./answer-buckets";
import { MAX_DISCOVERY_PROMPTS } from "./prompt-limits";

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

// ──────────────────────────────────────────────────────────────────
// 이름 없는 질문(discovery) — 2026-09-29
//
// 🔴 왜: 기존 질문 4개가 **전부 브랜드 이름을 넣은 질문**이었다
//   ("노우버스는 어떤 브랜드야?"). 이건 「AI 가 이 이름을 아나」만 잰다.
//   고객이 실제로 궁금한 건 「내 업종을 물었을 때 AI 가 나를 추천하나」다.
//
// 재료 = 공식 사이트가 **스스로 쓴** 제목 조각·설명 문장뿐이다(러너가 이미 읽어 둔
//   officialSiteIdentity). 번역·요약·추측을 하지 않는다 — 재료가 없으면 질문도 없다.
//   예) 「Indigochild」 제목 + 「We Create the Future」 H1 → 업종 단서가 없어 0개.
// 영어 질문은 사이트가 **영어로 쓴** 조각이 있을 때만 만든다(한글 조각을 번역하지 않는다).
// ──────────────────────────────────────────────────────────────────

export interface RunPrompt {
  /** 없으면 브랜드 이름 질문(폴백 4개). 저장 질문은 실행 전 분류한다. */
  kind?: PromptKind;
  lang: "ko" | "en";
  text: string;
}

export interface DiscoverySiteIdentity {
  description?: string | null;
  h1?: string | null;
  siteName?: string | null;
  title?: string | null;
}

export { MAX_DISCOVERY_PROMPTS } from "./prompt-limits";

// "/" 는 나누지 않는다 — "AX/DX 컨설팅" 은 한 업종 표기다("AX" 만 떼면 뜻이 없다).
const SEGMENT_SPLIT_RE = /\s*[|·•—–:,]\s*|\s+-\s+/;
const PAREN_RE = /\([^)]*\)/g;
const NON_IDENTITY_CHAR_RE = /[^a-z0-9가-힣]/g;
const HANGUL_RE = /[가-힣]/;
const LATIN_TERM_RE = /^[A-Za-z][A-Za-z0-9 &+.'-]*$/;
const MIN_TERM_LENGTH = 2;
const MAX_TERM_LENGTH = 40;
// 제목의 슬로건·성분명은 업종이 아니다. 예: "만져지는 변화, NAD+ / Metl Halo".
// 이름 없는 질문은 실제 고객이 업종을 물었을 때의 발견 가능성을 재야 하므로,
// 서비스·업종을 뜻하는 명사가 확인되는 조각만 쓴다. 확신이 없으면 만들지 않는
// 편이 그럴듯하지만 무관한 질문을 측정하는 것보다 정확하다.
const KO_CATEGORY_HEAD_RE =
  /(서비스|플랫폼|솔루션|컨설팅|구독|전략|교육|마케팅|커머스|쇼핑몰|화장품|스킨케어|뷰티|병원|의료|법률|회계|보안|제조|유통|금융|여행|숙박|부동산|물류|채용|채널|도구|앱|소프트웨어|에이전시)/;
// "…으로 {문제}를 지원합니다" 처럼 **사이트가 스스로 쓴** 문제 문장만 집는다.
const KO_PROBLEM_RE =
  /(?:으로|로|통해|하여)\s+([^.!?。]{4,40}?)[을를]\s*(?:지원|돕|도와|해결|개선|혁신|자동화|관리|높여|줄여)/;
const EN_PROBLEM_RE =
  /\b(?:helps?|enables?|lets?)\s+(?:you\s+|teams\s+|businesses\s+|companies\s+|brands\s+)?([a-z][^.!?;]{3,60}?)(?:[.!?;]|,\s|$)/i;

function compact(value: string): string {
  return value.toLowerCase().replace(NON_IDENTITY_CHAR_RE, "");
}

/**
 * Saved Prompt rows have a topical category, but no brand/discovery kind.
 * Classify the selected question at run time so its AuditJob response rows,
 * discovery count and answer buckets share the same explicit kind. This is a
 * text-derived classification, not a migration or a change to saved Prompts.
 */
export function classifySavedPromptKind(
  text: string,
  names: PromptBrandNames,
  variants: readonly string[]
): PromptKind {
  const question = compact(text);
  const aliases = [names.ko, names.en, ...variants]
    .map(compact)
    .filter((alias) => alias.length >= 2);
  return aliases.some((alias) => question.includes(alias))
    ? "brand"
    : "discovery";
}

function containsName(value: string, nameKeys: string[]): boolean {
  const key = compact(value);
  return nameKeys.some((name) => name.length >= 2 && key.includes(name));
}

/**
 * 제목·H1 에서 업종 키워드를 뽑는다. **이름 조각이 함께 있는 구조**
 * ("노우버스 | AI 전략 · CTO 구독")일 때만 쓴다 — 이름 없는 제목·H1 은
 * 슬로건일 가능성이 커서("We Create the Future") 업종 단서로 믿지 않는다.
 */
export function siteCategoryTerms(
  site: DiscoverySiteIdentity | null | undefined,
  names: readonly string[]
): string[] {
  const nameKeys = names.map(compact).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const source of [site?.title, site?.h1]) {
    if (!source) {
      continue;
    }
    const segments = source
      .replace(PAREN_RE, " ")
      .split(SEGMENT_SPLIT_RE)
      .map((v) => v.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const hasNameSegment = segments.some((seg) => containsName(seg, nameKeys));
    if (!hasNameSegment || segments.length < 2) {
      continue;
    }
    for (const seg of segments) {
      if (
        containsName(seg, nameKeys) ||
        seg.length < MIN_TERM_LENGTH ||
        seg.length > MAX_TERM_LENGTH
      ) {
        continue;
      }
      const key = compact(seg);
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push(seg);
      }
    }
  }
  return out;
}

/**
 * 제목 조각이 실제 업종·서비스를 뜻하는지의 보수적 판별.
 * 슬로건·성분·오탈자 브랜드 조각은 "이름 없이 묻는 질문"의 재료가 될 수 없다.
 */
function isDiscoveryCategoryTerm(term: string): boolean {
  if (HANGUL_RE.test(term)) {
    return KO_CATEGORY_HEAD_RE.test(term);
  }
  return LATIN_TERM_RE.test(term) && (term.includes(" ") || term.length >= 6);
}

/** 설명 문장에서 사이트가 스스로 적은 「해결하는 문제」를 뽑는다. 없으면 null. */
export function siteProblemPhrase(
  site: DiscoverySiteIdentity | null | undefined,
  names: readonly string[],
  lang: "ko" | "en"
): string | null {
  const description = site?.description ?? "";
  const match = (lang === "ko" ? KO_PROBLEM_RE : EN_PROBLEM_RE).exec(
    description
  );
  const phrase = match?.[1]?.replace(/\s+/g, " ").trim();
  if (!phrase) {
    return null;
  }
  const nameKeys = names.map(compact).filter(Boolean);
  if (containsName(phrase, nameKeys)) {
    return null;
  }
  if (lang === "en" && HANGUL_RE.test(phrase)) {
    return null;
  }
  return phrase;
}

/**
 * 이름 없이 묻는 질문 — 한국어 최대 2개 · 영어는 영어 재료가 있을 때만.
 * 반환 개수는 `MAX_DISCOVERY_PROMPTS` 를 넘지 않는다(러너 상한 8 보호).
 */
export function generateDiscoveryPrompts(
  names: PromptBrandNames & { variants?: readonly string[] },
  site: DiscoverySiteIdentity | null | undefined,
  language: "ko" | "en" | "both"
): RunPrompt[] {
  const nameList = [names.ko, names.en, ...(names.variants ?? [])];
  if (site?.siteName) {
    nameList.push(site.siteName);
  }
  const terms = siteCategoryTerms(site, nameList);
  const koTerms = terms.filter(
    (t) => (HANGUL_RE.test(t) || !LATIN_TERM_RE.test(t)) && isDiscoveryCategoryTerm(t)
  );
  // 영어 조각은 약어 한 토막("AX")이 아니라 뜻이 서는 표기만 — 두 단어 이상이거나 6자 이상.
  const enTerms = terms.filter(
    (t) => LATIN_TERM_RE.test(t) && isDiscoveryCategoryTerm(t)
  );
  const ko: RunPrompt[] = [];
  const en: RunPrompt[] = [];

  const koCategory = koTerms.slice(0, 2);
  if (koCategory.length > 0) {
    ko.push({
      kind: "discovery",
      lang: "ko",
      text: `${koCategory.join(", ")} 서비스를 하는 곳 추천해줘`,
    });
  }
  const koProblem = siteProblemPhrase(site, nameList, "ko");
  if (koProblem) {
    ko.push({
      kind: "discovery",
      lang: "ko",
      text: `${koProblem}${objectParticle(koProblem)} 도와주는 서비스 어디 있어?`,
    });
  } else if (koTerms.length >= 3) {
    // 문제 문장이 없으면 남은 업종 키워드로 두 번째 질문을 만든다(여전히 사이트 표기).
    ko.push({
      kind: "discovery",
      lang: "ko",
      text: `${koTerms.slice(2, 4).join(", ")} 잘하는 회사 어디야?`,
    });
  }

  if (enTerms.length > 0) {
    en.push({
      kind: "discovery",
      lang: "en",
      text: `What are the best ${enTerms.slice(0, 2).join(" and ")} services?`,
    });
  }
  const enProblem = siteProblemPhrase(site, nameList, "en");
  if (enProblem) {
    en.push({
      kind: "discovery",
      lang: "en",
      text: `Which service helps ${enProblem}?`,
    });
  }

  if (language === "ko") {
    return ko.slice(0, MAX_DISCOVERY_PROMPTS);
  }
  if (language === "en") {
    return en.slice(0, MAX_DISCOVERY_PROMPTS);
  }
  // both: 한국어 우선(무료 진단 고객 대부분이 국내), 모자라면 영어로 채운다.
  return [...ko, ...en].slice(0, MAX_DISCOVERY_PROMPTS);
}
