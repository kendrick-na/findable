// Stagehand + Browserbase 동작 검증
//
// 실행:
//   node --env-file=.env.local scripts/d2sf-debug/test-naver-briefing.mjs

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
  console.error("환경변수 미설정. node --env-file=.env.local 옵션 필요.");
  process.exit(1);
}

console.log("Stagehand 동적 import...");
const { Stagehand } = await import("@browserbasehq/stagehand");
console.log("✅ Stagehand 로드 성공\n");

const stagehandConfig = {
  env: "BROWSERBASE",
  apiKey: process.env.BROWSERBASE_API_KEY,
  projectId: process.env.BROWSERBASE_PROJECT_ID,
  verbose: 1,
};

console.log("Stagehand 인스턴스 생성 (BROWSERBASE 모드)...");
const stagehand = new Stagehand(stagehandConfig);

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

  // 페이지 안정화 대기
  await new Promise((r) => setTimeout(r, 3000));

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

    const debug = [];
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

  if (briefingResult.aiBriefingIdx !== -1) {
    const surrounding = await page.evaluate((idx) => {
      const fullText = document.body.textContent ?? "";
      return fullText.slice(Math.max(0, idx - 50), idx + 500);
    }, briefingResult.aiBriefingIdx);
    console.log(`\n"AI 브리핑" 주변 텍스트:\n${surrounding}`);
  }

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
