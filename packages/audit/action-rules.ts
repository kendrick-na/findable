// 근거 등급 액션 규칙표 (2026-09-28) — "관측된 문제 → 처방" 을 표 한 곳에서 정한다.
//
// 배경: `actions.ts` 는 인지 0 이면 「공식 소개 한 문단 + 위키·디렉터리」, 아니면
//   Princeton 「+41%」 카드를 **고정으로** 냈다. 그 카드는 근거가 약하다
//   (GPT-3.5 시절 실험 · 재현 부족). 그리고 이미 저장하고 있던 판정 품질
//   (`mentionQuality`: 동명 오인 `different_entity` 등)을 처방이 한 번도 읽지 않았다.
//
// 이 파일의 원칙:
//   1. 규칙은 **관측값**으로만 켜진다(우리가 잰 답변 수). 추정으로 켜지 않는다.
//   2. 카드마다 6칸을 채운다 — 근거 등급+출처 · 적용 AI · 작업 시간 · 재측정 권장 시점 ·
//      다시 잴 숫자 · 실패로 볼 조건. 등급은 **연구의 강도**이지 효과 크기가 아니다.
//   3. 출처 URL 은 원문을 직접 확인한 것만 둔다(2026-09-28 확인). 요약 수치도 원문 그대로.
//   4. 임계값 중 연구 근거가 없는 것은 "제품 규칙"이라고 밝힌다(`RULE_THRESHOLDS`).
//
// 순수 함수 모듈 — DB·네트워크 의존 0. `actions.ts` 가 여기의 규칙을 호출한다.

import type { ActionKind, ActionPriority, GeoAction } from "./actions";
import type { MarketScope } from "./market-scope";
import { stripMarkdown } from "./strip-markdown";

// ──────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────

/** 근거의 강도. 색만으로 구분하지 않도록 화면은 반드시 `EVIDENCE_GRADE_LABEL` 글자를 쓴다. */
export type EvidenceGrade = "strong" | "medium" | "weak" | "none";

export const EVIDENCE_GRADE_LABEL: Record<
  EvidenceGrade,
  { label: string; meaning: string }
> = {
  strong: {
    label: "근거 강함",
    meaning: "공식 문서로 확인된 전제 조건입니다.",
  },
  medium: {
    label: "근거 보통",
    meaning:
      "대규모 관찰 연구나 공식 문서가 있습니다. 대부분 상관관계라 효과를 보장하지는 않습니다.",
  },
  weak: {
    label: "근거 약함",
    meaning: "소수 실험뿐이거나 재현이 부족합니다.",
  },
  none: {
    label: "근거 없음",
    meaning: "효과가 확인되지 않았거나, 역효과·규정 위반 위험이 있습니다.",
  },
};

/**
 * 근거의 **종류**(2026-10-03 AG-1). 등급(강도)과 따로 둔다 — 대규모 관찰 연구도
 * 「근거 보통」일 수 있지만, 그것은 효과를 보여준 실험이 아니라 상관관계다.
 */
export type EvidenceBasis =
  | "official_requirement"
  | "controlled_experiment"
  | "observational"
  | "internal_hypothesis";

export const EVIDENCE_BASIS_LABEL: Record<EvidenceBasis, string> = {
  official_requirement: "공식 플랫폼 문서",
  controlled_experiment: "통제 실험",
  observational: "관찰 상관",
  internal_hypothesis: "Findable 내부 가설",
};

export interface EvidenceSource {
  label: string;
  url: string;
}

/** 다른 대상으로 오인한 답변의 원문 일부 — 처방의 증거로 그대로 보여준다. */
export interface ConfusedQuote {
  engineId: string;
  excerpt: string;
}

/** 카드 6칸. `GeoAction.guide` 로 실린다(구 데이터에는 없다 = optional). */
export interface ActionGuide {
  effectLag: string;
  /** 대략의 작업 시간. `per: "week"` 이면 매주 드는 시간이다. */
  effortHours: { max: number; min: number; per: "total" | "week" };
  /** 적용되는 AI(엔진 id). 빈 배열 = 측정한 AI 전체. */
  engines: string[];
  /** 근거 종류. 2026-10-03 이전 저장분에는 없다. */
  evidenceBasis?: EvidenceBasis;
  evidenceGrade: EvidenceGrade;
  failCondition: string;
  /** 이 작업이 보장하지 않는 것(비보장 범위). */
  notGuaranteed?: string;
  /** 재측정 전에 게시·색인이 됐는지 확인하는 방법. */
  publishCheck?: string;
  quotes?: ConfusedQuote[];
  remeasureMetric: string;
  sources: EvidenceSource[];
}

/** 「하지 마세요」 1건. 근거 등급은 항상 none. */
export interface DontItem {
  evidenceGrade: "none";
  reason: string;
  sources: EvidenceSource[];
  title: string;
}

/** 응답 1건에서 규칙이 읽는 것만(구조적 타이핑 — 러너 flat·저장된 engineResponses 둘 다 맞는다). */
export interface VerdictResponseLike {
  citedSources?: Array<{ domain?: string | null; url?: string | null }> | null;
  engineId: string;
  errorMessage?: string | null;
  excerpt?: string | null;
  isStub?: boolean | null;
  mentionQuality?: string | null;
  rawResponse?: string | null;
}

export interface VerdictCounts {
  absent: number;
  /**
   * 오류·스텁·미판정을 뺀, 판정까지 끝난 응답 수 = 모든 비율의 분모.
   * (공개 진단 지표 `verifiedCount + unverifiedCount` 와 같은 축.)
   */
  answered: number;
  confirmed: number;
  differentEntity: number;
  engineError: number;
  total: number;
  /** 답은 왔지만 판정 필드가 없는 응답(구버전 측정·판정 제외 엔진). 분모에 넣지 않는다. */
  unclassified: number;
  unknownBrand: number;
  unverified: number;
}

export interface VerdictEvidence {
  confusedQuotes: ConfusedQuote[];
  counts: VerdictCounts;
  /** 오인이 나온 엔진(중복 제거·등장 순). */
  differentEntityEngines: string[];
  /** 답을 받은 응답이 인용한 URL 중 공식 도메인 것의 수. 도메인을 모르면 null. */
  ownedCitationCount: number | null;
}

// ──────────────────────────────────────────────────
// 출처 — 원문 확인 2026-09-28
// ──────────────────────────────────────────────────

export const RULE_SOURCES = {
  googleOrganization: {
    label: "[공식 문서] Google 검색 센터 — Organization 구조화 데이터(sameAs)",
    url: "https://developers.google.com/search/docs/appearance/structured-data/organization",
  },
  naverBriefing: {
    label:
      "[사례 분석] SEO뉴스 — 네이버 AI 브리핑 인용 272건(질의 유형 혼합) 중 49.3%가 검색 상위 10위 밖 문서",
    url: "https://seonews.co.kr/naver-ai-briefing-geo-202605/",
  },
  ahrefsBestLists: {
    label:
      "[관찰 연구] Ahrefs — 프롬프트 750개·ChatGPT 인용 URL 26,283개 중 '추천 목록(best X)' 글이 43.8%(게재 효과 실험 아님)",
    url: "https://ahrefs.com/blog/best-lists-research/",
  },
  seerBing: {
    label:
      "[관찰 연구] Seer Interactive(2025-02) — 질문 약 100개·인용 약 500건에서 SearchGPT 인용의 87% 이상이 Bing 상위 결과와 일치(Bing 밖 출처 인용도 있음)",
    url: "https://www.seerinteractive.com/insights/87-percent-of-searchgpt-citations-match-bings-top-results",
  },
  bingAiPerformance: {
    label:
      "[공식 문서] Bing 웹마스터 블로그 — AI Performance(Copilot·Bing AI 답변의 인용 URL·쿼리 보고)",
    url: "https://blogs.bing.com/webmaster/2026/2/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview/",
  },
  ahrefsWhyCited: {
    label:
      "[관찰 연구] Ahrefs — 프롬프트 140만 건 분석: 인용된 페이지는 제목이 질문과 더 비슷함",
    url: "https://ahrefs.com/blog/why-chatgpt-cites-pages/",
  },
  googleJsSeo: {
    label: "[공식 문서] Google 검색 센터 — 자바스크립트 SEO 기본(렌더링)",
    url: "https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics",
  },
  openaiBots: {
    label: "[공식 문서] OpenAI — 크롤러(OAI-SearchBot·GPTBot) 안내",
    url: "https://platform.openai.com/docs/bots",
  },
  ahrefsVisibility: {
    label:
      "[관찰 연구] Ahrefs — 브랜드 7.5만 개 분석: YouTube 언급 상관 약 0.737, 웹 언급 0.656~0.709(상관이며 인과 아님)",
    url: "https://ahrefs.com/blog/ai-brand-visibility-correlations",
  },
  ahrefsSchema: {
    label:
      "[관찰 연구] Ahrefs — 스키마를 추가한 1,885개 페이지 매칭 비교: AI Mode·ChatGPT 인용 유의미한 증가 없음",
    url: "https://ahrefs.com/blog/schema-ai-citations/",
  },
  googleAiFeatures: {
    label:
      "[공식 문서] Google 검색 센터 — AI 기능과 웹사이트(별도 AI용 파일 불필요)",
    url: "https://developers.google.com/search/docs/appearance/ai-features",
  },
  googleSpam: {
    label: "[공식 문서] Google 검색 센터 — 스팸 정책(클로킹)",
    url: "https://developers.google.com/search/docs/essentials/spam-policies",
  },
  kftcAdAct: {
    label: "[법령] 국가법령정보센터 — 표시·광고의 공정화에 관한 법률",
    url: "https://www.law.go.kr/법령/표시ㆍ광고의공정화에관한법률",
  },
} as const satisfies Record<string, EvidenceSource>;

/**
 * 규칙이 켜지는 경계. ⚠️ 연구에서 나온 숫자가 아니라 **제품 규칙**이다.
 *   오인 20% = 5건 중 1건 — 고객이 "우리를 다른 회사로 안다"고 느끼기 시작하는 선으로 정했다.
 *   인지 낮음 = "알아본 답변보다 모른다는 답변이 많다" — 숫자를 새로 만들지 않은 비교 규칙.
 */
export const RULE_THRESHOLDS = {
  misidentificationShare: 0.2,
  maxQuotes: 3,
} as const;

// ──────────────────────────────────────────────────
// 판정 집계
// ──────────────────────────────────────────────────

const QUOTE_WINDOW = 140;
const URL_SCHEME_RE = /^https?:\/\//;
const WWW_RE = /^www\./;
const WHITESPACE_RE = /\s+/g;

/** 저장된 판정 값 → 집계 칸. 여기에 없는 값은 지어내 분류하지 않고 미판정으로 둔다. */
const QUALITY_BUCKET: Record<
  string,
  "absent" | "confirmed" | "differentEntity" | "unknownBrand" | "unverified"
> = {
  absent: "absent",
  confirmed: "confirmed",
  different_entity: "differentEntity",
  unknown_brand: "unknownBrand",
  unverified: "unverified",
};

function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(URL_SCHEME_RE, "")
    .replace(WWW_RE, "")
    .split("/")[0] as string;
}

function ownedCitationsIn(r: VerdictResponseLike, ownedHost: string): number {
  return (r.citedSources ?? []).filter((c) => {
    const host = normalizeHost(c.domain || c.url || "");
    return host === ownedHost || host.endsWith(`.${ownedHost}`);
  }).length;
}

/** 브랜드 이름 주변을 잘라 인용문으로 쓴다. 이름이 없으면 앞부분. */
function quoteAround(text: string, brandName: string): string {
  const plain = stripMarkdown(text).replace(WHITESPACE_RE, " ").trim();
  const at = brandName ? plain.indexOf(brandName) : -1;
  const start = Math.max(0, at - 20);
  const slice = plain.slice(start, start + QUOTE_WINDOW).trim();
  const head = start > 0 ? "…" : "";
  const tail = start + QUOTE_WINDOW < plain.length ? "…" : "";
  return `${head}${slice}${tail}`;
}

/** 인용문은 **서로 다른 AI** 부터 고른다 — 한 엔진의 반복보다 "여러 AI가 착각한다"가 증거다. */
function distinctEngineQuotes(confused: ConfusedQuote[]): ConfusedQuote[] {
  const quotes: ConfusedQuote[] = [];
  const seen = new Set<string>();
  for (const q of confused) {
    if (quotes.length >= RULE_THRESHOLDS.maxQuotes) {
      break;
    }
    if (!seen.has(q.engineId) && q.excerpt) {
      quotes.push(q);
      seen.add(q.engineId);
    }
  }
  return quotes;
}

/**
 * 응답 목록 → 판정 집계. 오류·스텁은 분모에서 뺀다(실패를 "모른다"로 세지 않는다).
 */
export function summarizeVerdicts(
  responses: VerdictResponseLike[],
  options: { brandDomain?: string | null; brandName: string }
): VerdictEvidence {
  const counts: VerdictCounts = {
    absent: 0,
    answered: 0,
    confirmed: 0,
    differentEntity: 0,
    engineError: 0,
    total: responses.length,
    unclassified: 0,
    unknownBrand: 0,
    unverified: 0,
  };
  const ownedHost = options.brandDomain
    ? normalizeHost(options.brandDomain)
    : null;
  let ownedCitationCount = 0;
  const confused: ConfusedQuote[] = [];
  const confusedEngines: string[] = [];

  for (const r of responses) {
    if (r.errorMessage || r.isStub) {
      counts.engineError += 1;
      continue;
    }
    if (ownedHost) {
      ownedCitationCount += ownedCitationsIn(r, ownedHost);
    }
    const bucket = r.mentionQuality
      ? QUALITY_BUCKET[r.mentionQuality]
      : undefined;
    if (!bucket) {
      counts.unclassified += 1;
      continue;
    }
    counts.answered += 1;
    counts[bucket] += 1;
    if (bucket === "differentEntity") {
      if (!confusedEngines.includes(r.engineId)) {
        confusedEngines.push(r.engineId);
      }
      confused.push({
        engineId: r.engineId,
        excerpt: quoteAround(
          r.excerpt || r.rawResponse || "",
          options.brandName
        ),
      });
    }
  }

  return {
    confusedQuotes: distinctEngineQuotes(confused),
    counts,
    differentEntityEngines: confusedEngines,
    ownedCitationCount: ownedHost ? ownedCitationCount : null,
  };
}

/** before/after 추적용 비율(0~1). 분모 0 이면 null — 0% 와 "모름"을 구분한다. */
export function verdictRates(counts: VerdictCounts): {
  accurateRate: number | null;
  misidentificationRate: number | null;
} {
  if (counts.answered === 0) {
    return { accurateRate: null, misidentificationRate: null };
  }
  return {
    accurateRate: counts.confirmed / counts.answered,
    misidentificationRate: counts.differentEntity / counts.answered,
  };
}

// ──────────────────────────────────────────────────
// 엔진 이름
// ──────────────────────────────────────────────────

const ENGINE_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  google: "Google 검색(AI 개요)",
  naver: "네이버",
  "naver-briefing": "네이버 AI 브리핑",
  hyperclova: "HyperCLOVA X",
  daum: "다음",
  bing: "Bing",
};

export function engineDisplayName(engineId: string): string {
  return ENGINE_LABEL[engineId] ?? engineId;
}

// ──────────────────────────────────────────────────
// 규칙 입력
// ──────────────────────────────────────────────────

export interface RuleSignals {
  brandDomain?: string;
  brandName: string;
  enginesMeasured: number;
  enginesMentioned: number;
  marketScope: MarketScope;
  /** "측정한 AI 7곳" / "응답을 받은 AI 6곳(요청 7곳)" — actions.ts 가 만든다. */
  measuredLabel: string;
  /** 관측된 공식 도메인 인용 수. 모르면 null(규칙을 켜지 않는다). */
  ownedCitations: number | null;
  /** 판정 집계. 구버전 호출부는 없다 → 엔진 단위 신호로 폴백. */
  verdicts?: VerdictEvidence;
}

function objectJosa(word: string): string {
  const last = word.trim().at(-1);
  if (!last) {
    return "를";
  }
  const code = last.charCodeAt(0);
  if (code < 0xac_00 || code > 0xd7_a3) {
    return "를";
  }
  return (code - 0xac_00) % 28 === 0 ? "를" : "을";
}

function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 100);
}

function card(
  kind: ActionKind,
  priority: ActionPriority,
  fields: Omit<GeoAction, "kind" | "priority" | "guide" | "source">,
  guide: ActionGuide
): GeoAction {
  return {
    kind,
    priority,
    ...fields,
    // 구 화면(웹 결과·PDF)은 `source` 한 줄만 읽는다 → 등급+첫 출처를 같이 적는다.
    source: `${EVIDENCE_GRADE_LABEL[guide.evidenceGrade].label} · ${guide.sources
      .map((s) => s.label)
      .join(" / ")}`,
    guide,
  };
}

const NOT_GUARANTEED_PREFIX = "보장하지 않는 것:";
const PUBLISH_CHECK_PREFIX = "게시·색인 확인:";

/**
 * 카드 템플릿(관측→실행→근거→비보장→게시·색인 확인→재측정)을 **기존 화면 칸**에 싣는다.
 * 새 UI 칸 없이 보이게: 비보장은 실행 방법 끝에, 게시·색인 확인은 확인 방법 앞에 붙인다.
 * 두 번 불러도 같은 결과(이미 붙었으면 그대로).
 */
export function applyGuideCopy(action: GeoAction): GeoAction {
  const g = action.guide;
  if (!g) {
    return action;
  }
  const how =
    g.notGuaranteed && !action.how.includes(NOT_GUARANTEED_PREFIX)
      ? `${action.how}\n${NOT_GUARANTEED_PREFIX} ${g.notGuaranteed}`
      : action.how;
  const verification =
    g.publishCheck && !action.verification?.startsWith(PUBLISH_CHECK_PREFIX)
      ? `${PUBLISH_CHECK_PREFIX} ${g.publishCheck}${action.verification ? ` 재측정: ${action.verification}` : ""}`
      : action.verification;
  return { ...action, how, verification };
}

/** 인지 낮음 판정 — 판정 집계가 있으면 답변 단위, 없으면 엔진 단위(구버전). */
export function isAwarenessLow(sig: RuleSignals): boolean {
  const v = sig.verdicts?.counts;
  if (v && v.answered > 0) {
    return v.unknownBrand + v.absent > v.confirmed;
  }
  return sig.enginesMeasured > 0 && sig.enginesMentioned === 0;
}

function awarenessEvidence(sig: RuleSignals): string {
  const v = sig.verdicts?.counts;
  if (v && v.answered > 0) {
    return `답을 받은 ${v.answered}건 중 AI가 ${sig.brandName}${objectJosa(sig.brandName)} 모른다고 하거나 이름을 찾지 못한 답변이 ${v.unknownBrand + v.absent}건, 제대로 알아본 답변은 ${v.confirmed}건이었습니다.`;
  }
  return `${sig.measuredLabel} 중 등록한 ${sig.brandName}로 확인된 답변은 0개였습니다.`;
}

// ──────────────────────────────────────────────────
// 규칙 ① 동명 오인
// ──────────────────────────────────────────────────

export function entityClarityAction(sig: RuleSignals): GeoAction | null {
  const v = sig.verdicts;
  if (!v || v.counts.answered === 0) {
    return null;
  }
  const { answered, differentEntity } = v.counts;
  if (differentEntity / answered < RULE_THRESHOLDS.misidentificationShare) {
    return null;
  }
  const engines = v.differentEntityEngines.map(engineDisplayName).join("·");
  const name = sig.brandName;
  const domainHint = sig.brandDomain
    ? `(도메인 ${sig.brandDomain}에 쓴 영문 표기와 똑같이)`
    : "";
  return card(
    "entity_clarity",
    3,
    {
      title: `${answered}건 중 ${differentEntity}건이 다른 회사로 설명했습니다 — 소개 페이지에서 '우리가 누구인지'를 못 박으세요`,
      evidence: `답을 받은 ${answered}건 중 ${differentEntity}건(${pct(differentEntity, answered)}%)이 이름이 같거나 비슷한 다른 회사·서비스를 ${name}인 것처럼 소개했습니다. 나온 곳: ${engines}.`,
      how:
        `① 공식 소개 페이지 첫 문단에 "${name}은(는) [업종]·[지역]의 회사이며, 이름이 비슷한 [다른 회사]와는 다른 회사입니다"라고 적으세요. 대괄호는 실제 정보로 채우고, 아래 착각 사례에 나온 이름을 참고하세요.\n` +
        `② 한글 이름과 영문 이름을 함께 쓰세요${domainHint}.\n` +
        "③ 소개 페이지에 Organization 구조화 데이터를 넣고, sameAs 에 공식 SNS·사업자 정보처럼 우리 회사임이 확인되는 페이지 주소를 연결하세요.",
      where: sig.brandDomain
        ? `https://${sig.brandDomain} 의 회사 소개(About) 페이지`
        : "공식 사이트의 회사 소개 페이지",
      verification: `다음 측정에서 다른 회사로 착각한 답변 수가 ${answered}건 중 ${differentEntity}건에서 줄었는지 보세요.`,
    },
    {
      evidenceGrade: "medium",
      evidenceBasis: "official_requirement",
      notGuaranteed:
        "구조화 데이터는 Google 이 회사 정보를 이해하도록 돕는 공식 기능입니다. 다른 AI의 착각이 줄거나 AI 언급이 늘어난다는 보장은 아닙니다.",
      publishCheck:
        "수정한 소개 페이지가 공개 주소에서 열리고, Google 리치 결과 테스트에서 Organization 데이터가 오류 없이 읽히는지 확인하세요.",
      sources: [RULE_SOURCES.googleOrganization],
      engines: ["google", "gemini"],
      effortHours: { min: 2, max: 4, per: "total" },
      effectLag:
        "구글이 페이지를 다시 읽어 간 뒤부터(보통 며칠~몇 주). 다른 AI는 반영 시점이 공개돼 있지 않습니다.",
      remeasureMetric: `다른 회사로 착각한 답변 수 (지금 ${answered}건 중 ${differentEntity}건)`,
      failCondition:
        "두 번 다시 재도 착각 비율이 20% 아래로 내려가지 않으면, 소개 문구에 대표 서비스 이름·주소처럼 다른 회사와 겹치지 않는 사실을 더 넣으세요.",
      quotes: v.confusedQuotes,
    }
  );
}

// ──────────────────────────────────────────────────
// 규칙 ② 인지 낮음 — 채널 3개 + 제3자 언급
// ──────────────────────────────────────────────────

export function awarenessActions(sig: RuleSignals): GeoAction[] {
  if (!isAwarenessLow(sig)) {
    return [];
  }
  const evidence = awarenessEvidence(sig);
  const out: GeoAction[] = [];
  const remeasure = sig.verdicts
    ? `AI가 제대로 알아본 답변 수 (지금 ${sig.verdicts.counts.answered}건 중 ${sig.verdicts.counts.confirmed}건)`
    : "등록 브랜드로 확인된 답변 수 (지금 0건)";

  // 해외 시장만 노리는 브랜드에게 네이버를 권하지 않는다(actions.ts 의 시장 원칙과 동일).
  if (sig.marketScope !== "global") {
    out.push(
      card(
        "naver_blog",
        3,
        {
          title: "네이버 블로그에 한 주제로 꾸준히 글을 올리세요",
          evidence,
          how:
            "우리 업종의 한 주제만 정해, 고객이 실제로 묻는 질문에 도움이 되는 글을 꾸준히 올리세요. 첫 문단에 답을 먼저 쓰고, 회사 이름을 정확히 적습니다. " +
            "한 사례 분석(네이버 AI 브리핑 인용 272건)에서는 검색 상위 10위 밖 문서도 인용됐습니다. 그 분석은 기업 블로그 게시의 효과를 잰 것이 아니어서, 이 카드는 Findable의 실행 가설입니다.",
          where: "네이버 블로그(회사 공식 계정)",
          verification:
            "다음 측정에서 네이버·네이버 AI 브리핑·HyperCLOVA X 답변이 우리를 알아봤는지 보세요.",
        },
        {
          evidenceGrade: "weak",
          evidenceBasis: "internal_hypothesis",
          notGuaranteed:
            "매주(주 1회) 올리면 네이버 AI 브리핑이나 HyperCLOVA X 가 우리를 인용·언급한다는 근거는 없습니다. 인용 272건 한 사례의 분포일 뿐입니다.",
          publishCheck:
            "올린 글이 네이버 검색에서 회사 이름이나 글 제목으로 검색되는지(색인) 확인하세요.",
          sources: [RULE_SOURCES.naverBriefing],
          engines: ["naver", "naver-briefing", "hyperclova"],
          effortHours: { min: 2, max: 4, per: "week" },
          effectLag:
            "게시 후 몇 주~몇 달. 실제 반영 시점과 변화는 같은 질문으로 확인하세요.",
          remeasureMetric: remeasure,
          failCondition:
            "Findable 내부 기준으로 3개월(글 12편 안팎) 뒤에도 네이버 계열 답변에서 알아본 답변이 0건이면, 주제를 더 좁히거나 질문 문구를 고객 표현으로 바꾸세요.",
        }
      )
    );
  }

  out.push(
    card(
      "best_lists",
      2,
      {
        title: "제3자의 '추천 OO / best X' 목록 글에 들어가세요",
        evidence,
        how:
          "우리 분야의 '추천 ○○ 5곳', 'best X' 형태의 글을 검색해 찾고, 글쓴이(매체·블로거·비교 사이트)에게 정확한 회사 정보와 함께 소개를 요청하세요. " +
          "직접 쓴 목록 글은 우리 사이트 밖에 있어야 의미가 있습니다. 대가를 주고 실었다면 광고임을 표시해야 합니다.",
        where: "업계 매체·비교 사이트·블로그의 추천 목록 글",
        verification:
          "다음 측정에서 추천형 질문(예: '○○ 추천해줘')에 우리 이름이 나오는지 보세요.",
      },
      {
        evidenceGrade: "medium",
        evidenceBasis: "observational",
        notGuaranteed:
          "ChatGPT 가 추천 목록 글을 많이 인용한다는 관찰입니다. 목록에 실리면 우리 이름이 나온다는 실험 결과는 아닙니다.",
        publishCheck:
          "실린 글의 주소가 공개돼 있고, 검색엔진에서 그 글이 검색되는지(색인) 확인하세요.",
        sources: [RULE_SOURCES.ahrefsBestLists],
        engines: ["chatgpt"],
        effortHours: { min: 4, max: 10, per: "total" },
        effectLag:
          "글이 올라간 뒤 AI 검색이 그 글을 다시 읽어야 반영됩니다(몇 주 이상).",
        remeasureMetric: remeasure,
        failCondition:
          "목록 글 2~3곳에 실린 뒤에도 추천형 질문에서 계속 빠지면, 그 글들이 검색에 잡히는지(색인)부터 확인하세요.",
      }
    )
  );

  out.push(
    card(
      "bing_webmaster",
      2,
      {
        title:
          "Bing 웹마스터 도구에 사이트를 등록해 색인·AI 인용 현황을 확인하세요",
        evidence,
        how:
          "Bing Webmaster Tools 에 사이트를 등록하고 사이트맵을 제출하세요(구글 서치 콘솔 계정으로 가져올 수 있습니다). " +
          "등록하면 Bing 색인 상태와, AI Performance 보고서에서 Copilot·Bing AI 답변이 우리 페이지를 인용한 기록을 직접 볼 수 있습니다. " +
          "한 관찰 연구(SearchGPT, 질문 약 100개)에서는 인용의 대부분이 Bing 상위 결과와 겹쳤지만, Bing 밖 출처도 인용됐습니다.",
        where: "https://www.bing.com/webmasters",
        verification:
          "등록 후 Bing 에서 회사 이름을 검색해 공식 사이트가 나오는지, 다음 측정에서 ChatGPT 답변을 보세요.",
      },
      {
        evidenceGrade: "weak",
        evidenceBasis: "observational",
        notGuaranteed:
          "등록만으로 ChatGPT 인용이 늘지는 않을 수 있습니다. ChatGPT 검색 노출은 OpenAI 의 OAI-SearchBot 접근 등 별도 조건도 있습니다.",
        publishCheck:
          "Bing 웹마스터 도구에서 사이트맵이 처리됐고 주요 페이지가 색인됐는지 확인하세요.",
        sources: [RULE_SOURCES.bingAiPerformance, RULE_SOURCES.seerBing],
        engines: ["chatgpt"],
        effortHours: { min: 0.5, max: 1, per: "total" },
        effectLag: "색인까지 며칠~몇 주.",
        remeasureMetric: remeasure,
        failCondition:
          "2주가 지나도 Bing 에서 공식 사이트가 검색되지 않으면, Bing 도구의 색인 오류 보고서를 먼저 확인하세요.",
      }
    )
  );

  out.push(
    card(
      "web_mentions",
      1,
      {
        title: "YouTube·외부 매체에서 우리 이름이 나오게 하세요",
        evidence,
        how:
          "우리 서비스를 설명하는 YouTube 영상(제목·설명에 회사 이름), 업계 매체 인터뷰·기고, 협력사 사례 소개처럼 우리 사이트 밖에서 이름이 나오는 곳을 늘리세요. " +
          "이 방법은 '많이 언급되는 브랜드가 AI에도 많이 나온다'는 상관관계에 근거합니다 — 언급을 늘리면 반드시 오른다는 뜻은 아닙니다.",
        where: "YouTube 채널·업계 매체·협력사 사이트",
        verification:
          "다음 측정에서 알아본 답변 수와 인용된 외부 출처를 함께 보세요.",
      },
      {
        evidenceGrade: "medium",
        evidenceBasis: "observational",
        notGuaranteed:
          "언급이 많은 브랜드가 AI에도 많이 나온다는 상관관계입니다. 조사 대상은 이미 규모가 있는 브랜드 위주라, 작은 신규 브랜드에 같은 관계가 나타난다는 보장은 없습니다.",
        publishCheck:
          "영상·기사·사례 글이 공개돼 있고, 회사 이름으로 검색했을 때 그 글이 나오는지 확인하세요.",
        sources: [RULE_SOURCES.ahrefsVisibility],
        engines: ["chatgpt", "google"],
        effortHours: { min: 8, max: 20, per: "total" },
        effectLag:
          "외부 언급 후 몇 달 이상. 실제 반영 시점과 변화는 같은 질문으로 확인하세요.",
        remeasureMetric: remeasure,
        failCondition:
          "외부 언급을 여러 건 만든 뒤에도 알아본 답변이 늘지 않으면, 그 글·영상이 회사 이름을 정확히 쓰고 있는지(오타·다른 표기)부터 확인하세요.",
      }
    )
  );
  return out;
}

// ──────────────────────────────────────────────────
// 규칙 ③ 공식 사이트 — 인용 0 이면 기술 전제부터
// ──────────────────────────────────────────────────

/**
 * 공식 페이지 제목·주소를 질문에 맞추는 카드. kind 는 `content_fix` 를 유지한다
 * (콘텐츠 초안 기능 `latest-brief.ts` 가 이 kind 를 찾는다 — 바꾸면 초안 생성이 끊긴다).
 * Princeton 「+41%」 카드를 대체한다.
 */
export function ownedPageAction(sig: RuleSignals, where: string): GeoAction {
  const owned = sig.ownedCitations;
  const noOwned = owned === 0;
  const mentionLine = `${sig.measuredLabel} 중 ${sig.enginesMentioned}곳이 ${sig.brandName}${objectJosa(sig.brandName)} 인지했습니다.`;
  let ownedLine = "";
  if (noOwned) {
    ownedLine = " 공식 사이트가 출처로 인용된 적은 한 번도 없습니다.";
  } else if (owned !== null) {
    ownedLine = ` 공식 사이트가 출처로 인용된 건 ${owned}건입니다.`;
  }
  return card(
    "content_fix",
    noOwned ? 3 : 2,
    {
      title: noOwned
        ? "공식 사이트가 한 번도 인용되지 않았습니다 — 기존 페이지를 보강하고 필요할 때만 새 페이지를 검토하세요"
        : "인용되는 공식 페이지를 보강하고 필요할 때만 새 페이지를 검토하세요",
      evidence: `${mentionLine}${ownedLine}`,
      how:
        "고객이 AI에 실제로 묻는 질문(예: '○○는 어떤 회사야?', '○○ 추천')과 겹치는 기존 페이지가 있다면 먼저 그 페이지를 보강하세요. 내용이 충분히 다를 때만 별도 페이지를 검토하고, 같은 문구의 페이지를 질문마다 복제하지 마세요. " +
        "페이지 제목과 주소(URL)는 실제 내용을 정확히 설명하는 범위에서 구체적으로 쓰고, 첫 문단에 답을 먼저 적습니다. 관찰 연구에서 AI가 인용한 페이지는 제목이 질문과 더 비슷했습니다. " +
        "수치·사례는 확인 가능한 것만 쓰고 원출처를 연결하세요.",
      where,
      verification:
        "다음 측정에서 공식 사이트 인용 수와, 그 질문에서 우리를 알아본 답변 수를 비교하세요.",
    },
    {
      evidenceGrade: "medium",
      evidenceBasis: "observational",
      notGuaranteed:
        "제목을 질문에 맞추면 인용된 페이지와 모양이 비슷해질 뿐, 인용이 늘어난다는 실험 결과는 아닙니다. 같은 문구의 페이지를 여러 개 만들면 품질 문제가 될 수 있습니다.",
      publishCheck:
        "바꾼 페이지가 공개 주소에서 열리고, 검색엔진에서 새 제목으로 검색되는지(색인) 확인하세요.",
      sources: [RULE_SOURCES.ahrefsWhyCited],
      engines: ["chatgpt"],
      effortHours: { min: 2, max: 6, per: "total" },
      effectLag: "AI 검색이 페이지를 다시 읽어 간 뒤(며칠~몇 주).",
      remeasureMetric:
        owned === null
          ? "공식 사이트가 출처로 인용된 수"
          : `공식 사이트가 출처로 인용된 수 (지금 ${owned}건)`,
      failCondition:
        "제목을 바꾼 뒤 두 번 재도 인용 수가 그대로면, 그 페이지가 검색에 색인됐는지와 아래 '서버 렌더링·AI 봇 허용'부터 확인하세요.",
    }
  );
}

/** 인용 0 일 때만 — 봇이 페이지를 못 읽으면 다른 처방은 전부 소용없다(전제 조건). */
export function crawlAccessAction(sig: RuleSignals): GeoAction | null {
  if (sig.ownedCitations !== 0) {
    return null;
  }
  return card(
    "crawl_access",
    3,
    {
      title: "먼저 확인: AI 봇이 우리 페이지 글자를 읽을 수 있나요?",
      evidence:
        "공식 사이트가 출처로 인용된 적이 한 번도 없습니다. 봇이 페이지를 못 읽는 상태라면 다른 처방은 효과가 없습니다.",
      how:
        "① 브라우저에서 '페이지 소스 보기'를 눌렀을 때 본문 글자가 보이는지 확인하세요. Google 은 자바스크립트를 렌더링하지만 모든 봇이 그렇다고 확인된 것은 아니어서, 핵심 본문은 서버 HTML에 두는 편이 안전합니다. " +
        "② robots.txt 에서 OAI-SearchBot·Googlebot 같은 검색·AI 봇을 막고 있지 않은지 확인하세요. 개발자에게 이 두 가지를 그대로 요청하면 됩니다.",
      where: sig.brandDomain
        ? `https://${sig.brandDomain}/robots.txt 및 주요 페이지의 소스`
        : "robots.txt 및 주요 페이지의 소스",
      verification:
        "소스 보기에서 본문이 보이고 robots.txt 가 봇을 막지 않으면 통과입니다. 이후 다음 측정에서 공식 사이트 인용 수를 보세요.",
    },
    {
      evidenceGrade: "strong",
      evidenceBasis: "official_requirement",
      notGuaranteed:
        "봇이 읽을 수 있는 것은 인용의 전제 조건일 뿐입니다. 고친다고 인용이 생긴다는 보장은 없고, 인용 0건이 곧 차단을 뜻하지도 않습니다.",
      publishCheck:
        "고친 뒤 공개 주소의 소스 보기와 robots.txt 를 다시 열어 실제로 반영됐는지 확인하세요.",
      sources: [RULE_SOURCES.googleJsSeo, RULE_SOURCES.openaiBots],
      engines: [],
      effortHours: { min: 1, max: 3, per: "total" },
      effectLag:
        "고친 즉시 봇이 읽을 수 있게 됩니다. 인용은 그 뒤 재수집 시점에 따라 다릅니다.",
      remeasureMetric: "공식 사이트가 출처로 인용된 수 (지금 0건)",
      failCondition:
        "소스 보기에 본문이 없거나 robots.txt 가 봇을 막고 있으면 실패입니다 — 고칠 때까지 다른 처방보다 먼저 하세요.",
    }
  );
}

// ──────────────────────────────────────────────────
// 「하지 마세요」 — 근거 없음(none)
// ──────────────────────────────────────────────────

export const DONT_LIST: DontItem[] = [
  {
    title: "스키마(구조화 데이터)만 붙이고 AI 인용이 늘기를 기대하기",
    reason:
      "스키마를 추가한 1,885개 페이지를 추적한 조사에서 AI 인용이 유의미하게 늘지 않았습니다. 스키마는 회사 정보를 정확히 알리는 용도로만 쓰세요.",
    evidenceGrade: "none",
    sources: [RULE_SOURCES.ahrefsSchema],
  },
  {
    title: "llms.txt 파일만 만들고 AI 노출이 늘기를 기대하기",
    reason:
      "Google 은 AI 기능을 위해 별도 파일을 만들 필요가 없다고 안내하고, 다른 AI 서비스에서의 효과도 확인되지 않았습니다. 파일을 두는 것은 선택 사항이지만, 그것만으로 노출을 기대할 근거는 없습니다.",
    evidenceGrade: "none",
    sources: [RULE_SOURCES.googleAiFeatures],
  },
  {
    title: "글 분량만 늘리기",
    reason:
      "길이 자체가 인용 이유라는 근거는 없습니다. 인용된 페이지는 길이보다 제목이 질문과 맞는지가 더 뚜렷한 차이였습니다.",
    evidenceGrade: "none",
    sources: [RULE_SOURCES.ahrefsWhyCited],
  },
  {
    title: "나무위키에 우리 회사 문서를 직접 쓰거나 고치기",
    reason:
      "당사자가 자기 홍보성 내용을 제3자 글처럼 올리면 표시·광고의 공정화에 관한 법률상 기만적 광고로 문제가 될 수 있고, 되돌려지거나 논란이 되면 오히려 손해입니다.",
    evidenceGrade: "none",
    sources: [RULE_SOURCES.kftcAdAct],
  },
  {
    title: "AI 봇에게만 다른 내용을 보여주는 페이지 만들기",
    reason:
      "사람과 봇에게 다른 내용을 보여주는 것은 클로킹으로, 검색 스팸 정책 위반입니다. 검색에서 빠지면 AI 검색 노출도 함께 사라집니다.",
    evidenceGrade: "none",
    sources: [RULE_SOURCES.googleSpam],
  },
];
