// 저장된 crewResult 의 표시 시점 필터 (2026-10-03 AG-0 후속).
//
// 2026-10-03 전 crew 프롬프트는 수진에게 *"Reddit이 모든 LLM 인용의 약 40%"* 언급을
// 강제했고, 준호에게 세 기법을 *"visibility +40%"* 로 알려줬다. 저장된 crewResult 는
// 그 LLM 출력 그대로라 화면이 다시 그린다. DB 는 고치지 않고(읽기 전용) 그 주장이
// 담긴 **문장만** 화면에 나가기 직전에 뺀다. 항목 수·숫자·enum 은 건드리지 않는다.
//
// 정상 결과를 깨지 않도록 패턴은 좁게 잡는다:
//   - 「이번 측정에서 자사 인용 40%」 같은 측정값은 남긴다(효과·업계 일반 주장이 아님).
//   - 수치 없는 Reddit·Princeton 언급은 남긴다.

const REDDIT_RE = /reddit|레딧/i;
const FORTY_PCT_RE = /40(\.\d+)?\s*%/;
const INDUSTRY_WIDE_RE = /모든|전체|업계|all\s|overall|across/i;
const FORTY_LIFT_RE =
  /\+\s*40\s*%|최대\s*40\s*%|up to 40\s*%|40\s*%\s*(향상|상승|증가|개선|높)/i;
const VISIBILITY_RE = /가시성|visibility|노출|인용|princeton|프린스턴|geo/i;
const PRINCETON_RE = /princeton|프린스턴|kdd/i;
const PCT_LIFT_RE =
  /[+−-]\s*\d+(\.\d+)?\s*%|\d+(\.\d+)?\s*%\s*(향상|상승|증가|개선)/;

/** 업계 일반 주장: Reddit + 40% + 「모든/전체/업계 LLM 인용」. */
function isRedditShareClaim(sentence: string): boolean {
  return (
    REDDIT_RE.test(sentence) &&
    FORTY_PCT_RE.test(sentence) &&
    INDUSTRY_WIDE_RE.test(sentence)
  );
}

/** 논문 기법의 +40% 효과 주장(가시성·노출·인용). */
function isVisibilityLiftClaim(sentence: string): boolean {
  return FORTY_LIFT_RE.test(sentence) && VISIBILITY_RE.test(sentence);
}

/** Princeton 논문 이름과 효과 수치(±N%)가 한 문장에 함께 있는 주장. */
function isPrincetonLiftClaim(sentence: string): boolean {
  return PRINCETON_RE.test(sentence) && PCT_LIFT_RE.test(sentence);
}

function isUnsupportedClaim(sentence: string): boolean {
  return (
    isRedditShareClaim(sentence) ||
    isVisibilityLiftClaim(sentence) ||
    isPrincetonLiftClaim(sentence)
  );
}

// 문장 경계: 마침표·물음표·느낌표 뒤 공백, 또는 줄바꿈. 「40.1%」의 점은 뒤가 공백이 아니라 안 끊긴다.
const SENTENCE_BOUNDARY = /(?<=[.!?。])\s+|\n/;

function sanitizeText(text: string): string {
  const sentences = text.split(SENTENCE_BOUNDARY);
  const kept = sentences.filter((s) => !isUnsupportedClaim(s));
  if (kept.length === sentences.length) {
    return text;
  }
  return kept
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeText(value);
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const clean = sanitizeValue(item);
      changed ||= clean !== item;
      return clean;
    });
    return changed ? next : value;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const clean = sanitizeValue(item);
      changed ||= clean !== item;
      next[key] = clean;
    }
    return changed ? next : value;
  }
  return value;
}

/**
 * 저장된 crewResult 에서 근거 없는 수치 주장 문장을 뺀 사본을 돌려준다.
 * 바뀐 것이 없으면 같은 객체를 그대로 돌려준다(원본은 절대 바꾸지 않는다).
 */
export function sanitizeStoredCrewResult<T>(crewResult: T): T {
  return sanitizeValue(crewResult) as T;
}
