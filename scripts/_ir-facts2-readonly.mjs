/**
 * IR v14 사실확인 2탄 — 발행 전후 재측정 · 코호트 · 결제상태. **읽기 전용**.
 */
import { readFileSync } from "node:fs";
import { neon } from "../packages/database/node_modules/@neondatabase/serverless/index.mjs";

const DB_URL_RE = /^DATABASE_URL="?([^"\n]+)"?$/m;
const url =
  process.env.DATABASE_URL ?? readFileSync(".env.local", "utf8").match(DB_URL_RE)[1];
const sql = neon(url);

const out = async (label, q) => {
  try {
    console.log(`\n## ${label}`);
    console.log(JSON.stringify(await sql.query(q), null, 1));
  } catch (e) {
    console.log(`!! 실패: ${e.message}`);
  }
};

await out(
  "요금제·결제 분포 (실과금 여부 판정)",
  `select plan, "billingStatus", "billingProvider", count(*)
     from "Organization" group by 1,2,3 order by 4 desc`
);

await out(
  "결제수단 등록(billingCustomerId) 보유 조직",
  `select count(*) filter (where "billingCustomerId" is not null) as with_billing_key,
          count(*) as total from "Organization"`
);

await out(
  "Findable 자체 브랜드 — 일자별 언급률 (발행 전후 비교용)",
  `select t."trackedAt"::date as day, count(*) as n,
          sum(case when t."brandMentioned" then 1 else 0 end) as mentioned,
          round(100.0*sum(case when t."brandMentioned" then 1 else 0 end)/count(*),1) as rate
     from "Tracking" t join "Brand" b on b.id = t."brandId"
    where b.domain = 'findable.co.kr'
    group by 1 order by 1`
);

await out(
  "인디고차일드 — 일자별 언급률",
  `select t."trackedAt"::date as day, count(*) as n,
          sum(case when t."brandMentioned" then 1 else 0 end) as mentioned,
          round(100.0*sum(case when t."brandMentioned" then 1 else 0 end)/count(*),1) as rate
     from "Tracking" t join "Brand" b on b.id = t."brandId"
    where b.domain = 'indigochild.kr'
    group by 1 order by 1`
);

await out(
  "브랜드별 첫 측정 vs 최근 측정 언급률 (전후 변화 후보 탐색)",
  `with f as (
     select t."brandId", min(t."trackedAt"::date) as d0, max(t."trackedAt"::date) as d1
       from "Tracking" t group by 1
   )
   select b.name, b.domain, f.d0, f.d1,
     (select round(100.0*avg(case when t."brandMentioned" then 1 else 0 end),1)
        from "Tracking" t where t."brandId"=b.id and t."trackedAt"::date = f.d0) as rate_first,
     (select count(*) from "Tracking" t where t."brandId"=b.id and t."trackedAt"::date = f.d0) as n_first,
     (select round(100.0*avg(case when t."brandMentioned" then 1 else 0 end),1)
        from "Tracking" t where t."brandId"=b.id and t."trackedAt"::date = f.d1) as rate_last,
     (select count(*) from "Tracking" t where t."brandId"=b.id and t."trackedAt"::date = f.d1) as n_last
   from "Brand" b join f on f."brandId" = b.id
   where f.d0 <> f.d1
   order by b.name`
);

await out(
  "무료진단(AuditJob) — 도메인 수·기간",
  `select count(*) as jobs, count(distinct domain) as domains,
          count(distinct email) as emails,
          min("createdAt")::date as first, max("createdAt")::date as last
     from "AuditJob"`
);

await out(
  "AuditJob 최근 20건 (도메인·상태)",
  `select domain, status, "createdAt"::date as day from "AuditJob"
    order by "createdAt" desc limit 20`
);

await out(
  "콘텐츠 발행 일자별 (자체 채널)",
  `select "publishedAt"::date as day, count(*) from "Content"
    where status='published' group by 1 order by 1`
);

await out(
  "추적 질문(Prompt) 수 · 브랜드당",
  `select count(*) as prompts, count(distinct "brandId") as brands from "Prompt"`
);
