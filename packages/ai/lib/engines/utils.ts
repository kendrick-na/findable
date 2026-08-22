// 엔진 응답 분석 유틸 — 브랜드 언급 추출, 인용 출처 파싱

import type { CitedSource } from "./types";

/**
 * 답변 텍스트에서 브랜드명·변형 표기를 모두 검색해
 * 첫 등장 위치(0-based char index)와 mention 여부 반환.
 */
export function detectBrandMention(
  text: string,
  brandName: string | undefined,
  brandVariants: string[] = []
): { mentioned: boolean; firstIndex: number | null } {
  if (!brandName) {
    return { mentioned: false, firstIndex: null };
  }
  const candidates = [brandName, ...brandVariants]
    .filter(Boolean)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);

  let firstIndex: number | null = null;
  const lowered = text.toLowerCase();
  for (const candidate of candidates) {
    const idx = lowered.indexOf(candidate.toLowerCase());
    if (idx !== -1 && (firstIndex === null || idx < firstIndex)) {
      firstIndex = idx;
    }
  }
  return { mentioned: firstIndex !== null, firstIndex };
}

/**
 * 번호 매겨진 답변에서 브랜드의 순위 + **그 목록의 총 항목 수(분모)** 추정.
 *
 * 판정:
 *   1. 마크다운 강조(**브랜드**)된 번호 줄 — "1. **브랜드**"
 *   2. 평문 번호 줄 — "1. 브랜드 ..." 또는 "1) 브랜드 ..."
 *   3. 그 외 — null (**순위를 매길 상황이 아님**)
 *
 * 🔴 2026-08-07 세션N-10 — "카테고리형 폴백"(브랜드가 앞 30% 안에 있고 번호줄이 3개 이상이면
 *    무조건 1위) 을 **제거**했다. 그 폴백은 **목록 안에 브랜드가 있는지를 보지 않아**
 *    거짓 1위를 만들었다. 저장된 원문 54행 실측:
 *      · 순위 보유 26건 중 **11건(42%)이 이 폴백** = 측정이 아니라 가정
 *      · 그중 5건은 *"나이키 **외에** 다른 러닝화"* 처럼 **브랜드가 목록에 아예 없는** 답변
 *        (아디다스·아식스·브룩스만 나열)인데 **나이키 1위**로 기록됐다
 *      · 나머지 6건은 자사 제품 나열(엔비디아→지포스/테슬라GPU)로, 경쟁자가 없는 목록이라
 *        "1위"라는 말 자체가 성립하지 않는다
 *    → 두 유형 모두 `null`. **언급 사실은 `brandMentioned` 가 이미 정확히 담고 있고**,
 *      여기서 없는 순위를 지어내면 competition 점수(10점 배점)까지 부풀린다.
 *    ⚠️ 되돌리지 말 것. 되돌리면 고객 점수가 다시 관대해진다.
 *
 * 📐 `listSize`(분모)를 함께 반환하는 이유: *"2개 중 1위"* 와 *"50개 중 1위"* 는 전혀 다른데
 *    순위 숫자만으로는 구분되지 않는다. 화면 표기("5개 중 1번째")와 competition 채점 양쪽이
 *    이 분모를 쓴다. 같은 코드베이스의 `competitor-extract.ts` 가 이미 `brandInRanking`
 *    (번호목록 실등장)을 `brandFound`(어디든 언급)와 분리해 둔 것과 같은 구분이다.
 */
export interface MentionPosition {
  /** 이 답변의 번호 목록 총 항목 수(분모). "N개 중 position 번째". */
  listSize: number;
  /** 목록에서 브랜드의 자리(1-based). */
  position: number;
}

const NUMBERED_LINE_PATTERN =
  /(?:^|\n)\s*(?:\*{0,2})\s*(\d{1,2})[.)]\s*(?:\*{0,2})\s*([^\n]+)/g;

export function estimateMentionPosition(
  text: string,
  brandName: string | undefined,
  brandVariants: string[] = []
): MentionPosition | null {
  if (!brandName) {
    return null;
  }
  const candidates = [brandName, ...brandVariants]
    .filter(Boolean)
    .map((s) => s.toLowerCase().trim())
    .filter((s) => s.length >= 2);
  if (candidates.length === 0) {
    return null;
  }

  // 번호 매겨진 줄에서 브랜드 매칭 — 마크다운 강조 포함
  //   "1. **브랜드**" "1) 브랜드" "**1. 브랜드**" 등 다양한 패턴
  const matches = [...text.matchAll(NUMBERED_LINE_PATTERN)];
  if (matches.length === 0) {
    return null;
  }

  // 분모 = 목록의 최대 번호. 항목 수(matches.length)가 아니라 **번호 자체의 최댓값**을 쓴다.
  //   실측(나이키/Gemini): 한 답변에 "1.2.3." 목록이 두 번 나오면 matches.length=6 이지만
  //   각 목록은 3개짜리다 → 6을 분모로 쓰면 "6개 중 1번째"라는 거짓말이 된다.
  //   최댓값은 두 목록 모두에서 3이라 안전하다.
  const listSize = matches.reduce((max, m) => {
    const n = Number.parseInt(m[1], 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  if (listSize === 0) {
    return null;
  }

  for (const m of matches) {
    const rank = Number.parseInt(m[1], 10);
    const lineLower = m[2].toLowerCase();
    if (candidates.some((c) => lineLower.includes(c))) {
      // 분모보다 큰 순위는 나올 수 없다(같은 배열에서 뽑았으므로 방어적 clamp).
      return { position: rank, listSize: Math.max(listSize, rank) };
    }
  }

  return null;
}

/**
 * 어댑터용 어댑터 — `estimateMentionPosition` 결과를 `EngineResponse` 의 두 평면 필드로 편다.
 * 어댑터 4곳(korean·global·chatgpt-web·naver-briefing)이 같은 분해를 복제하지 않도록 여기 한 곳에 둔다
 * (같은 계산을 여러 벌 두지 않는다 — 과거 점수 4경로 불일치의 원인이었다).
 */
export function mentionPositionFields(
  text: string,
  brandName: string | undefined,
  brandVariants: string[] = []
): { mentionListSize: number | null; mentionPosition: number | null } {
  const found = estimateMentionPosition(text, brandName, brandVariants);
  return {
    mentionPosition: found?.position ?? null,
    mentionListSize: found?.listSize ?? null,
  };
}

const URL_PATTERN = /https?:\/\/[^\s)\]}]+/g;
/**
 * URL 꼬리에 붙어 오는 문장부호·마크업을 떼어낸다.
 *
 * 🔴 **백틱·따옴표·괄호를 빼먹고 있었다**(N-47 · 라이브 스크린샷이 잡음).
 *   `[.,;:!?]` 만 떼서 실제로 이런 게 **도메인으로 저장**됐다:
 *
 *     {"url": "https://www.sulwhasoo.com`", "domain": "www.sulwhasoo.com`"}
 *
 *   화면에는 **`sulwhasoo.com``** 이 `sulwhasoo.com` 과 **별개 줄**로 떴다(같은 사이트인데).
 *   ⚠️ 더 나쁜 건 **자사 제외가 안 걸린다**는 점이다 — 백틱 때문에 도메인 비교가 빗나가
 *   *"AI 가 참고한 외부 출처"* 인 척 남는다(N-47 에 고친 그 문제가 되살아난다).
 *
 * AI 는 답변에 마크다운을 쓴다: `` `https://x.com` `` · "https://x.com" · (https://x.com).
 * 그 껍데기가 URL 의 일부로 저장되면 **같은 도메인이 여러 개로 쪼개진다**.
 */
// 🔴🔴 **마크다운 강조(`**`·`*`·`_`)를 반드시 포함한다**(N-48 · 2026-08-20 실측).
//   AI 는 본문에 `**https://www.sulwhasoo.com**` 처럼 **굵게** 써서 보낸다.
//   `**` 를 안 벗기면 도메인이 `www.sulwhasoo.com**` 가 되고 —
//   🔴 **자사 도메인 제외 필터가 빗나간다**(문자열이 안 맞으니 `owned` 비교 실패).
//   그러면 N-47 이 막으려던 *"자기 홈페이지를 근거라고 보여주는"* 상태가 되살아난다.
//   실측: 프로덕션 ChatGPT 인용에 `https://www.sulwhasoo.com**` 가 실제로 들어 있었다.
//   📕 N-47 이 백틱(`` ` ``)만 고친 것과 **같은 유형** — 강조 문자는 여러 개다.
const TRAILING_PUNCT = /[.,;:!?`'"’”)\]>*_~]+$/;
const LEADING_WWW = /^www\./;

// P1-e(2026-07-27) 출처 오염 필터용 — LLM이 예시·환각으로 뱉는 명백한
// 무관/플레이스홀더 도메인. 본문 URL 폴백에서만 적용(provider citation엔 미적용).
const POLLUTION_HOST_PATTERNS: RegExp[] = [
  /(^|\.)example\.(com|org|net)$/,
  /(^|\.)test\.(com|org)$/,
  /(^|\.)localhost$/,
  /(^|\.)yourbrand\./,
  /(^|\.)yourdomain\./,
  /(^|\.)domain\.(com|tld)$/,
  /(^|\.)site\.(com|tld)$/,
];

function normalizeHostForCitation(host: string): string {
  return host.toLowerCase().replace(LEADING_WWW, "");
}

/** 검색 그라운딩 리다이렉터 — 이 호스트는 「출처」가 아니라 **껍데기**다. */
const REDIRECT_HOSTS =
  /^(vertexaisearch\.cloud\.google\.com|www\.google\.com)$/i;
/** `title` 이 도메인 모양인가(`example.com`·`blog.naver.com`). 경로·공백은 배제. */
const LOOKS_LIKE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/**
 * 리다이렉터 호스트면 `title` 의 실제 도메인으로 바꾼다(N-47).
 * ⚠️ **title 이 도메인 모양일 때만** 쓴다 — 글 제목("설화수 후기 – 티스토리")이 오면
 *   그건 도메인이 아니므로 손대지 않는다(엉뚱한 값을 도메인 칸에 넣지 않는다).
 */
function redirectSafeDomain(hostname: string, title?: string): string {
  if (!(REDIRECT_HOSTS.test(hostname) && title)) {
    return hostname;
  }
  const candidate = title.trim().toLowerCase().replace(LEADING_WWW, "");
  return LOOKS_LIKE_DOMAIN.test(candidate) ? candidate : hostname;
}

function isPollutedHost(host: string): boolean {
  const h = normalizeHostForCitation(host);
  return POLLUTION_HOST_PATTERNS.some((re) => re.test(h));
}

/**
 * provider가 반환한 citation sources(perplexity·gemini 등 검색 기반 모델)를
 * CitedSource로 변환. url 타입만 취함. 본문 정규식 추출보다 신뢰도 높음(P1-e).
 * `sources`는 AI SDK generateText 결과의 sources 배열(형태만 취해 결합도 최소화).
 */
export function mapProviderSources(
  sources: Array<{
    sourceType?: string;
    url?: string;
    title?: string;
  }>
): CitedSource[] {
  const seen = new Set<string>();
  const out: CitedSource[] = [];
  for (const s of sources) {
    if (s.sourceType !== "url" || !s.url) {
      continue;
    }
    const url = s.url.replace(TRAILING_PUNCT, "");
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    try {
      const parsed = new URL(url);
      out.push({
        url,
        // 🔴🔴 **Google 그라운딩은 도메인을 `title` 에 담아 보낸다**(N-47 라이브 실측).
        //   `url` 은 리다이렉터다: `vertexaisearch.cloud.google.com/grounding-api-redirect/…`
        //   그대로 쓰면 화면의 「출처」가 **전부 같은 구글 주소 한 줄**이 된다 —
        //   *"AI 가 무엇을 보고 우리를 말하는가"* 에 **아무 답도 못 준다**(고객이 못 고친다).
        //   실측: title=`apgroup.com`·`tistory.com`·`sulwhasoo.com` ← **이게 진짜 출처다.**
        //   ⚠️ 리다이렉터는 열어봐야 최종 주소를 알 수 있는데, 그러면 인용마다 HTTP 요청이
        //     붙는다(원가·지연). title 이 이미 도메인이므로 **그걸 신뢰한다.**
        domain: redirectSafeDomain(parsed.hostname, s.title),
        ...(s.title ? { title: s.title } : {}),
      });
    } catch {
      // skip invalid URL
    }
  }
  return out;
}

/**
 * 답변 본문에서 URL 추출 + 도메인 정규화. provider citation이 없는 엔진의 폴백.
 * P1-e: 명백한 예시·플레이스홀더 도메인(example.com 등)은 오염으로 간주해 제외.
 */
export function extractCitedSources(
  text: string,
  /**
   * 측정 대상 브랜드의 자사 도메인. 주면 **본문에 적힌 자사 주소를 인용에서 뺀다**.
   *
   * 🔴🔴 **왜 빼나**(N-47 · 2026-08-19 프로덕션 실측): 이 폴백이 채운 「출처」의 정체가
   *   `nvidia.com` · `amd.com` · `intel.com` 같은 **브랜드 홈페이지 주소**였다.
   *   그건 AI 가 **읽은 문서가 아니라 답변 본문에 타이핑한 주소**다.
   *
   *   Findable 이 파는 것은 *"AI 가 **무엇을 보고** 우리를 말하는가"* 인데,
   *   자기 홈페이지 주소를 「참고한 출처」라고 보여주면 **고객이 헛일을 한다**
   *   (이미 자기 것인 페이지를 고치러 간다). 📕 *"못 잰 것을 0이라 부르지 않기"* 의 짝 —
   *   **안 잰 것을 잰 것처럼 채우지도 않는다.**
   *
   * ⚠️ **외부 URL 폴백은 유지한다.** AI 가 본문에 쓴 *다른* 사이트(나무위키·다나와 등)는
   *   여전히 정보다. 전면 차단하면 쓸 만한 신호까지 버린다(👤 결정: 자사만 제외).
   */
  ownedDomain?: string
): CitedSource[] {
  const owned = ownedDomain ? normalizeHostForCitation(ownedDomain) : undefined;
  const matches = text.match(URL_PATTERN) ?? [];
  const seen = new Set<string>();
  const sources: CitedSource[] = [];
  for (const raw of matches) {
    const url = raw.replace(TRAILING_PUNCT, "");
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    try {
      const parsed = new URL(url);
      if (isPollutedHost(parsed.hostname)) {
        continue;
      }
      // 자사 도메인·서브도메인은 「AI 가 읽은 근거」로 세지 않는다.
      if (owned) {
        const host = normalizeHostForCitation(parsed.hostname);
        if (host === owned || host.endsWith(`.${owned}`)) {
          continue;
        }
      }
      sources.push({ url, domain: parsed.hostname });
    } catch {
      // skip invalid URL
    }
  }
  return sources;
}

/**
 * 휴리스틱 sentiment. v1.0은 키워드 기반, v1.5에서 CrewAI '수진' 에이전트가 정밀 분석.
 */
export function estimateSentiment(
  text: string,
  brandName: string | undefined
): "positive" | "neutral" | "negative" | null {
  if (!(brandName && text)) {
    return null;
  }
  const lowered = text.toLowerCase();
  const idx = lowered.indexOf(brandName.toLowerCase());
  if (idx === -1) {
    return null;
  }
  // 브랜드 언급 주변 ±100자 추출
  const window = lowered.slice(
    Math.max(0, idx - 100),
    idx + brandName.length + 100
  );

  const positive = [
    "best",
    "great",
    "excellent",
    "top",
    "leader",
    "popular",
    "love",
    "recommend",
    "최고",
    "추천",
    "인기",
    "좋",
    "1위",
    "최상",
  ];
  const negative = [
    "worst",
    "bad",
    "avoid",
    "poor",
    "disappoint",
    "outdated",
    "최악",
    // 🔴 `별로` 를 뺐다 (2026-08-16 세션N-34 · 실측).
    //   한국어 `별로` 는 **조사**로 훨씬 자주 쓰인다 — `용도별로`·`목적별로`·`가격대별로`.
    //   이 함수는 부분 문자열로 세기 때문에 그걸 전부 **부정 1점**으로 깎고 있었다.
    //   🔬 실측(rawResponse 75행 · 브랜드 언급 ±100자 창): `별로` 등장 **4건이
    //     전부 조사형**(`용도별로`×3·`목적별로`×1) · **진짜 부정 0건**.
    //     → 이 단어가 잡아낸 부정은 **하나도 없고 오탐만 만들었다**.
    //   ⚠️ 부사 `별로(=그다지)` 는 보통 `별로 좋지 않다` 처럼 **다른 부정 표현과 함께**
    //     오므로, 빼도 진짜 부정을 놓칠 위험이 낮다(`실망`·`단점`·`비추` 가 남아 있다).
    //   ⛔ 단어 경계 정규식으로 "고치는" 길은 택하지 않았다 — 한국어는 교착어라
    //     `별로` 앞뒤 형태가 열려 있어, 경계 규칙이 곧 **또 다른 추측**이 된다.
    "비추",
    "실망",
    "단점",
  ];

  let score = 0;
  for (const k of positive) {
    if (window.includes(k)) {
      score++;
    }
  }
  for (const k of negative) {
    if (window.includes(k)) {
      score--;
    }
  }

  if (score >= 2) {
    return "positive";
  }
  if (score <= -2) {
    return "negative";
  }
  return "neutral";
}

/**
 * 응답 안에서 브랜드의 점유율 추정.
 * 동일 카테고리 내 다른 브랜드 언급 횟수 대비 비율.
 * v1.0 단순 휴리스틱. 정밀 측정은 CrewAI Alex 에이전트.
 */
export function estimateShareOfVoice(
  text: string,
  brandName: string | undefined,
  brandVariants: string[] = []
): number | null {
  if (!brandName) {
    return null;
  }
  const lowered = text.toLowerCase();
  const candidates = [brandName, ...brandVariants]
    .filter(Boolean)
    .map((s) => s.toLowerCase());

  let brandHits = 0;
  for (const c of candidates) {
    const re = new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    brandHits += (lowered.match(re) ?? []).length;
  }
  if (brandHits === 0) {
    return 0;
  }

  // 대문자로 시작하는 토큰을 brand-like 후보로 카운트 (단순 추정)
  const titleCaseTokens = text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];
  const totalCandidates = Math.max(brandHits, titleCaseTokens.length);
  return Math.min(1, brandHits / Math.max(totalCandidates, 1));
}

/**
 * 🔴🔴 **Perplexity 는 자체 API 키로 직접 호출한다**(Gateway 아님 — N-48 정정).
 *   그런데 `createOpenAI` **OpenAI 호환 껍데기**로 부르기 때문에, AI SDK 의 표준
 *   `sources` 배열이 **항상 빈다** → 프로덕션 실측 **47/47 출처 0** 의 진짜 원인이다.
 *   ⚠️ N-47 은 이걸 「Gateway 크레딧 0」 탓으로 적었는데 **인과가 틀렸다**:
 *     크레딧은 *Gateway 로 돌려본 실험* 이 실패한 이유일 뿐이고, 되돌린 지금
 *     라이브 경로는 직접 호출이라 **크레딧과 무관하게** 출처가 비어 있었다.
 *
 * Perplexity 는 인용을 **OpenAI 규격 밖 필드**에 실어 보낸다(📕 공식 문서
 * `api-reference/chat-completions-post`). OpenAI provider 는 스키마에 없는 필드를
 * 잘라내므로, **원시 응답 body** 에서 직접 꺼내야 한다.
 *
 * | 필드 | 형태 | 비고 |
 * |---|---|---|
 * | `search_results` | `{title, url, date?, snippet?}[]` | ⭐ 제목까지 온다 — 이게 상위 |
 * | `citations` | `string[]`(URL 만) | 구형 필드 · 폴백 |
 *
 * ⭐ **도메인 정규화·중복제거·꼬리문자 제거는 `mapProviderSources` 를 재사용**한다
 *   (같은 일을 두 벌로 짜면 한쪽만 고쳐져 갈라진다 — 이 저장소 규율).
 */
export function extractPerplexitySources(body: unknown): CitedSource[] {
  if (!body || typeof body !== "object") {
    return [];
  }
  const root = body as Record<string, unknown>;

  // ⭐ search_results 우선: title 이 있어 화면에서 «무엇을 읽었나»를 말해준다.
  const results = root.search_results;
  if (Array.isArray(results)) {
    const mapped = mapProviderSources(
      results
        .filter(
          (r): r is Record<string, unknown> => !!r && typeof r === "object"
        )
        .map((r) => ({
          sourceType: "url",
          url: typeof r.url === "string" ? r.url : undefined,
          title: typeof r.title === "string" ? r.title : undefined,
        }))
    );
    if (mapped.length > 0) {
      return mapped;
    }
  }

  // 폴백: citations 는 URL 문자열 배열이다(제목 없음).
  const citations = root.citations;
  if (Array.isArray(citations)) {
    return mapProviderSources(
      citations
        .filter((c): c is string => typeof c === "string")
        .map((url) => ({ sourceType: "url", url }))
    );
  }
  return [];
}
