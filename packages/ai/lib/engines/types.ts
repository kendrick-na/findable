// Findable 7 엔진 공통 타입
// 글로벌 4 (AI Gateway) + 한국 3 (직접 호출)

export type EngineId =
  | "chatgpt"
  | "chatgpt-web" // ChatGPT 웹 UI (Stagehand). 베타. API와 별도 측정.
  | "claude"
  | "perplexity"
  | "gemini"
  | "hyperclova"
  | "naver"
  | "naver-briefing" // 네이버 AI 브리핑 (D-047, 2026-05-07). 검색 점유율 20%, 점유율 40% 확대 예정.
  | "daum";

export type EngineLanguage = "ko" | "en" | "both";

export type EngineProvider =
  | "openai"
  | "anthropic"
  | "perplexity"
  | "google"
  | "naver"
  | "kakao";

export interface EngineMeta {
  id: EngineId;
  name: string;
  provider: EngineProvider;
  language: EngineLanguage;
  ordering: number;
}

export const ENGINES: EngineMeta[] = [
  { id: "chatgpt", name: "ChatGPT", provider: "openai", language: "both", ordering: 1 },
  { id: "chatgpt-web", name: "ChatGPT (Web)", provider: "openai", language: "both", ordering: 2 },
  { id: "claude", name: "Claude", provider: "anthropic", language: "both", ordering: 3 },
  { id: "perplexity", name: "Perplexity", provider: "perplexity", language: "both", ordering: 4 },
  { id: "gemini", name: "Gemini", provider: "google", language: "both", ordering: 5 },
  { id: "hyperclova", name: "HyperCLOVA X", provider: "naver", language: "ko", ordering: 6 },
  { id: "naver", name: "Naver", provider: "naver", language: "ko", ordering: 7 },
  { id: "naver-briefing", name: "Naver AI 브리핑", provider: "naver", language: "ko", ordering: 8 },
  { id: "daum", name: "Daum", provider: "kakao", language: "ko", ordering: 9 },
];

export interface EngineQuery {
  engineId: EngineId;
  prompt: string;
  language: "ko" | "en";
  brandName?: string; // 인용 추출용
  brandVariants?: string[]; // Korean Entity Grounding
}

export interface CitedSource {
  url: string;
  domain: string;
  title?: string;
  snippet?: string;
}

export interface EngineResponse {
  engineId: EngineId;
  rawResponse: string;
  brandMentioned: boolean;
  mentionPosition: number | null; // 1, 2, 3, ... 또는 null
  sentiment: "positive" | "neutral" | "negative" | null;
  citedSources: CitedSource[];
  shareOfVoice: number | null; // 0.0 ~ 1.0
  errorMessage: string | null;
  durationMs: number;
  isStub: boolean; // 환경변수 미설정 시 stub 응답
}

export type EngineAdapter = (query: EngineQuery) => Promise<EngineResponse>;
