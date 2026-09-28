// 영업 리드 스냅샷 만들기 — 측정 폴더(leads.json + summary/leads/*.json) → 앱이 읽는 JSON 1개.
//
// 사용법 (저장소 루트에서):
//   node scripts/outreach/build-lead-snapshot.mjs <측정폴더> [--out apps/app/lib/ax-mail/data/leads-snapshot.json]
//   예: node scripts/outreach/build-lead-snapshot.mjs ../Findable_측정데이터_20260929
//
// 원칙
// - 숫자는 전부 여기서 **센다**. 문장을 만들지 않는다(문장은 앱의 compose.ts 가 이 숫자로만 조립).
// - 발췌문(excerpt)은 측정 스크립트가 원문 부분문자열 검증을 통과시킨 것만 들어온다(hooks.mjs).
// - 받는 사람 메일은 contacts.json 에 **공식 사이트 출처가 있는 것만**. 추정 주소 금지.
// - API 키·원문 전체는 넣지 않는다(판정 요약·발췌 1개만).

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dataDir = args[0] && !args[0].startsWith("--") ? resolve(args[0]) : null;
if (!dataDir) {
  process.stderr.write(
    "사용법: node scripts/outreach/build-lead-snapshot.mjs <측정폴더> [--out 파일]\n"
  );
  process.exit(1);
}
const outIndex = args.indexOf("--out");
const out = resolve(
  outIndex >= 0
    ? args[outIndex + 1]
    : join(here, "../../apps/app/lib/ax-mail/data/leads-snapshot.json")
);

/** 이미 연락이 와서 진행 중인 곳 — 콜드 영업 대상이 아니다(대표 지시 2026-09-29). */
const INBOUND_DOMAINS = new Set([
  "www.knowverse.net",
  "knowverse.net",
  "dd.knowverse.net",
]);

const ENGINE_NAMES = {
  chatgpt: "ChatGPT",
  chatgpt_search: "ChatGPT",
  gemini: "Gemini",
  claude: "Claude",
  perplexity: "Perplexity",
};

const QUOTED_LABEL_RE = /“([^”]+)”/;

function trackOf(lead) {
  if (INBOUND_DOMAINS.has(lead.domain)) {
    return "inbound";
  }
  return lead.segment.startsWith("기존고객") ? "existing" : "prospect";
}

const ENGINE_ORDER = ["ChatGPT", "Gemini", "Claude", "Perplexity"];

function industryOf(segment) {
  if (segment.startsWith("기존고객")) {
    return "existing";
  }
  if (segment.startsWith("K-뷰티") || segment.startsWith("소비재")) {
    return "beauty";
  }
  if (segment.startsWith("B2B")) {
    return "b2b";
  }
  if (segment.startsWith("금융")) {
    return "finance";
  }
  return "partner";
}

function readJsonl(file) {
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

/** 도메인별 마지막 측정 시각(KST 날짜). */
const lastMeasured = new Map();
const rawDir = join(dataDir, "raw");
const rawRows = (existsSync(rawDir) ? readdirSync(rawDir) : [])
  .filter((f) => f.endsWith(".jsonl"))
  .flatMap((f) => readJsonl(join(rawDir, f)));
const leads = JSON.parse(readFileSync(join(dataDir, "leads.json"), "utf8"));
// job3(K-뷰티 우선 측정)은 domain 없이 brand 만 남긴다 → 명단의 브랜드명으로 도메인을 찾는다.
const domainByBrand = new Map(
  leads.flatMap((l) =>
    [l.brand, l.brand_en]
      .filter(Boolean)
      .map((name) => [name.toLowerCase(), l.domain])
  )
);
const PROMPT_BRAND_RE = /^(.+)-s\d+$/;
// 판정 요약(summary)의 promptId 앞부분(예: "Purito-s1" → purito)도 도메인 단서로 쓴다
// (명단 브랜드명 「퓨리토 서울」 ≠ 측정 브랜드명 「퓨리토」 인 경우).
const summaryDirEarly = join(dataDir, "summary/leads");
for (const f of existsSync(summaryDirEarly)
  ? readdirSync(summaryDirEarly)
  : []) {
  if (!f.endsWith(".json")) {
    continue;
  }
  const s = JSON.parse(readFileSync(join(summaryDirEarly, f), "utf8"));
  for (const v of s.verdicts ?? []) {
    const prefix = String(v.promptId ?? "").match(PROMPT_BRAND_RE)?.[1];
    if (prefix && !domainByBrand.has(prefix.toLowerCase())) {
      domainByBrand.set(prefix.toLowerCase(), s.domain);
    }
  }
}
for (const row of rawRows) {
  const domain =
    row.domain ??
    domainByBrand.get(String(row.brand ?? "").toLowerCase()) ??
    domainByBrand.get(
      String(row.promptId ?? "")
        .match(PROMPT_BRAND_RE)?.[1]
        ?.toLowerCase()
    );
  if (!(domain && row.timestamp) || row.error) {
    continue;
  }
  const prev = lastMeasured.get(domain);
  if (!prev || row.timestamp > prev) {
    lastMeasured.set(domain, row.timestamp);
  }
}
const kstDate = (iso) =>
  new Date(new Date(iso).getTime() + 9 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

const contacts = JSON.parse(readFileSync(join(here, "contacts.json"), "utf8"));
const summaryDir = join(dataDir, "summary/leads");
const summaries = new Map(
  (existsSync(summaryDir) ? readdirSync(summaryDir) : [])
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const s = JSON.parse(readFileSync(join(summaryDir, f), "utf8"));
      return [s.domain, s];
    })
);

function measurementOf(s) {
  if (!s) {
    return null;
  }
  const verdicts = Array.isArray(s.verdicts) ? s.verdicts : [];
  const withCitations = verdicts.filter((v) => (v.citedCount ?? 0) > 0);
  const engines = ENGINE_ORDER.filter((name) =>
    verdicts.some((v) => (ENGINE_NAMES[v.engine] ?? v.engine) === name)
  );
  const hook = s.hook
    ? {
        label: s.hook.text?.match(QUOTED_LABEL_RE)?.[1] ?? null,
        labelCount: s.hook.topLabelCount ?? 0,
        independentCorrect: s.hook.correctIndependent ?? null,
        excerpt: s.hook.excerpt ?? null,
        excerptEngine: s.hook.excerptEngine ?? null,
      }
    : null;
  return {
    measuredOn: lastMeasured.has(s.domain)
      ? kstDate(lastMeasured.get(s.domain))
      : null,
    answers: verdicts.length,
    engines,
    /** 저장소 판정기(mention-verdict)가 「이 브랜드를 맞게 안다」로 확정한 답변 수. */
    productConfirmed: verdicts.filter((v) => v.quality === "confirmed").length,
    /** 출처 링크를 1개 이상 단 답변 / 그중 공식 도메인을 인용한 답변 — URL 대조라 판정기와 무관. */
    answersWithCitations: withCitations.length,
    officialCited: withCitations.filter((v) => v.officialDomainCited).length,
    hook,
  };
}

const snapshot = leads.map((lead) => {
  const contact = contacts[lead.domain] ?? null;
  return {
    id: lead.domain,
    brand: lead.brand,
    brandEn: lead.brand_en ?? null,
    company: lead.company,
    domain: lead.domain,
    segment: lead.segment,
    industry: industryOf(lead.segment),
    priority: lead.priority ?? 3,
    track: trackOf(lead),
    contact,
    measurement: measurementOf(summaries.get(lead.domain)),
    reportUrl: null,
  };
});

writeFileSync(
  out,
  `${JSON.stringify({ generatedFrom: dataDir.split("/").pop(), leads: snapshot }, null, 2)}\n`
);
const measured = snapshot.filter((l) => l.measurement).length;
const withHook = snapshot.filter((l) => l.measurement?.hook).length;
const withContact = snapshot.filter((l) => l.contact).length;
process.stderr.write(
  `리드 ${snapshot.length}곳 · 측정 ${measured} · 영업 한 줄 ${withHook} · 공식 연락처 ${withContact} → ${out}\n`
);
