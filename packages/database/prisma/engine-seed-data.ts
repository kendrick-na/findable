// Engine 시드 데이터 — seed.ts 와 engine-seed-gate.ts 가 함께 쓰는 단일 사본.
//
// @repo/database는 @repo/ai를 의존하지 않으므로(순환·exports 회피) packages/ai/lib/engines의
//   ENGINES·DEFAULT_ENGINES를 여기 인라인한다. 두 목록이 어긋나면
//   apps/app/__tests__/engine-seed-gate.test.ts 가 실패한다(2026-10-04 W0-3).

export const ENGINE_SEED = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    provider: "openai",
    language: "both",
    ordering: 1,
  },
  {
    id: "chatgpt-web",
    name: "ChatGPT (Web)",
    provider: "openai",
    language: "both",
    ordering: 2,
  },
  {
    id: "claude",
    name: "Claude",
    provider: "anthropic",
    language: "both",
    ordering: 3,
  },
  {
    id: "perplexity",
    name: "Perplexity",
    provider: "perplexity",
    language: "both",
    ordering: 4,
  },
  {
    id: "gemini",
    name: "Gemini",
    provider: "google",
    language: "both",
    ordering: 5,
  },
  {
    id: "hyperclova",
    name: "HyperCLOVA X",
    provider: "naver",
    language: "ko",
    ordering: 6,
  },
  {
    id: "naver",
    name: "Naver",
    provider: "naver",
    language: "ko",
    ordering: 7,
  },
  {
    id: "naver-briefing",
    name: "Naver AI 브리핑",
    provider: "naver",
    language: "ko",
    ordering: 8,
  },
  { id: "daum", name: "Daum", provider: "kakao", language: "ko", ordering: 9 },
] as const;

// 본류 audit이 실제 호출하는 엔진(engines/index.ts DEFAULT_ENGINES와 동일).
// 이 목록만 isActive=true. chatgpt-web·naver-briefing은 옵션이라 false.
// ⛔ 2026-09-29: hyperclova 비활성(서비스 종료). 행은 남긴다 — 과거 Tracking 의 FK.
export const ACTIVE_ENGINE_IDS: ReadonlySet<string> = new Set<string>([
  "chatgpt",
  "claude",
  "perplexity",
  "gemini",
  "naver",
  "daum",
]);
