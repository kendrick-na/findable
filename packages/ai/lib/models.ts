import { createOpenAI } from "@ai-sdk/openai";
import type { EmbeddingModel, LanguageModel } from "ai";
import { keys } from "../keys";

const openai = createOpenAI({
  apiKey: keys().OPENAI_API_KEY,
});

// 명시적 타입 주석 — 추론 타입이 provider 내부 경로를 참조해 TS2742(non-portable)
// 나는 것을 방지 (compatibility 옵션 제거 후 노출됨, 2026-07-27).
export const models: {
  chat: LanguageModel;
  embeddings: EmbeddingModel;
} = {
  chat: openai("gpt-4o-mini"),
  // embedding 모델은 openai.embedding()으로 생성 (v3에서 openai()는 LanguageModel 반환).
  embeddings: openai.embedding("text-embedding-3-small"),
};
