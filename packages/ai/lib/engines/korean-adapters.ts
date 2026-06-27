// 한국 3 엔진 어댑터 — 직접 fetch (AI Gateway 미지원)
//
// 1. HyperCLOVA X (NAVER CLOVA Studio API, HCX-DASH-002)
// 2. Naver Search API (블로그·뉴스·웹문서·지식인) + HyperCLOVA 합성으로 Cue: 90% 재현 (D-008)
// 3. Daum 검색 API (Kakao Developers)
//
// 환경변수 미설정 시 stub 응답.
// Naver Cue: 직접 스크래핑은 D-004에 따라 v1.0 제외 (약관·법적 리스크).

import type { CitedSource, EngineAdapter, EngineId, EngineResponse } from "./types";
import {
  detectBrandMention,
  estimateMentionPosition,
  estimateSentiment,
  estimateShareOfVoice,
} from "./utils";

const STUB_NOTICE_PREFIX = "이 AI는 아직 연결되지 않았어요. 다음 측정부터 포함됩니다.";

function makeStubResponse(engineId: EngineId, prompt: string, durationMs: number): EngineResponse {
  return {
    engineId,
    rawResponse: `${STUB_NOTICE_PREFIX}\n질의: ${prompt.slice(0, 200)}`,
    brandMentioned: false,
    mentionPosition: null,
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
    const response = await fetch(`${CLOVA_HOST}/v3/chat-completions/${CLOVA_MODEL}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              "당신은 한국어 사용자를 위한 검색 어시스턴트입니다. 사실 기반으로 답하고, 구체적인 브랜드와 출처를 명시하세요.",
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
    });

    if (!response.ok) {
      const body = await response.text();
      return makeErrorResponse(
        "hyperclova",
        `HyperCLOVA X HTTP ${response.status}: ${body.slice(0, 200)}`,
        Date.now() - start
      );
    }

    const data = (await response.json()) as {
      result?: { message?: { content?: string } };
    };
    const text = data.result?.message?.content ?? "";

    return analyzeText("hyperclova", text, query, Date.now() - start, []);
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
  title: string;
  link: string;
  description?: string;
  bloggername?: string;
  postdate?: string;
}

async function naverSearch(query: string): Promise<NaverSearchItem[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [];

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
      if (!resp.ok) return [];
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

  if (!clientId || !clovaKey) {
    return makeStubResponse("naver", query.prompt, Date.now() - start);
  }

  try {
    const items = await naverSearch(query.prompt);
    if (items.length === 0) {
      return makeErrorResponse("naver", "Naver Search API 결과 없음", Date.now() - start);
    }

    // 검색 결과를 HyperCLOVA에 컨텍스트로 주입 → Cue: 답변 합성
    const context = items
      .slice(0, 8)
      .map((item, i) => `[${i + 1}] ${stripHtml(item.title)}\n출처: ${item.link}\n${stripHtml(item.description ?? "")}`)
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
              content: "당신은 네이버 검색 결과를 종합하는 한국어 답변 합성 어시스턴트입니다.",
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
      result?: { message?: { content?: string } };
    };
    const text = synthData.result?.message?.content ?? "";

    // 인용 출처는 검색 결과 URL을 그대로 사용 (재배포 금지에 따라 메타데이터만)
    const citedSources: CitedSource[] = items.slice(0, 8).map((item) => ({
      url: item.link,
      domain: safeHostname(item.link),
      title: stripHtml(item.title),
    }));

    return analyzeText("naver", text, query, Date.now() - start, citedSources);
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
  title: string;
  contents: string;
  url: string;
  blogname?: string;
  datetime?: string;
}

export const daumAdapter: EngineAdapter = async (query) => {
  const start = Date.now();
  const restKey = process.env.KAKAO_REST_API_KEY;
  if (!restKey) {
    return makeStubResponse("daum", query.prompt, Date.now() - start);
  }

  try {
    // Kakao 검색 API 3개 (web·blog·cafe) 동시 호출
    const endpoints = ["web", "blog", "cafe"];
    const results = await Promise.allSettled(
      endpoints.map(async (kind) => {
        const url = `https://dapi.kakao.com/v2/search/${kind}?query=${encodeURIComponent(query.prompt)}&size=10`;
        const resp = await fetch(url, {
          headers: { Authorization: `KakaoAK ${restKey}` },
        });
        if (!resp.ok) return [];
        const data = (await resp.json()) as { documents?: DaumSearchDoc[] };
        return data.documents ?? [];
      })
    );

    const docs: DaumSearchDoc[] = results.flatMap((r) =>
      r.status === "fulfilled" ? r.value : []
    );
    if (docs.length === 0) {
      return makeErrorResponse("daum", "Daum/Kakao 검색 결과 없음", Date.now() - start);
    }

    // Daum/Kakao는 자체 LLM 합성 API가 없으므로 검색 결과를 raw로 보존.
    // v1.5에서 카카오 i Open Builder 또는 KoGPT로 합성 추가 검토.
    const text = docs
      .slice(0, 10)
      .map(
        (doc, i) =>
          `[${i + 1}] ${stripHtml(doc.title)}\n${stripHtml(doc.contents)}\n출처: ${doc.url}`
      )
      .join("\n\n");

    const citedSources: CitedSource[] = docs.slice(0, 10).map((doc) => ({
      url: doc.url,
      domain: safeHostname(doc.url),
      title: stripHtml(doc.title),
    }));

    return analyzeText("daum", text, query, Date.now() - start, citedSources);
  } catch (error) {
    return makeErrorResponse(
      "daum",
      error instanceof Error ? error.message : String(error),
      Date.now() - start
    );
  }
};

// ─────────────────────────────────────────────
// 공통 분석 + 헬퍼
// ─────────────────────────────────────────────

function analyzeText(
  engineId: EngineId,
  text: string,
  query: { brandName?: string; brandVariants?: string[] },
  durationMs: number,
  preExtractedSources: CitedSource[]
): EngineResponse {
  const mention = detectBrandMention(text, query.brandName, query.brandVariants);
  return {
    engineId,
    rawResponse: text,
    brandMentioned: mention.mentioned,
    mentionPosition: estimateMentionPosition(text, query.brandName, query.brandVariants),
    sentiment: estimateSentiment(text, query.brandName),
    citedSources: preExtractedSources,
    shareOfVoice: estimateShareOfVoice(text, query.brandName, query.brandVariants),
    errorMessage: null,
    durationMs,
    isStub: false,
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ").trim();
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
