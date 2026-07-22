// 실제 어댑터(naverBriefingAdapter) 실동작 검증 (2026-07-23)
//
// 낡은 test-naver-briefing.ts는 폐기된 Stagehand 기반이라 프로덕션과 경로가 다르다.
// 이 스크립트는 실제 프로덕션이 쓰는 naverBriefingAdapter를 그대로 호출해
// "네이버 AI 브리핑이 실제로 측정되는지 / 셀렉터가 아직 유효한지"를 확인한다.
//
// 실행(packages/ai 컨텍스트): 키를 env로 주입 후 tsx로 실행.
//   set -a; . ../../.env.local; set +a; pnpm dlx tsx ../../scripts/d2sf-debug/verify-naver-briefing-adapter.ts

import { naverBriefingAdapter } from "../../packages/ai/lib/engines/naver-briefing-adapter";

async function main() {
  console.log("=== 네이버 AI 브리핑 어댑터 실동작 검증 ===\n");
  console.log("환경변수:");
  console.log(
    `  BROWSERBASE_API_KEY: ${process.env.BROWSERBASE_API_KEY ? `***${process.env.BROWSERBASE_API_KEY.slice(-4)}` : "❌ 미설정"}`
  );
  console.log(
    `  BROWSERBASE_PROJECT_ID: ${process.env.BROWSERBASE_PROJECT_ID ? `***${process.env.BROWSERBASE_PROJECT_ID.slice(-4)}` : "❌ 미설정"}`
  );
  console.log(
    `  FINDABLE_DISABLE_NAVER_BRIEFING: ${process.env.FINDABLE_DISABLE_NAVER_BRIEFING ?? "(미설정)"}`
  );
  console.log("");

  // 네이버 AI 브리핑은 "정답형/탐색형" 질의에서만 노출된다(경쟁사 추천형 X).
  // 셀렉터 유효성 최종 확인을 위해 브리핑이 실제로 뜰 법한 정보형 질의를 사용.
  const brandName = "다이슨";
  const prompt = process.env.VERIFY_PROMPT ?? "다이슨 무선청소기 추천";

  console.log(`질의: "${prompt}"`);
  console.log(`브랜드: ${brandName}`);
  console.log("\n어댑터 호출 중… (Browserbase 클라우드 크롬, 10~30초 소요)\n");

  const start = Date.now();
  const res = await naverBriefingAdapter({
    prompt,
    language: "ko",
    brandName,
    brandVariants: [brandName, "medicube"],
  });
  const elapsed = Date.now() - start;

  console.log("=== 결과 ===");
  console.log(`  소요:        ${elapsed}ms`);
  console.log(`  isStub:      ${res.isStub}  ${res.isStub ? "← Browserbase 미연결/비활성" : ""}`);
  console.log(`  errorMessage:${res.errorMessage ?? "(없음)"}`);
  console.log(`  brandMentioned: ${res.brandMentioned}`);
  console.log(`  mentionPosition:${res.mentionPosition ?? "-"}`);
  console.log(`  sentiment:   ${res.sentiment ?? "-"}`);
  console.log(`  shareOfVoice:${res.shareOfVoice ?? "-"}`);
  console.log(`  citedSources:${res.citedSources.length}개`);
  console.log(`  rawResponse 길이: ${res.rawResponse.length}자`);
  console.log("\n--- rawResponse 첫 500자 ---");
  console.log(res.rawResponse.slice(0, 500) || "(비어있음)");

  console.log("\n=== 판정 ===");
  if (res.isStub) {
    console.log("⚠️  STUB 반환 — Browserbase 미연결 또는 비활성. 실측 아님.");
  } else if (res.errorMessage) {
    console.log(
      "⚠️  errorMessage 반환 — 브리핑 미노출(정상) 또는 셀렉터 무효화 가능. rawResponse/메시지로 구분 필요."
    );
  } else if (res.rawResponse.length > 0) {
    console.log("✅  실측 성공 — 네이버 AI 브리핑 응답을 정상 추출. 셀렉터 유효.");
  } else {
    console.log("❓  응답 비어있음 — 셀렉터 점검 필요.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ 예외:", err);
  process.exit(1);
});
