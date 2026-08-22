// 네이버 AI 브리핑 어댑터 — Firecrawl HTTP 렌더 (2026-07-29 전환)
//
// 전환 사유 (Browserbase CDP → Firecrawl):
//   Vercel Serverless 는 Browserbase 로 나가는 아웃바운드 WebSocket(wss/connectOverCDP)을
//   구조적으로 못 맺는다(region·timeout 무관, 2026-07-29 실측 확정).
//   → WebSocket 을 버리고 Firecrawl `/v2/scrape` HTTP 한 방으로 렌더된 HTML 을 받는다.
//   Browserbase·playwright-core 의존성 제거. 네이버 KR 캡차는 Firecrawl location=KR 에 위임.
//   상세=메모리 reference_vercel_browserbase_stagehand.
//
// 동작:
//   1. Firecrawl POST /v2/scrape (url=네이버 검색, rawHtml, location KR, waitFor)
//   2. 응답 HTML 에서 AI 브리핑 블록([data-block-id^="ai-briefing"]) 문자열 파싱
//   3. 브랜드 언급/출처 추출
//
// ✅ 캡차 검증 완료(2026-08-17 세션N-38) — 이 주석의 *"라이브 검증 필요"* 는 **낡았다**.
//    프로덕션 `AuditJob` 전수 조회: Firecrawl 전환(7/29) 이후 **노출 6 · 미노출 2 · 실패 0**,
//    소요 **5~10초**. 미노출 2건도 캡차가 아니라 *"이 질의엔 브리핑이 안 뜬다"*(정상 동작).
//    그 이전 Browserbase 시절 11건은 전멸했으나 그 의존성은 이미 제거됐다.
//    ⚠️ 표본 8건이므로 "노출률"로 일반화하지 말 것 — 노출 여부는 **질의 유형**이 가른다(아래).
//
// 🔴 브리핑은 **정보/정답형 질의에만** 뜬다("{브랜드} 효과·후기·장단점").
//    추천형("{브랜드} 추천", "{카테고리} 추천 5개")에는 **원리상 안 뜬다** —
//    그런데 본류 프롬프트는 실측상 **전량 추천형**이다. 그래서 이 엔진을 본류 7엔진에
//    그냥 끼우면 대부분 「미노출」이 되고, 그게 *"네이버가 우리를 모른다"* 로 오독된다.
//    → 편입 설계 = `docs/_적용/브리핑_본류편입_기획_2026-08-17.md`(질의 축을 따로 둔다).

import { BRIEFING_FAIL_PREFIX } from "./briefing-failure";
import { sanitizeEngineText } from "./sanitize";
import type { CitedSource, EngineAdapter, EngineResponse } from "./types";
import {
  detectBrandMention,
  estimateSentiment,
  estimateShareOfVoice,
  mentionPositionFields,
} from "./utils";

const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const STUB_NOTICE =
  "[STUB] 네이버 AI 브리핑 추적은 FIRECRAWL_API_KEY 설정이 필요합니다.";

// 🔴 크레딧이 마르면 「조용히 실패」한다 — 그래서 실패 이유를 **분류**한다(세션N-39).
//   전에는 402·401·429 가 전부 `Firecrawl HTTP <코드>` 한 줄로 뭉개져서,
//   운영자가 로그를 봐도 *"크레딧이 떨어진 건지 키가 죽은 건지"* 를 구분할 수 없었다.
//   → 이 접두어를 붙여 `briefing-runner` 가 등급을 나눠 로그를 남긴다.
//   근거 = Firecrawl 공식 에러 문서(2026-08-17 확인):
//     402 Payment Required: Insufficient credits / 401 Unauthorized: Invalid token
//     429 Rate limit exceeded · Concurrency limit reached
//     재시도 가능은 408·429·5xx 뿐 — 402·401 은 **사람이 조치해야 풀린다**.
// 정의는 `./briefing-failure` 에 있다(클라이언트가 어댑터를 끌어오지 않도록 분리).
//   여기서 재수출해 기존 import 경로를 그대로 유지한다.
export { BRIEFING_FAIL_PREFIX } from "./briefing-failure";

/** Firecrawl HTTP 상태코드 → 사람이 읽는 실패 사유. 분류 못 하면 null. */
function classifyFirecrawlFailure(status: number): string | null {
  if (status === 402) {
    return `${BRIEFING_FAIL_PREFIX.credits} Firecrawl 크레딧이 모두 소진됐습니다 — 충전 전까지 네이버 AI 브리핑 측정이 실패합니다.`;
  }
  if (status === 401 || status === 403) {
    return `${BRIEFING_FAIL_PREFIX.auth} Firecrawl API 키가 무효하거나 권한이 없습니다(HTTP ${status}).`;
  }
  if (status === 429) {
    return `${BRIEFING_FAIL_PREFIX.rateLimit} Firecrawl 속도·동시성 제한에 걸렸습니다 — 잠시 뒤 재시도하면 풀립니다.`;
  }
  return null;
}

function makeStubResponse(prompt: string, durationMs: number): EngineResponse {
  return {
    engineId: "naver-briefing",
    rawResponse: `${STUB_NOTICE}\n질의: ${prompt.slice(0, 200)}`,
    brandMentioned: false,
    mentionPosition: null,
    mentionListSize: null,
    sentiment: null,
    citedSources: [],
    shareOfVoice: null,
    errorMessage: null,
    durationMs,
    isStub: true,
    usage: { inputTokens: null, outputTokens: null, costModel: "browser" },
  };
}

function makeErrorResponse(
  message: string,
  durationMs: number
): EngineResponse {
  return {
    engineId: "naver-briefing",
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
    usage: { inputTokens: null, outputTokens: null, costModel: "browser" },
  };
}

// AI 브리핑 블록 추출 — data-block-id^="ai-briefing" 요소의 내부 텍스트+링크.
// DOM 파서 의존성 없이 문자열 파싱(셀렉터가 단순·안정적이라 정규식으로 충분).
//
// 🔴 `export`(세션N-38): **테스트를 위해서만** 공개한다. 이 함수는 사고 3건이 차례로
//   방어를 덧댄 자리인데(광고 삼킴·생HTML 노출·링크나열 오탐) **단위 테스트가 하나도
//   없었다** — 라이브 호출 디버그 스크립트뿐이라 회귀를 못 잡는다.
//   `__tests__/naver-briefing-parser.test.ts` 가 실제 오염 레코드로 무는지 검사한다.
export function extractBriefingBlock(
  html: string
): { text: string; links: { url: string; title: string }[] } | null {
  // ai-briefing 블록 시작 인덱스 탐색(여러 후보 셀렉터).
  const markers = [
    'data-block-id="ai-briefing',
    'data-meta-ssuid-extra="fender_renderer-ai_briefing"',
    'data-meta-area="abL_rtX"',
    'class="ai_brief',
  ];
  let start = -1;
  for (const m of markers) {
    const i = html.indexOf(m);
    if (i !== -1) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    return null;
  }
  // 블록 시작 태그의 여는 <까지 되감고, 넉넉한 창을 잘라 그 안에서 처리.
  const openTag = html.lastIndexOf("<", start);
  const from = openTag === -1 ? start : openTag;

  // 결함2(2026-07-30, 사용자 문제제기): 고정 창이 브리핑 블록을 지나 다음 SERP 모듈
  // (파워링크 광고·네이버 메이트 등)까지 삼키면 광고 문구가 "답변"으로 저장·노출된다.
  // → 다음 블록(data-block-id)이 시작되는 지점을 창의 상한으로 삼는다.
  const nextBlockAttr = html.indexOf('data-block-id="', start + 30);
  const blockEnd =
    nextBlockAttr === -1 ? -1 : html.lastIndexOf("<", nextBlockAttr);
  const boundEnd = (windowSize: number): number =>
    blockEnd > from
      ? Math.min(start + windowSize, blockEnd)
      : start + windowSize;

  // 태그 제거 → 텍스트, <a href> 링크 수집(광고 링크가 섞이지 않게 블록 상한 적용).
  const slice = html.slice(from, boundEnd(20_000));
  const links: { url: string; title: string }[] = [];
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match = anchorRe.exec(slice);
  while (match !== null && links.length < 10) {
    const url = match[1];
    const title = match[2].replace(/<[^>]+>/g, "").trim();
    if (url && !url.startsWith("javascript:")) {
      links.push({ url, title });
    }
    match = anchorRe.exec(slice);
  }

  // 결함(2026-07-30, 사용자 문제제기): 고정 창이 <script> 중간을 자르면 닫는 태그가
  // 없어 짝 매칭 정규식이 못 지우고 JS 원문이 "답변 텍스트"로 노출됐다(그 JSON에
  // 검색어가 들어 있어 언급 판정까지 오염). 창을 20k→60k로 넓혀 재시도하고,
  // 끝까지 안 닫힌 script/style 꼬리는 통째로 버린다.
  for (const windowSize of [20_000, 60_000]) {
    const text = htmlToBriefingText(html.slice(from, boundEnd(windowSize)));
    // 결함3(2026-07-30, 사용자 문제제기): 네이버가 브리핑 자리에 프로즈 답변 대신
    // 커뮤니티 글 링크 모음을 띄우는 경우, 글 제목 나열이 "답변"으로 저장된다.
    // 문장형(…다./…요.) 서술이 하나도 없으면 답변이 아니라고 보고 미노출 처리.
    if (text.length >= 100 && PROSE_SENTENCE_RE.test(text)) {
      return { text: text.slice(0, 4000), links };
    }
  }
  return null;
}

// 한국어 프로즈 문장 종결("~다. " / "~요. ") — 링크 제목 나열엔 등장하지 않는다.
const PROSE_SENTENCE_RE = /[다요]\.(\s|$)/;

// SERP 후속 모듈 문구가 그래도 섞여 들어온 경우의 텍스트 레벨 안전망 —
// 이 마커들 중 가장 먼저 나오는 지점에서 답변을 끊는다(전부 네이버 검색결과
// 고정 UI 문구라 브리핑 답변 본문에는 등장하지 않음).
const SERP_TAIL_MARKERS = [
  "이 광고가 표시된 이유",
  "도움말 정보확인 레이어",
  "파워링크",
  "네이버 메이트",
];

function cutAtSerpTail(text: string): string {
  let cut = text.length;
  for (const marker of SERP_TAIL_MARKERS) {
    const i = text.indexOf(marker);
    if (i !== -1 && i < cut) {
      cut = i;
    }
  }
  return text.slice(0, cut).trim();
}

// 네이버가 브리핑 블록 앞에 붙이는 고정 고지문(툴팁) — 답변 본문이 아니므로 제거.
const NAVER_BOILERPLATE_RE =
  /AI 브리핑 실험 단계로[\s\S]{0,800}?연관성을 가지지 않습니다\.\s*/;
const NAVER_BOILERPLATE_FALLBACKS = [
  /AI 브리핑 실험 단계로 정확하지 않을 수 있어요\.\s*/,
  // 🔴 세션N-13: 네이버가 문구를 바꿨는데 우리 목록이 안 따라갔다(사용자 캡처로 발견).
  //   실제로 오는 건 아래 문장이고, 이게 안 걸려 고객 화면에 고지문이 그대로 실렸다.
  /네이버가 AI를 활용해 제공하는 설명으로 정확하지 않을 수 있어요\.?\s*/,
  /네이버의 AI 기반 검색 기술을 활용하여[^.]*답변입니다\.\s*/,
  /출처에 기재된 여러 문서를 기반으로[^.]*포함될 수 있습니다\.\s*/,
  /각 문서의 구체적 내용은[^.]*확인하세요\.\s*/,
  /AI 브리핑에서 제공하는 이미지와 동영상은[^.]*가지지 않습니다\.\s*/,
];

const SCRIPT_PAIR_RE = /<script[\s\S]*?<\/script>/gi;
const STYLE_PAIR_RE = /<style[\s\S]*?<\/style>/gi;
// 창 경계에서 잘려 닫는 태그가 없는 script/style — 꼬리 전체를 버린다.
const SCRIPT_TAIL_RE = /<script[\s\S]*$/i;
const STYLE_TAIL_RE = /<style[\s\S]*$/i;
// ⚠️ 미종결 태그 꼬리(`<div class="sds-…`)·태그 제거는 공용 `sanitizeEngineText` 가 한다
//   (2026-08-10 세션N-13). 여기서 다시 정의하면 규칙이 갈라져 한쪽만 고쳐진다.
const WHITESPACE_RE = /\s+/g;
/**
 * 네이버 SERP 의 UI 라벨·버튼 — 답변 본문이 아니라 화면 조작 문구다.
 *
 * 🔴 세션N-13(사용자 캡처 제보 + 전수감사): `새 창 열림` 만 지우고 있었는데
 *   실제 화면에는 아래가 그대로 나갔다 —
 *   `Keep에 저장` · `Keep에 바로가기` · `AI 출처 정보` · `자세히 보기` · `관련문서 더보기`.
 *   고객이 "AI 답변"으로 읽는 자리에 네이버 버튼 이름이 섞이면 리포트 신뢰가 깨진다.
 * ⚠️ 이 목록은 **네이버가 바꾸면 낡는다**. 아래 고지문도 실제로 문구가 바뀌어 있었다.
 */
const NAVER_UI_LABEL_RE =
  /새 창 열림|Keep에 저장|Keep에 바로가기|AI 출처 정보|관련문서 더보기|자세히 보기/g;

function htmlToBriefingText(slice: string): string {
  // script/style 은 **태그 제거 전에** 통째로 버린다(안에 든 JS 원문이 본문으로 새면
  // 그 JSON 의 검색어 때문에 언급 판정까지 오염된다 — 2026-07-30 실제 사고).
  const stripped = slice
    .replace(SCRIPT_PAIR_RE, "")
    .replace(STYLE_PAIR_RE, "")
    .replace(SCRIPT_TAIL_RE, "")
    .replace(STYLE_TAIL_RE, "");
  // 엔티티 디코딩·태그 제거·마크다운 정리는 공용 함수 하나로(세션N-13).
  //   ⚠️ 여기서 직접 정규식을 다시 쓰지 말 것 — 규칙이 갈라지면 한쪽만 고쳐진다.
  let text = sanitizeEngineText(stripped)
    .replace(NAVER_UI_LABEL_RE, " ")
    .replace(WHITESPACE_RE, " ")
    .trim()
    .replace(NAVER_BOILERPLATE_RE, "");
  for (const re of NAVER_BOILERPLATE_FALLBACKS) {
    text = text.replace(re, "");
  }
  return cutAtSerpTail(text);
}

export const naverBriefingAdapter: EngineAdapter = async (query) => {
  const start = Date.now();

  if (process.env.FINDABLE_DISABLE_NAVER_BRIEFING === "1") {
    return makeStubResponse(query.prompt, Date.now() - start);
  }

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return makeStubResponse(query.prompt, Date.now() - start);
  }

  const searchUrl = `https://search.naver.com/search.naver?query=${encodeURIComponent(query.prompt)}`;

  try {
    const res = await fetch(FIRECRAWL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: searchUrl,
        formats: [{ type: "rawHtml" }],
        onlyMainContent: false, // AI 브리핑 블록 유지 위해 전체 페이지 필요.
        waitFor: 3500, // JS 렌더 대기(AI 브리핑 동적 로딩).
        location: { country: "KR", languages: ["ko-KR"] },
        proxy: "auto", // basic 실패 시 enhanced 재시도(네이버 캡차 대응).
        timeout: 60_000,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      // 🔴 402(크레딧)·401(키)·429(속도)는 원인이 서로 다르고 **조치도 다르다**.
      //   분류되면 사유를 앞세우고 원문은 뒤에 붙인다(디버깅용으로 남긴다).
      const classified = classifyFirecrawlFailure(res.status);
      return makeErrorResponse(
        classified
          ? `${classified} (HTTP ${res.status}: ${body.slice(0, 200)})`
          : `Firecrawl HTTP ${res.status}: ${body.slice(0, 200)}`,
        Date.now() - start
      );
    }

    const json = (await res.json()) as {
      success?: boolean;
      data?: { rawHtml?: string; html?: string };
      error?: string;
    };
    const html = json.data?.rawHtml ?? json.data?.html;
    if (!html) {
      return makeErrorResponse(
        `Firecrawl 응답에 HTML 없음: ${json.error ?? "unknown"}`,
        Date.now() - start
      );
    }

    const block = extractBriefingBlock(html);
    if (!block) {
      return makeErrorResponse(
        "AI 브리핑 미노출 — 이 질의에는 네이버 AI 브리핑이 표시되지 않습니다 (정답형/탐색형 아님)",
        Date.now() - start
      );
    }

    const citedSources: CitedSource[] = block.links.map((l) => ({
      url: l.url,
      domain: safeHostname(l.url),
      title: l.title,
    }));

    const mention = detectBrandMention(
      block.text,
      query.brandName,
      query.brandVariants
    );

    return {
      engineId: "naver-briefing",
      rawResponse: block.text,
      brandMentioned: mention.mentioned,
      ...mentionPositionFields(
        block.text,
        query.brandName,
        query.brandVariants
      ),
      sentiment: estimateSentiment(block.text, query.brandName),
      citedSources,
      shareOfVoice: estimateShareOfVoice(
        block.text,
        query.brandName,
        query.brandVariants
      ),
      errorMessage: null,
      durationMs: Date.now() - start,
      isStub: false,
      // 원가계기: Firecrawl 크레딧 과금(browser 계열로 근사). 1~5 크레딧/호출.
      usage: { inputTokens: null, outputTokens: null, costModel: "browser" },
    };
  } catch (error) {
    return makeErrorResponse(
      error instanceof Error ? error.message : String(error),
      Date.now() - start
    );
  }
};

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
