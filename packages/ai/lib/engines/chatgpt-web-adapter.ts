// ChatGPT 웹 UI 어댑터 — Stagehand (LOCAL 모드)
//
// 목적: chat.openai.com에서 사용자가 실제로 보는 답변을 측정.
// API 답변(global-adapters.ts의 chatgptAdapter)과 다를 수 있음.
//
// v1.0 정책:
//  - LOCAL 모드 기본 (Browserbase 가입 불필요, 무료)
//  - Browserbase 키 있으면 자동 클라우드 모드 전환
//  - Stagehand 미설치/실패 시 stub 응답 반환 (폴백 안전)
//  - "베타: 웹 답변 추적" UI 라벨로 깨질 가능성 사전 안내
//
// ⚠️ OpenAI ToS 회색지대: 자동화는 약관 위반 소지. 베타 단계 트래픽 제한 권장.

import type { CitedSource, EngineAdapter, EngineResponse } from "./types";
import {
  detectBrandMention,
  estimateMentionPosition,
  estimateSentiment,
  estimateShareOfVoice,
} from "./utils";

const STUB_NOTICE =
  "[STUB] ChatGPT 웹 UI 추적은 OPENAI_ACCOUNT_EMAIL/PASSWORD 또는 BROWSERBASE_API_KEY 설정이 필요합니다. 또는 FINDABLE_DISABLE_CHATGPT_WEB=1로 명시적으로 비활성화.";

function makeStubResponse(prompt: string, durationMs: number): EngineResponse {
  return {
    engineId: "chatgpt-web", // EngineId enum 확장은 v1.5에서 정식화
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

interface ChatGPTWebOptions {
  /** 헤드리스 false로 디버깅 가능. 기본 true (서버 환경) */
  headless?: boolean;
  /** 응답 대기 timeout. 기본 60초 (ChatGPT 웹은 응답 시작에 5~30초 걸림) */
  timeoutMs?: number;
}

/**
 * ChatGPT 웹 UI 어댑터.
 *
 * 동작:
 *   1. Stagehand 로드 시도 (동적 import — 실패 시 stub fallback)
 *   2. LOCAL 모드 또는 Browserbase 모드 자동 선택
 *   3. chat.openai.com/?model=gpt-5 또는 무로그인 ChatGPT 페이지 접근
 *   4. 프롬프트 입력 → 응답 완료 대기 → 본문 추출
 *   5. 분석 메트릭 계산
 *
 * v1.0 베타에서는 무로그인 ChatGPT (chatgpt.com 익명 모드) 활용.
 * 로그인 필요 시 v1.5에서 OpenAI ToS-안전한 방식 재설계.
 */
export const chatgptWebAdapter: EngineAdapter = async (query) => {
  const start = Date.now();

  if (process.env.FINDABLE_DISABLE_CHATGPT_WEB === "1") {
    return makeStubResponse(query.prompt, Date.now() - start);
  }

  // Stagehand 동적 import — 패키지 누락이나 OS 문제로 실패해도 어댑터는 살아있음.
  let StagehandClass: typeof import("@browserbasehq/stagehand").Stagehand | null = null;
  try {
    const mod = await import("@browserbasehq/stagehand");
    StagehandClass = mod.Stagehand;
  } catch (error) {
    return {
      engineId: "chatgpt-web",
      rawResponse: "",
      brandMentioned: false,
      mentionPosition: null,
      sentiment: null,
      citedSources: [],
      shareOfVoice: null,
      errorMessage: `Stagehand import 실패: ${error instanceof Error ? error.message : String(error)}`,
      durationMs: Date.now() - start,
      isStub: false,
    };
  }

  const options: Required<ChatGPTWebOptions> = {
    headless: process.env.FINDABLE_CHATGPT_WEB_HEADLESS !== "0",
    timeoutMs: Number.parseInt(process.env.FINDABLE_CHATGPT_WEB_TIMEOUT_MS ?? "60000", 10),
  };

  const useBrowserbase = Boolean(
    process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID
  );

  const stagehand = new StagehandClass(
    useBrowserbase
      ? {
          env: "BROWSERBASE",
          apiKey: process.env.BROWSERBASE_API_KEY,
          projectId: process.env.BROWSERBASE_PROJECT_ID,
          verbose: 0,
          disablePino: true,
          disableAPI: true,
        }
      : {
          env: "LOCAL",
          verbose: 0,
          disablePino: true,
          disableAPI: true,
          localBrowserLaunchOptions: {
            headless: options.headless,
            viewport: { width: 1280, height: 800 },
          },
        }
  );

  try {
    await stagehand.init();
    const page = stagehand.context.pages()[0];

    // ChatGPT 무로그인 화면 — 24년 4월부터 익명 사용 가능
    await page.goto("https://chatgpt.com/", {
      waitUntil: "networkidle",
      timeoutMs: options.timeoutMs,
    });

    // act()는 자연어로 페이지 조작. UI 변경에 robust.
    await stagehand.act(`composer 입력란을 클릭하고 다음 텍스트를 입력해라: "${query.prompt}"`);
    await stagehand.act("send 버튼을 클릭해서 메시지를 전송해라");

    // 응답 완료 대기 — "stop generating" 버튼이 사라지거나 새 어시스턴트 메시지가 안정화될 때까지
    await page.waitForTimeout(8000); // 첫 청크 대기
    try {
      // "regenerate" 또는 "copy" 같은 완료 시그널이 나타나기를 기다림
      await page.waitForSelector('[data-testid="copy-turn-action-button"], button[aria-label*="Copy"]', {
        timeout: options.timeoutMs - 8000,
      });
    } catch {
      // 셀렉터 변경되었을 수 있음 → 그냥 진행, extract가 본문을 가져옴
    }

    // extract()는 페이지에서 구조화된 데이터를 자연어로 추출
    // zod 의존성 주입을 피하기 위해 v3의 jsonSchemaToZod 우회: Stagehand는 z 자체 받음
    const { z } = await import("zod");
    const schema = z.object({
      answer: z.string().describe("ChatGPT의 마지막 답변 본문 전체 텍스트 (markdown 포함, sidebar/header 제외)"),
      citedUrls: z
        .array(z.string())
        .describe("답변 안에 인용된 URL 목록. 없으면 빈 배열")
        .optional(),
    });

    const extracted = await stagehand.extract(
      "최근 어시스턴트 답변의 본문 전체 텍스트와, 답변에 포함된 인용 URL을 추출해라",
      schema as never
    );

    const text = (extracted as { answer?: string }).answer ?? "";
    const urls = (extracted as { citedUrls?: string[] }).citedUrls ?? [];

    const citedSources: CitedSource[] = urls
      .map((url) => {
        try {
          return { url, domain: new URL(url).hostname };
        } catch {
          return null;
        }
      })
      .filter((s): s is CitedSource => s !== null);

    const mention = detectBrandMention(text, query.brandName, query.brandVariants);

    return {
      engineId: "chatgpt-web",
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
    return {
      engineId: "chatgpt-web",
      rawResponse: "",
      brandMentioned: false,
      mentionPosition: null,
      sentiment: null,
      citedSources: [],
      shareOfVoice: null,
      errorMessage: `ChatGPT 웹 추적 실패: ${error instanceof Error ? error.message : String(error)}`,
      durationMs: Date.now() - start,
      isStub: false,
    };
  } finally {
    try {
      await stagehand.close();
    } catch {
      // ignore close errors
    }
  }
};
