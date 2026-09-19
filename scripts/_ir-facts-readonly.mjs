/**
 * OverEdge 1차 오디션 IR 덱 v14 — 사실 확인용 **읽기 전용** 조회.
 *
 * 🔴 SELECT 만 한다. write 없음.
 * 🔴 비밀값은 절대 출력하지 않는다 — DB 호스트는 엔드포인트 이름만 보여준다.
 *
 * 사용: node scripts/_ir-facts-readonly.mjs
 */
import { readFileSync } from "node:fs";
import { neon } from "../packages/database/node_modules/@neondatabase/serverless/index.mjs";

const DB_URL_RE = /^DATABASE_URL="?([^"\n]+)"?$/m;

function dbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const f of [".env.local", "apps/app/.env.local", "../../.env.local"]) {
    try {
      const m = readFileSync(f, "utf8").match(DB_URL_RE);
      if (m) return m[1];
    } catch {
      /* 다음 후보 */
    }
  }
  throw new Error("DATABASE_URL 을 찾지 못했다.");
}

const url = dbUrl();
const endpoint = url.match(/@(ep-[^.]*)\./)?.[1] ?? "unknown";
console.log(`# DB 엔드포인트: ${endpoint}`);

const sql = neon(url);

const out = async (label, q) => {
  try {
    const rows = await sql.query(q);
    console.log(`\n## ${label}`);
    console.log(JSON.stringify(rows, null, 1));
  } catch (e) {
    console.log(`\n## ${label}\n!! 실패: ${e.message}`);
  }
};

await out(
  "조직 · 사용자 · 브랜드 총계",
  `select
     (select count(*) from "Organization") as orgs,
     (select count(*) from "User") as users,
     (select count(*) from "Brand") as brands,
     (select count(*) from "Tracking") as trackings,
     (select count(*) from "AuditJob") as audit_jobs,
     (select count(*) from "AuditJob" where status = 'completed') as audit_completed,
     (select count(*) from "Content") as contents,
     (select count(*) from "Content" where status = 'published') as contents_published`
);

await out(
  "조직 목록 (가입일순, 최근 40)",
  `select o.id, o.name, o.plan, o."billingStatus", o."createdAt"::date as created,
          (select count(*) from "User" u where u."organizationId" = o.id) as members,
          (select count(*) from "Brand" b where b."organizationId" = o.id) as brands
     from "Organization" o
    order by o."createdAt" desc
    limit 40`
);

await out(
  "브랜드별 측정 현황 (측정 많은 순, 상위 30)",
  `select b.name, b.domain, b."organizationId",
          count(t.id) as trackings,
          sum(case when t."brandMentioned" then 1 else 0 end) as mentioned,
          min(t."trackedAt")::date as first_tracked,
          max(t."trackedAt")::date as last_tracked
     from "Brand" b
     left join "Tracking" t on t."brandId" = b.id
    group by b.id, b.name, b.domain, b."organizationId"
    order by count(t.id) desc
    limit 30`
);

await out(
  "엔진별 측정·언급 (전체 기간)",
  `select e.id, e.name, count(t.id) as trackings,
          sum(case when t."brandMentioned" then 1 else 0 end) as mentioned,
          round(100.0 * sum(case when t."brandMentioned" then 1 else 0 end) / nullif(count(t.id),0), 1) as mention_rate
     from "Engine" e
     left join "Tracking" t on t."engineId" = e.id
    group by e.id, e.name
    order by count(t.id) desc`
);

await out(
  "발행된 콘텐츠 (published)",
  `select c.id, c.title, c.locale, c.slug, c."contentType", c."publishedAt",
          c."sourceActionKind", c."sourceActionTarget", c."sourceMeasuredAt",
          p.name as publisher, p.kind as publisher_kind, p."brandId"
     from "Content" c
     join "Publisher" p on p.id = c."publisherId"
    where c.status = 'published'
    order by c."publishedAt" desc nulls last
    limit 40`
);

await out(
  "콘텐츠 상태별 건수",
  `select status, count(*) from "Content" group by status order by count(*) desc`
);

await out(
  "측정 일자별 건수 (최근 30일)",
  `select t."trackedAt"::date as day, count(*) as trackings,
          count(distinct t."brandId") as brands
     from "Tracking" t
    where t."trackedAt" > now() - interval '30 days'
    group by 1 order by 1 desc`
);

await out(
  "무료진단(AuditJob) 상태별·최근",
  `select status, count(*) from "AuditJob" group by status order by count(*) desc`
);

await out(
  "유료 상태 확인 (plan · billingStatus 분포)",
  `select plan, "billingStatus", count(*) from "Organization" group by plan, "billingStatus" order by count(*) desc`
);
