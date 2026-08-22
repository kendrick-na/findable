/**
 * N-49 — 브리핑 편입을 **DB 로 판정**한다(읽기전용 SELECT · 원가 0).
 *
 * 🔴 화면만 보면 STUB 과 진짜를 구분 못 한다. 키가 없으면 어댑터가 **STUB 을 돌려주고**
 *   (크래시가 아니다) 화면엔 그냥 「미노출」처럼 보인다.
 *   → `rawResponse` 의 `[STUB]` 접두어로 가른다(`naver-briefing-adapter.ts` STUB_NOTICE).
 *
 * ⚠️ 스키마를 추측하지 않았다 — `Tracking` 모델을 직접 읽고 필드명을 맞췄다
 *   (`EngineResponse` 모델은 **없다** · `isStub` 컬럼도 **없다** · 시각은 `trackedAt`).
 * ⚠️ `@repo/database` 는 `server-only` 라 node 로 직접 못 부른다 → neon 드라이버로 SELECT.
 *   📕 메모리 규율: 운영 DB **읽기전용만**. 다건 write 는 👤 승인 대상.
 *
 * 사용: node scripts/n49-briefing-db.mjs
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

// 🔴 정규식은 최상위에 둔다(useTopLevelRegex) — 함수 안이면 호출마다 재컴파일된다.
const DB_URL_RE = /^DATABASE_URL="?([^"\n]+)"?$/m;
const BRIEFING_ENGINE_RE = /brief|브리핑/i;

function dbUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  // 실행 위치가 어디든 찾도록 후보를 넓게 둔다(루트·워크스페이스 양쪽).
  for (const f of [
    "../../.env.local",
    "../../apps/app/.env.local",
    ".env.local",
    "apps/app/.env.local",
  ]) {
    try {
      const m = readFileSync(f, "utf8").match(DB_URL_RE);
      if (m) {
        return m[1];
      }
    } catch {
      /* 다음 후보 */
    }
  }
  throw new Error("DATABASE_URL 을 못 찾았다");
}

const sql = neon(dbUrl());
const STUB_MARK = "[STUB]";

async function main() {
  // ① 브리핑 엔진 id 를 하드코딩하지 않고 찾는다.
  const engines = await sql`SELECT id, name FROM "Engine"`;
  const brief = engines.filter((e) =>
    BRIEFING_ENGINE_RE.test(`${e.id} ${e.name ?? ""}`)
  );
  if (brief.length === 0) {
    console.log(
      "🔴 브리핑 엔진 없음. 등록된 엔진:",
      engines.map((e) => e.id).join(", ")
    );
    return;
  }
  const ids = brief.map((e) => e.id);
  console.log(
    "브리핑 엔진:",
    brief.map((e) => `${e.id}(${e.name ?? "-"})`).join(", ")
  );

  const [{ count: total }] = await sql`
    SELECT COUNT(*)::int AS count FROM "Tracking" WHERE "engineId" = ANY(${ids})`;
  console.log(`\n=== 브리핑 Tracking 총 ${total}건 ===`);

  const recent = await sql`
    SELECT t."trackedAt", t."rawResponse", t."brandMentioned",
           t."errorMessage", t."citedSources", b."name" AS brand
    FROM "Tracking" t
    LEFT JOIN "Brand" b ON b."id" = t."brandId"
    WHERE t."engineId" = ANY(${ids})
    ORDER BY t."trackedAt" DESC
    LIMIT 12`;

  let real = 0;
  let stub = 0;
  console.log(`\n=== 최근 ${recent.length}건 ===`);
  for (const r of recent) {
    const isStub = (r.rawResponse ?? "").includes(STUB_MARK);
    isStub ? stub++ : real++;
    const src = Array.isArray(r.citedSources) ? r.citedSources.length : 0;
    const err = r.errorMessage
      ? ` err=${String(r.errorMessage).slice(0, 70)}`
      : "";
    console.log(
      `  ${new Date(r.trackedAt).toISOString().slice(0, 19)} ` +
        `[${isStub ? "STUB" : "REAL"}] ${r.brand ?? "?"} ` +
        `언급=${r.brandMentioned} 출처=${src}${err}`
    );
  }
  console.log(`\n최근 표본: REAL ${real} · STUB ${stub}`);

  const [{ count: last2h }] = await sql`
    SELECT COUNT(*)::int AS count FROM "Tracking"
    WHERE "engineId" = ANY(${ids})
      AND "trackedAt" >= NOW() - INTERVAL '2 hours'`;
  console.log(`최근 2시간 내 브리핑 응답: ${last2h}건`);
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
