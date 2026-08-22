// 한국 3 엔진 어댑터 — 직접 fetch (AI Gateway 미지원)
//
// 1. HyperCLOVA X (NAVER CLOVA Studio API, HCX-DASH-002)
// 2. Naver Search API (블로그·뉴스·웹문서·지식인) + HyperCLOVA 합성으로 Cue: 90% 재현 (D-008)
// 3. Daum 검색 API (Kakao Developers)
//
// 환경변수 미설정 시 stub 응답.
// Naver Cue: 직접 스크래핑은 D-004에 따라 v1.0 제외 (약관·법적 리스크).

import { sanitizeEngineText } from "./sanitize";
import type {
  CitedSource,
  EngineAdapter,
  EngineId,
  EngineResponse,
} from "./types";
import {
  detectBrandMention,
  estimateSentiment,
  estimateShareOfVoice,
  mentionPositionFields,
} from "./utils";

const STUB_NOTICE_PREFIX =
  "이 AI는 아직 연결되지 않았어요. 다음 측정부터 포함됩니다.";

function makeStubResponse(
  engineId: EngineId,
  prompt: string,
  durationMs: number
): EngineResponse {
  return {
    engineId,
    rawResponse: `${STUB_NOTICE_PREFIX}\n질의: ${prompt.slice(0, 200)}`,
    brandMentioned: false,
    mentionPosition: null,
    mentionListSize: null,
    sentiment: null,
    citedSources: [],
    shareOfVoice: null,
    errorMessage: null,
    durationMs,
    isStub: true,
  };
}

function makeErrorResponse(
  engineId: EngineId,
  message: string,
  durationMs: number
): EngineResponse {
  return {
    engineId,
    rawResponse: "",
    brandMentioned: false,
    mentionPosition: null,
    mentionListSize: null,
    sentiment: null,
    citedSources: [],
    shareOfVoice: null,
    errorMessage: message,
    durationMs,
    isStub: false,
  };
}

// ─────────────────────────────────────────────
// 1. HyperCLOVA X (CLOVA Studio Chat Completions)
// ─────────────────────────────────────────────

const CLOVA_MODEL = process.env.FINDABLE_MODEL_HYPERCLOVA ?? "HCX-DASH-002";
const CLOVA_HOST = "https://clovastudio.stream.ntruss.com";

export const hyperclovaAdapter: EngineAdapter = async (query) => {
  const start = Date.now();
  const apiKey = process.env.CLOVA_STUDIO_API_KEY;
  if (!apiKey) {
    return makeStubResponse("hyperclova", query.prompt, Date.now() - start);
  }

  try {
    const response = await fetch(
      `${CLOVA_HOST}/v3/chat-completions/${CLOVA_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              // ⚠️ 2026-08-02 구조감사 F5: 여기가 query.language 를 무시하고 한국어로
              //   고정돼 있었다(글로벌 어댑터는 global-adapters.ts:198 에서 분기함).
              //   both 모드에서 영어 프롬프트 + 한국어 시스템 프롬프트라는 언어 불일치
              //   상태로 호출돼, 답변 언어가 흔들리고 언급 판정이 불안정해졌다.
              content:
                query.language === "en"
                  ? "You are a search assistant. Answer factually and cite specific brands and sources."
                  : "당신은 한국어 사용자를 위한 검색 어시스턴트입니다. 사실 기반으로 답하고, 구체적인 브랜드와 출처를 명시하세요.",
            },
            { role: "user", content: query.prompt },
          ],
          topP: 0.8,
          topK: 0,
          maxTokens: 1024,
          temperature: 0.5,
          repeatPenalty: 1.1,
          includeAiFilters: true,
        }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      return makeErrorResponse(
        "hyperclova",
        `HyperCLOVA X HTTP ${response.status}: ${body.slice(0, 200)}`,
        Date.now() - start
      );
    }

    const data = (await response.json()) as {
      result?: {
        message?: { content?: string };
        usage?: { promptTokens?: number; completionTokens?: number };
      };
    };
    const text = data.result?.message?.content ?? "";

    return analyzeText(
      "hyperclova",
      text,
      query,
      Date.now() - start,
      [],
      clovaUsage(data)
    );
  } catch (error) {
    return makeErrorResponse(
      "hyperclova",
      error instanceof Error ? error.message : String(error),
      Date.now() - start
    );
  }
};

// ─────────────────────────────────────────────
// 2. Naver Search API (블로그·뉴스·웹문서·지식인) + HyperCLOVA 합성
//    D-008: 공식 검색 API 결과 + HyperCLOVA로 Cue: 답변 재현
// ─────────────────────────────────────────────

interface NaverSearchItem {
  bloggername?: string;
  description?: string;
  link: string;
  postdate?: string;
  title: string;
}

async function naverSearch(query: string): Promise<NaverSearchItem[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!(clientId && clientSecret)) {
    return [];
  }

  // 블로그·뉴스·웹문서 3개 동시 호출
  const endpoints = ["blog", "news", "webkr"];
  const results = await Promise.allSettled(
    endpoints.map(async (kind) => {
      const url = `https://openapi.naver.com/v1/search/${kind}.json?query=${encodeURIComponent(query)}&display=10`;
      const resp = await fetch(url, {
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
      });
      if (!resp.ok) {
        return [];
      }
      const data = (await resp.json()) as { items?: NaverSearchItem[] };
      return data.items ?? [];
    })
  );

  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

export const naverAdapter: EngineAdapter = async (query) => {
  const start = Date.now();
  const clientId = process.env.NAVER_CLIENT_ID;
  const clovaKey = process.env.CLOVA_STUDIO_API_KEY;

  if (!(clientId && clovaKey)) {
    return makeStubResponse("naver", query.prompt, Date.now() - start);
  }

  try {
    const items = await naverSearch(query.prompt);
    if (items.length === 0) {
      return makeErrorResponse(
        "naver",
        "Naver Search API 결과 없음",
        Date.now() - start
      );
    }

    // 검색 결과를 HyperCLOVA에 컨텍스트로 주입 → Cue: 답변 합성
    const context = items
      .slice(0, 8)
      .map(
        (item, i) =>
          `[${i + 1}] ${stripHtml(item.title)}\n출처: ${item.link}\n${stripHtml(item.description ?? "")}`
      )
      .join("\n\n");

    const synthPrompt = `다음 네이버 검색 결과를 참고해 사용자 질의에 답변하세요. 인용한 자료의 [번호]를 답변에 표시하세요.\n\n[검색 결과]\n${context}\n\n[질의] ${query.prompt}`;

    const synthResp = await fetch(
      `${CLOVA_HOST}/v3/chat-completions/${CLOVA_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${clovaKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "당신은 네이버 검색 결과를 종합하는 한국어 답변 합성 어시스턴트입니다.",
            },
            { role: "user", content: synthPrompt },
          ],
          maxTokens: 1024,
          temperature: 0.4,
        }),
      }
    );

    if (!synthResp.ok) {
      return makeErrorResponse(
        "naver",
        `Naver+HyperCLOVA 합성 실패 HTTP ${synthResp.status}`,
        Date.now() - start
      );
    }

    const synthData = (await synthResp.json()) as {
      result?: {
        message?: { content?: string };
        usage?: { promptTokens?: number; completionTokens?: number };
      };
    };
    const text = synthData.result?.message?.content ?? "";

    // 인용 출처는 검색 결과 URL을 그대로 사용 (재배포 금지에 따라 메타데이터만)
    const citedSources: CitedSource[] = items.slice(0, 8).map((item) => ({
      url: item.link,
      domain: safeHostname(item.link),
      title: stripHtml(item.title),
    }));

    return analyzeText(
      "naver",
      text,
      query,
      Date.now() - start,
      citedSources,
      clovaUsage(synthData)
    );
  } catch (error) {
    return makeErrorResponse(
      "naver",
      error instanceof Error ? error.message : String(error),
      Date.now() - start
    );
  }
};

// ─────────────────────────────────────────────
// 3. Daum Search API (Kakao Developers)
// ─────────────────────────────────────────────

interface DaumSearchDoc {
  blogname?: string;
  contents: string;
  datetime?: string;
  title: string;
  url: string;
}

export const daumAdapter: EngineAdapter = async (query) => {
  const start = Date.now();
  const restKey = process.env.KAKAO_REST_API_KEY;
  if (!restKey) {
    return makeStubResponse("daum", query.prompt, Date.now() - start);
  }

  try {
    // 카카오 검색 헬퍼 — 주어진 쿼리로 web·blog·cafe 3개 동시 호출.
    const searchKakao = async (q: string): Promise<DaumSearchDoc[]> => {
      const endpoints = ["web", "blog", "cafe"];
      const res = await Promise.allSettled(
        endpoints.map(async (kind) => {
          const url = `https://dapi.kakao.com/v2/search/${kind}?query=${encodeURIComponent(q)}&size=10`;
          const resp = await fetch(url, {
            headers: { Authorization: `KakaoAK ${restKey}` },
          });
          if (!resp.ok) {
            return [];
          }
          const data = (await resp.json()) as { documents?: DaumSearchDoc[] };
          return data.documents ?? [];
        })
      );
      return res.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    };

    // P0-c (2026-07-27) Daum 판정 정합:
    //   Daum은 검색 스니펫 raw(LLM 합성 없음)라, 경쟁사 나열형 프롬프트로 검색하면
    //   결과 스니펫에 브랜드가 안 담겨 "미언급" 오판정(LLM 엔진과 사과-오렌지).
    //   → 원래 프롬프트 검색(맥락)에 더해, 브랜드명 자체로도 검색해 "이 브랜드가
    //     다음/카카오에 실재하는가"를 판정 근거에 포함. 브랜드 문서가 있으면 언급O로
    //     정합(LLM이 브랜드를 되뇌어 언급 잡히는 것과 동일 잣대).
    const brandQuery = query.brandName?.trim();
    const [promptDocs, brandDocs] = await Promise.all([
      searchKakao(query.prompt),
      brandQuery && brandQuery !== query.prompt
        ? searchKakao(brandQuery)
        : Promise.resolve([]),
    ]);

    if (promptDocs.length === 0 && brandDocs.length === 0) {
      return makeErrorResponse(
        "daum",
        "Daum/Kakao 검색 결과 없음",
        Date.now() - start
      );
    }

    // Daum/Kakao는 자체 LLM 합성 API가 없으므로 검색 결과를 raw로 보존.
    // v1.5에서 카카오 i Open Builder 또는 KoGPT로 합성 추가 검토.
    // 프롬프트 검색 결과를 앞에, 브랜드 검색 결과를 뒤에 배치(맥락 우선·브랜드 존재 보강).
    const docs: DaumSearchDoc[] = [...promptDocs, ...brandDocs];

    // 🔴 세션N-14: **판정용 텍스트와 표시용 텍스트를 분리한다.**
    //
    //   실측(2026-08-10): daum 응답 279건 중 **129건(46%)** 에서 브랜드와 무관한 문서가
    //   "AI 답변"으로 고객 화면에 실려 나갔다 — 조선미녀 진단에 *"나무위키:접근 제한/문서
    //   목록… 화성의과학대학교, 푸바오"*, 메디큐브에 *"아이폰 단축어, 노션"*.
    //   원인은 위 P0-c 가 브랜드명으로도 검색해 뒤에 붙이는데, 카카오 검색이 엉뚱한 문서를
    //   반환하면 **그게 그대로 근거 텍스트가 되기** 때문이다(정식 명칭 = contamination /
    //   label leakage). 파이프라인에서 분리하는 것 말고는 측정으로 고칠 수 없다.
    //
    // ⚠️ **점수는 1도 바뀌면 안 된다.** `analyzeText` 는 넘긴 텍스트 하나로 언급·감성·SoV·
    //   순위를 **전부** 계산하므로, 표시에서 뺀 텍스트를 판정에도 그대로 쓰면 P0-c 가 풀던
    //   "사과-오렌지" 문제가 되살아나고 소급 점수와도 어긋난다.
    //   → 판정 입력은 기존과 **완전히 동일**(promptDocs + brandDocs)하게 두고,
    //     `rawResponse`(화면 근거)만 무관 문서를 걸러 낸다.
    //   🔬 실측 근거: daum 언급률은 46%로 8개 엔진 중 **최저**라 오히려 점수를 낮추고 있었다
    //     ("가짜 언급이 점수를 부풀린다"는 가설은 실측으로 **틀렸다**). 그러므로 손댈 곳은
    //     화면 텍스트뿐이다. 소급 데이터도 건드리지 않는다(표시층만 수정).
    const scoringDocs = docs.slice(0, 13);
    const displayDocs = filterBrandRelevantDocs(
      scoringDocs,
      promptDocs,
      query.brandName,
      query.brandVariants
    );

    const renderDocs = (list: DaumSearchDoc[]) =>
      list
        .map(
          (doc, i) =>
            `[${i + 1}] ${stripHtml(doc.title)}\n${stripHtml(doc.contents)}\n출처: ${doc.url}`
        )
        .join("\n\n");

    // 인용 출처도 화면에 나가므로 표시용 목록을 따른다(근거 텍스트와 출처가 어긋나면
    // "이 문서가 왜 여기 있지"가 된다).
    const citedSources: CitedSource[] = displayDocs.map((doc) => ({
      url: doc.url,
      domain: safeHostname(doc.url),
      title: stripHtml(doc.title),
    }));

    return analyzeText(
      "daum",
      renderDocs(scoringDocs),
      query,
      Date.now() - start,
      citedSources,
      undefined,
      renderDocs(displayDocs)
    );
  } catch (error) {
    return makeErrorResponse(
      "daum",
      error instanceof Error ? error.message : String(error),
      Date.now() - start
    );
  }
};

/**
 * 화면 근거로 내보낼 문서만 남긴다 — **표시 전용. 점수에는 절대 쓰지 않는다.**
 *
 * 배경(2026-08-10 실측): daum 응답 279건 중 **129건(46%)** 에 브랜드와 무관한 문서가
 * "AI 답변"으로 섞여 나갔다. 카카오 검색이 브랜드명 질의에 엉뚱한 문서를 돌려주면
 * (*"나무위키:접근 제한/문서 목록"*, *"푸바오"*, *"아이폰 단축어"*) 그게 그대로
 * 고객 화면의 근거가 된다.
 *
 * 판정 규칙 — **프롬프트 검색 결과는 무조건 남긴다.**
 *   프롬프트로 찾은 문서는 브랜드명이 없어도 **경쟁 지형이라는 맥락 자체가 근거**다
 *   (*"수분크림 추천 10선"* 에 우리 브랜드가 없다는 사실이 곧 진단 결과다).
 *   반대로 **브랜드명으로 따로 검색해 붙인 문서**는 브랜드가 실제로 담겨 있을 때만
 *   근거 자격이 있다 — 그러라고 넣은 검색이기 때문이다.
 *
 * ⚠️ 브랜드 매칭은 반드시 `detectBrandMention` 을 쓴다. 여기서 자체 문자열 비교를
 *   새로 짜면 판정과 표시가 **다른 잣대**로 갈라진다(같은 계열 사고 이력 있음).
 */
function filterBrandRelevantDocs(
  docs: DaumSearchDoc[],
  promptDocs: DaumSearchDoc[],
  brandName: string | undefined,
  brandVariants: string[] = []
): DaumSearchDoc[] {
  // 브랜드명이 없으면 거를 기준 자체가 없다 → 원본 유지(기존 동작).
  if (!brandName?.trim()) {
    return docs;
  }
  // 프롬프트 검색분은 URL 로 식별한다(동일 문서가 양쪽에 잡히면 맥락 쪽을 우선).
  const promptUrls = new Set(promptDocs.map((d) => d.url));
  return docs.filter((doc) => {
    if (promptUrls.has(doc.url)) {
      return true;
    }
    // 브랜드 검색으로 붙은 문서 — 제목·본문 어디든 브랜드가 실재해야 남긴다.
    // 🔴 반드시 **정제 후에** 매칭한다. 카카오는 검색어에 `<b>` 하이라이트를 씌워 주므로
    //   (`<b>조선미녀</b>`) 원문 그대로 비교하면 태그가 글자 사이에 끼어 **브랜드가 실려
    //   있는 문서를 오히려 버린다.** 판정(`analyzeText`)도 정제 후 매칭이라 잣대가 같아진다.
    return detectBrandMention(
      sanitizeEngineText(`${doc.title}\n${doc.contents}`),
      brandName,
      brandVariants
    ).mentioned;
  });
}

// ─────────────────────────────────────────────
// 공통 분석 + 헬퍼
// ─────────────────────────────────────────────

function analyzeText(
  engineId: EngineId,
  rawText: string,
  query: { brandName?: string; brandVariants?: string[] },
  durationMs: number,
  preExtractedSources: CitedSource[],
  usage?: EngineResponse["usage"],
  /**
   * 화면에 근거로 나갈 텍스트. **생략하면 `rawText` 와 같다**(기존 동작).
   *
   * 🔴 세션N-14 신설 — daum 전용. 검색 엔진은 브랜드와 무관한 문서를 섞어 주는데,
   *   그게 그대로 "AI 답변"으로 고객 화면에 나가고 있었다(279건 중 129건).
   *   판정(`rawText`)은 손대지 않고 **표시만** 걸러 내기 위한 통로다.
   * ⚠️ 이 값은 **점수 계산에 절대 쓰지 않는다** — 쓰는 순간 소급 점수와 어긋난다.
   */
  displayText?: string
): EngineResponse {
  // 🔴 세션N-13: 정제를 **판정 전에** 한다. 순서가 중요하다 —
  //   `&lt;b&gt;브랜드&lt;/b&gt;` 처럼 인코딩된 텍스트는 디코딩해야 브랜드명이 잡히고,
  //   반대로 `&#39;` 가 남아 있으면 화면에 코드가 그대로 보인다(실측 868회).
  //   저장·판정·표시가 **같은 텍스트**를 쓰게 해서 "화면과 점수가 다른" 계열 사고를 막는다.
  const text = sanitizeEngineText(rawText);
  const mention = detectBrandMention(
    text,
    query.brandName,
    query.brandVariants
  );
  // 표시용이 따로 오면 그것도 같은 정제를 통과시킨다(정제의 단일 진실 유지).
  //   ⚠️ 걸러 낸 결과가 비면 원문으로 되돌린다 — 근거가 **빈 화면**으로 나가느니
  //     맥락이 섞인 원문이 낫다(정보 0 > 오염된 정보 가 아니다).
  const sanitizedDisplay =
    displayText === undefined ? text : sanitizeEngineText(displayText);
  return {
    engineId,
    rawResponse: sanitizedDisplay.trim().length === 0 ? text : sanitizedDisplay,
    brandMentioned: mention.mentioned,
    ...mentionPositionFields(text, query.brandName, query.brandVariants),
    sentiment: estimateSentiment(text, query.brandName),
    citedSources: preExtractedSources,
    shareOfVoice: estimateShareOfVoice(
      text,
      query.brandName,
      query.brandVariants
    ),
    errorMessage: null,
    durationMs,
    isStub: false,
    usage,
  };
}

// CLOVA Studio v3 응답의 usage → EngineUsage. 필드 형태 변동 대비 안전 파싱.
function clovaUsage(data: {
  result?: { usage?: { promptTokens?: number; completionTokens?: number } };
}): EngineResponse["usage"] {
  const u = data.result?.usage;
  return {
    inputTokens: typeof u?.promptTokens === "number" ? u.promptTokens : null,
    outputTokens:
      typeof u?.completionTokens === "number" ? u.completionTokens : null,
    costModel: "token",
  };
}

/**
 * ⚠️ 2026-08-10 세션N-13: 공용 `sanitizeEngineText` 로 위임한다.
 *
 * 예전 구현은 두 가지가 틀렸다(전수감사에서 실측):
 *   ① `/&[a-z]+;/gi` 라 **숫자형 엔티티를 못 잡았다** — `&#39;` `&#34;` 가 **868회** 통과해
 *      `It&#39;s On` 이 고객 화면에 그대로 렌더됐다(사용자 캡처 제보).
 *   ② 엔티티를 **공백으로 치환**했다 — 디코딩이 아니라서 `It&#39;s` → `It s` 로 글자가 망가진다.
 *   ③ 태그를 먼저 지워 순서가 뒤집혀 있었다(→ `&lt;b&gt;` 처리 불가).
 */
const stripHtml = sanitizeEngineText;

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
