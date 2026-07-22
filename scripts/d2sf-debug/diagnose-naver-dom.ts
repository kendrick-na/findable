// 네이버 AI 브리핑 DOM 진단 (2026-07-23)
//
// 목적: 어댑터가 "미노출"로 폴백하는 원인이
//   (A) 정말 브리핑이 안 뜸  vs  (B) 셀렉터가 죽음  인지 구분.
// 실제 네이버 페이지를 Browserbase로 열어 "AI 브리핑" 단어 존재 여부 +
// 어댑터가 쓰는 5개 셀렉터 매치 여부 + 후보 셀렉터를 폭넓게 스캔한다.
//
// 실행(packages/ai): set -a; . ../../.env.local; set +a; pnpm dlx tsx ../../scripts/d2sf-debug/diagnose-naver-dom.ts

async function main() {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    console.error("❌ BROWSERBASE 키 미설정");
    process.exit(1);
  }

  const query = process.env.VERIFY_PROMPT ?? "탈모 좋은 음식";
  console.log(`=== 네이버 DOM 진단: "${query}" ===\n`);

  const [bbMod, pwMod] = await Promise.all([
    import("@browserbasehq/sdk"),
    import("playwright-core"),
  ]);
  const Browserbase = bbMod.default;
  const { chromium } = pwMod;

  const bb = new Browserbase({ apiKey });
  const session = await bb.sessions.create({ projectId });
  const browser = await chromium.connectOverCDP(session.connectUrl);

  try {
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.newPage());
    const url = `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);

    const diag = await page.evaluate(() => {
      const body = document.body.textContent ?? "";
      const adapterSelectors = [
        '[data-block-id^="ai-briefing"]',
        '[data-meta-ssuid-extra="fender_renderer-ai_briefing"]',
        '[data-meta-area="abL_rtX"]',
        '[class*="ai_brief"]',
        '[class*="briefing"]',
      ];
      const adapterMatch = adapterSelectors.map((sel) => {
        const el = document.querySelector(sel);
        return {
          sel,
          found: !!el,
          len: el?.textContent?.trim().length ?? 0,
        };
      });

      // 넓은 후보 스캔 (신규 셀렉터 발굴용)
      const broad = [
        '[class*="ai"]',
        '[class*="AI"]',
        '[data-block-id]',
        '[data-meta-area]',
        "[data-module-name]",
      ];
      const broadHits: { sel: string; count: number; sample: string[] }[] = [];
      for (const sel of broad) {
        const els = Array.from(document.querySelectorAll(sel));
        broadHits.push({
          sel,
          count: els.length,
          sample: els
            .slice(0, 8)
            .map(
              (e) =>
                (e.getAttribute("class") ||
                  e.getAttribute("data-block-id") ||
                  e.getAttribute("data-meta-area") ||
                  e.getAttribute("data-module-name") ||
                  "?").slice(0, 60)
            ),
        });
      }

      return {
        title: document.title,
        bodyLen: body.length,
        hasAiBriefingWord: body.includes("AI 브리핑"),
        hasAiWord: body.includes("AI"),
        adapterMatch,
        broadHits,
      };
    });

    console.log(`title: ${diag.title}`);
    console.log(`body 길이: ${diag.bodyLen}`);
    console.log(`"AI 브리핑" 단어 존재: ${diag.hasAiBriefingWord ? "✅ 있음" : "❌ 없음"}`);
    console.log("\n--- 어댑터 셀렉터 매치 ---");
    for (const m of diag.adapterMatch) {
      console.log(`  ${m.found ? "✅" : "❌"} ${m.sel}  (len ${m.len})`);
    }
    console.log("\n--- 넓은 후보 스캔 (신규 셀렉터 힌트) ---");
    for (const b of diag.broadHits) {
      console.log(`  ${b.sel}: ${b.count}개`);
      for (const s of b.sample) console.log(`      · ${s}`);
    }

    console.log("\n=== 판정 ===");
    if (!diag.hasAiBriefingWord) {
      console.log("→ 페이지에 'AI 브리핑' 단어 자체가 없음. 이 질의는 브리핑 미노출(정상).");
    } else if (diag.adapterMatch.some((m) => m.found && m.len > 100)) {
      console.log("→ 셀렉터 유효 + 브리핑 존재. 어댑터 정상 동작해야 함.");
    } else {
      console.log(
        "→ ⚠️ 'AI 브리핑' 단어는 있는데 어댑터 셀렉터가 못 잡음 = 셀렉터 무효화 의심. 위 넓은 스캔에서 새 셀렉터 발굴 필요."
      );
    }
  } finally {
    await browser.close();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ 예외:", e);
  process.exit(1);
});
