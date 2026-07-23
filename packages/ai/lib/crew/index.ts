// Findable CrewAI 4 에이전트 (D-017 + D-024) — 패키지 진입점

export {
  type ActionItem,
  type AnalystOutput,
  actionItemSchema,
  alexAgent,
  // 출력 스키마 + 타입 (UI·DB에서 재사용)
  analystOutputSchema,
  CREW_AGENTS,
  CREW_META,
  CREW_ORDER,
  type CrewAgentId,
  FINDABLE_MODEL_DEFAULT,
  FINDABLE_MODEL_FAST,
  type Finding,
  findingSchema,
  junhoAgent,
  minjiAgent,
  type StrategistOutput,
  strategistOutputSchema,
  sujinAgent,
} from "./agents";
// 코파일럿 챗 — 진단 결과를 대화로 풀어주는 단일 GEO 코파일럿
export {
  buildCopilotSystemPrompt,
  COPILOT_MODEL_ID,
  type CopilotAnalyst,
  type CopilotChatMessage,
  type CopilotContext,
  type CopilotStrategist,
  isCopilotConfigured,
  streamCopilotResponse,
} from "./copilot";
export {
  type AgentReport,
  type AnalystReport,
  type CrewInput,
  type CrewReport,
  runCrewDiagnose,
  type StrategistReport,
} from "./orchestrator";
