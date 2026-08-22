import { initializeAnalytics } from "@repo/analytics/instrumentation-client";
import { initializeSentry } from "@repo/observability/client";
import { initBotId } from "botid/client/core";

initializeSentry();
initializeAnalytics();

// BotID(2026-08-02) — 무료 진단(28 LLM 호출·건당 150~300원)을 자동화 스크립트가
// 소모하는 걸 진입 단계에서 막는다. 방어 4층 중 1층.
//   ⚠️ 여기 등록하지 않은 경로에서 checkBotId() 를 호출하면 **실패한다**
//      (클라이언트가 분류용 헤더를 붙이는 대상을 이 목록이 정한다 — Vercel 문서).
//   ⚠️ 로컬 dev 는 항상 isBot:false. 프로덕션에선 curl·직접 접속이 차단되므로
//      라이브 검증은 반드시 **브라우저에서 폼 제출**로 해야 한다.
initBotId({
  protect: [
    // 무료 진단 생성 — 유일하게 비싼 엔드포인트.
    { path: "/api/audit", method: "POST" },
    // 심층분석(CrewAI)·브리핑도 크레딧을 소모한다.
    { path: "/api/audit/*/crew", method: "POST" },
    { path: "/api/audit/*/briefing", method: "POST" },
  ],
});

export { onRouterTransitionStart } from "@repo/observability/client";
