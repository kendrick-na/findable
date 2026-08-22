const { readFileSync } = require("node:fs");
const ROOT = "/Users/easymilli/Downloads/바이브코딩/Findable";
const url = readFileSync(ROOT+"/.env.local","utf8").match(/^DATABASE_URL="?([^"\n]+)/m)[1];
const { neon } = require(ROOT+"/node_modules/.pnpm/@neondatabase+serverless@1.1.0/node_modules/@neondatabase/serverless/index.js");
const sql = neon(url);
(async () => {
  const rows = await sql`
    SELECT s->>'domain' AS domain, s->>'url' AS url, s->>'title' AS title, e.name AS engine
    FROM "Tracking" t JOIN "Engine" e ON e.id=t."engineId"
      JOIN LATERAL jsonb_array_elements((t."citedSources")::jsonb) s ON true
    WHERE t."trackedAt" > now() - interval '90 minutes'
      AND (s->>'domain' LIKE '%laneige%' OR s->>'domain' LIKE '%whoo%'
           OR s->>'domain' LIKE '%esteelauder%' OR s->>'domain' LIKE '%amorepacific%'
           OR s->>'domain' LIKE '%sk-ii%' OR s->>'domain' LIKE '%hera%')`;
  console.log("=== 경쟁사로 분류된 도메인의 실제 URL ===");
  const seen=new Set();
  for (const r of rows) {
    const k=r.url;
    if(seen.has(k)) continue; seen.add(k);
    console.log(`\n[${r.engine}] ${r.domain}`);
    console.log(`  URL: ${r.url}`);
    console.log(`  제목: ${r.title||"(없음)"}`);
  }
})();
