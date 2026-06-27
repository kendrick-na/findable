// Stagehand + Browserbase 동작 검증 (D-058 디버그)
//
// 목표:
//   1. Browserbase 환경변수가 진짜 작동하는지
//   2. Stagehand v3 옵션이 호환되는지
//   3. 네이버 검색 페이지에서 AI 브리핑 영역 추출 가능한지
//
// 실행:
//   pnpm tsx scripts/d2sf-debug/test-naver-briefing.ts

import "dotenv/config";

async function main() {
  console.log("=== Stagehand + Browserbase 동작 검증 ===\n");
  console.log("환경변수 확인:");
  console.log(
    `  BROWSERBASE_API_KEY: ${process.env.BROWSERBASE_API_KEY ? `***${process.env.BROWSERBASE_API_KEY.slice(-4)}` : "❌ 미설정"}`
  );
  console.log(
    `  BROWSERBASE_PROJECT_ID: ${process.env.BROWSERBASE_PROJECT_ID ? `***${process.env.BROWSERBASE_PROJECT_ID.slice(-4)}` : "❌ 미설정"}`
  );
  console.log("");

  if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID) {
    console.error("환경변수 미설정. .env.local 확인.");
    process.exit(1);
  }

  console.log("Stagehand 동적 import...");
  const { Stagehand } = await import("@browserbasehq/stagehand");
  console.log("✅ Stagehand 로드 성공\n");

  const config = {
    env: "BROWSERBASE" as const,
    apiKey: process.env.BROWSERBASE_API_KEY,
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    verbose: 1, // 상세 로그
  };

  console.log("Stagehand 인스턴스 생성 (BROWSERBASE 모드)...");
  const stagehand = new Stagehand(config);

  try {
    console.log("init() 호출 중...");
    const startInit = Date.now();
    await stagehand.init();
    console.log(`✅ init 성공 (${Date.now() - startInit}ms)\n`);

    const page = stagehand.context.pages()[0];
    console.log("page 객체 획득");

    const searchUrl =
      "https://search.naver.com/search.naver?query=" +
      encodeURIComponent("메디큐브 화장품");
    console.log(`\n네이버 검색 페이지 진입: ${searchUrl}`);

    const startGoto = Date.now();
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeoutMs: 30000,
    });
    console.log(`✅ goto 성공 (${Date.now() - startGoto}ms)\n`);

    // AI 브리핑 영역 추출 시도 — 다중 셀렉터
    console.log("AI 브리핑 영역 추출 시도...");
    const briefingResult = await page.evaluate(() => {
      const candidates = [
        '[class*="ai_brief"]',
        '[class*="AiBrief"]',
        '[class*="ai_summary"]',
        '[class*="briefing"]',
        '[data-module-name*="ai"]',
        '[class*="aiBriefing"]',
        '[class*="ai-brief"]',
        '[class*="brief_box"]',
      ];

      const debug: { selector: string; found: boolean; textLen: number }[] = [];
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el && el.textContent) {
          debug.push({
            selector: sel,
            found: true,
            textLen: el.textContent.trim().length,
          });
        } else {
          debug.push({ selector: sel, found: false, textLen: 0 });
        }
      }

      // 페이지 전체 텍스트에서 "AI 브리핑" 또는 "AI 답변" 단어 위치
      const fullText = document.body.textContent ?? "";
      const aiBriefingIdx = fullText.indexOf("AI 브리핑");
      const aiAnswerIdx = fullText.indexOf("AI 답변");

      return {
        debug,
        aiBriefingIdx,
        aiAnswerIdx,
        bodyLength: fullText.length,
        title: document.title,
      };
    });

    console.log("\n=== 페이지 분석 결과 ===");
    console.log(`title: ${briefingResult.title}`);
    console.log(`body length: ${briefingResult.bodyLength}`);
    console.log(
      `"AI 브리핑" 단어 위치: ${briefingResult.aiBriefingIdx === -1 ? "없음" : briefingResult.aiBriefingIdx}`
    );
    console.log(
      `"AI 답변" 단어 위치: ${briefingResult.aiAnswerIdx === -1 ? "없음" : briefingResult.aiAnswerIdx}`
    );
    console.log("\n셀렉터별 결과:");
    for (const r of briefingResult.debug) {
      console.log(
        `  ${r.found ? "✅" : "❌"} ${r.selector}: ${r.found ? `${r.textLen}자` : "미발견"}`
      );
    }

    // 추가 — 페이지 HTML 1KB 저장 (구조 파악용)
    console.log("\n페이지 HTML 첫 2000자 (디버그용):");
    const html = await page.content();
    console.log(html.slice(0, 2000));

    await stagehand.close();
    console.log("\n✅ Stagehand close 성공");
    console.log("\n=== 검증 완료 ===");
  } catch (error) {
    console.error("\n❌ 에러 발생:");
    console.error(error);
    try {
      await stagehand.close();
    } catch {}
    process.exit(1);
  }
}

main();
