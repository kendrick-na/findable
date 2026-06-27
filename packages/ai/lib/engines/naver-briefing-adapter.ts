// 네이버 AI 브리핑 어댑터 — Browserbase SDK + playwright-core (D-059, 2026-05-09)
//
// 변경 사유 (D-058 → D-059):
//   Stagehand는 내부적으로 ws 패키지를 사용 → Vercel Serverless에서
//   "Unexpected server response: 101" WebSocket 에러 발생.
//   Stagehand 우회 + Browserbase SDK로 세션 생성 → playwright-core
//   connectOverCDP로 직접 연결 → Vercel Node.js 런타임 호환.
//
// 동작 흐름:
//   1. Browserbase SDK로 세션 생성 (REST API, WebSocket 아님)
//   2. session.connectUrl 받음
//   3. chromium.connectOverCDP(connectUrl) — Playwright 표준 방식
//   4. 네이버 검색 페이지 진입 → AI 브리핑 영역 셀렉터 추출
//   5. 세션 종료
//
// 시너지:
//   네이버 ① 점유율 방어 직격. AI 브리핑 측정 도구 한국 0건.

import type { CitedSource, EngineAdapter, EngineResponse } from "./types";
import {
  detectBrandMention,
  estimateMentionPosition,
  estimateSentiment,
  estimateShareOfVoice,
} from "./utils";

const STUB_NOTICE =
  "[STUB] 네이버 AI 브리핑 추적은 BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID 설정이 필요합니다.";

function makeStubResponse(prompt: string, durationMs: number): EngineResponse {
  return {
    engineId: "naver-briefing",
    rawResponse: `${STUB_NOTICE}\n질의: ${prompt.slice(0, 200)}`,
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

function makeErrorResponse(message: string, durationMs: number): EngineResponse {
  return {
    engineId: "naver-briefing",
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

export const naverBriefingAdapter: EngineAdapter = async (query) => {
  const start = Date.now();

  if (process.env.FINDABLE_DISABLE_NAVER_BRIEFING === "1") {
    return makeStubResponse(query.prompt, Date.now() - start);
  }

  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  if (!apiKey || !projectId) {
    return makeStubResponse(query.prompt, Date.now() - start);
  }

  // Browserbase SDK + playwright-core 동적 import (콜드 스타트 가속)
  let Browserbase: typeof import("@browserbasehq/sdk").default;
  let chromium: typeof import("playwright-core").chromium;
  try {
    const [bbMod, pwMod] = await Promise.all([
      import("@browserbasehq/sdk"),
      import("playwright-core"),
    ]);
    Browserbase = bbMod.default;
    chromium = pwMod.chromium;
  } catch (error) {
    return makeErrorResponse(
      `의존성 로드 실패: ${error instanceof Error ? error.message : String(error)}`,
      Date.now() - start
    );
  }

  const bb = new Browserbase({ apiKey });
  let session: { id: string; connectUrl: string } | null = null;
  let browser: import("playwright-core").Browser | null = null;

  try {
    // 1. Browserbase 세션 생성 (REST API, WebSocket 아님)
    session = (await bb.sessions.create({ projectId })) as {
      id: string;
      connectUrl: string;
    };

    // 2. Playwright connectOverCDP로 연결 — Vercel Node.js 호환
    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    // 3. 네이버 검색 페이지 진입
    const searchUrl = `https://search.naver.com/search.naver?query=${encodeURIComponent(query.prompt)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // 4. AI 브리핑 영역은 동적 로딩 — 안정화 대기
    await page.waitForTimeout(5000);

    // 5. AI 브리핑 영역 추출 — D-058에서 검증한 셀렉터
    const briefingResult = await page.evaluate(() => {
      const candidates = [
        '[data-block-id^="ai-briefing"]',
        '[data-meta-ssuid-extra="fender_renderer-ai_briefing"]',
        '[data-meta-area="abL_rtX"]',
        '[class*="ai_brief"]',
        '[class*="briefing"]',
      ];

      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el && el.textContent && el.textContent.trim().length > 100) {
          const text = el.textContent.trim();
          const links = Array.from(el.querySelectorAll("a")).map((a) => ({
            url: (a as HTMLAnchorElement).href,
            title: a.textContent?.trim() ?? "",
          }));
          return { text, links, found: true, selector: sel };
        }
      }
      return { text: "", links: [], found: false, selector: null };
    });

    if (!briefingResult.found) {
      return makeErrorResponse(
        "AI 브리핑 미노출 — 이 질의에는 네이버 AI 브리핑이 표시되지 않습니다 (정답형/탐색형 아님)",
        Date.now() - start
      );
    }

    const text = briefingResult.text.slice(0, 4000);

    const citedSources: CitedSource[] = briefingResult.links
      .filter((l) => l.url && !l.url.startsWith("javascript:"))
      .slice(0, 10)
      .map((l) => ({
        url: l.url,
        domain: safeHostname(l.url),
        title: l.title,
      }));

    const mention = detectBrandMention(text, query.brandName, query.brandVariants);

    return {
      engineId: "naver-briefing",
      rawResponse: text,
      brandMentioned: mention.mentioned,
      mentionPosition: estimateMentionPosition(text, query.brandName, query.brandVariants),
      sentiment: estimateSentiment(text, query.brandName),
      citedSources,
      shareOfVoice: estimateShareOfVoice(text, query.brandName, query.brandVariants),
      errorMessage: null,
      durationMs: Date.now() - start,
      isStub: false,
    };
  } catch (error) {
    return makeErrorResponse(
      error instanceof Error ? error.message : String(error),
      Date.now() - start
    );
  } finally {
    try {
      await browser?.close();
    } catch {
      // ignore
    }
  }
};

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
