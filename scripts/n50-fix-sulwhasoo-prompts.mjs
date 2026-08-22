/**
 * N-50 — 설화수(652a8dca-...) Prompt.text 에 박힌 도메인 문자열을 브랜드명으로 교체.
 *
 * 원인: 최초 측정 시점(2026-08-14) brandName 미입력 → generateAuditPrompts 가
 *   도메인(sulwhasoo.com)으로 프롬프트를 만들어 영구 저장(runner.ts persistFallbackPrompts).
 *   이름이 나중에 "설화수"로 고쳐졌지만 이미 저장된 프롬프트는 재생성되지 않음
 *   (resolveRunPrompts 가 저장분을 우선 재사용).
 *
 * text 만 UPDATE(id 유지) → Tracking.promptId 연결·시계열 안 끊김.
 * 기본은 DRY RUN(변경 미리보기만). 실제 적용은 --apply 플래그.
 *
 * 사용: node scripts/n50-fix-sulwhasoo-prompts.mjs        (미리보기)
 *       node scripts/n50-fix-sulwhasoo-prompts.mjs --apply (실제 UPDATE)
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const DB_URL_RE = /^DATABASE_URL="?([^"\n]+)"?$/m;
const BRAND_ID = "652a8dca-c501-4f40-a28e-43f0bead3292";
const OLD_TOKEN = "sulwhasoo.com";
const NEW_TOKEN = "설화수";

function dbUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
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
const apply = process.argv.includes("--apply");

async function main() {
  const brand = await sql`SELECT id, name, domain FROM "Brand" WHERE id = ${BRAND_ID}`;
  if (brand.length === 0) {
    console.log("🔴 브랜드를 못 찾음:", BRAND_ID);
    return;
  }
  console.log(`브랜드: ${brand[0].name} (${brand[0].domain})`);

  const prompts = await sql`
    SELECT id, text FROM "Prompt" WHERE "brandId" = ${BRAND_ID} ORDER BY "createdAt" ASC
  `;

  console.log(`\n${apply ? "적용" : "미리보기(DRY RUN)"} — 대상 ${prompts.length}건\n`);

  for (const p of prompts) {
    if (!p.text.includes(OLD_TOKEN)) {
      console.log(`  (변경없음) "${p.text}"`);
      continue;
    }
    const newText = p.text.split(OLD_TOKEN).join(NEW_TOKEN);
    console.log(`  "${p.text}"\n  → "${newText}"`);
    if (apply) {
      await sql`UPDATE "Prompt" SET text = ${newText} WHERE id = ${p.id}`;
    }
  }

  if (!apply) {
    console.log("\n실제 반영하려면 --apply 를 붙여 다시 실행.");
  } else {
    console.log("\n✅ 반영 완료.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
