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
/** 도메인별 브랜드 질문(「OO은 어떤 브랜드야?」 등) 원자료. 업종 질문(job2)은 따로 센다. */
const brandedRows = new Map();
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
  if (row.job !== "job2" && row.rawResponse) {
    const list = brandedRows.get(domain) ?? [];
    list.push(row);
    brandedRows.set(domain, list);
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

const profiles = JSON.parse(
  readFileSync(join(here, "brand-profiles.json"), "utf8")
);
const WWW_RE = /^www\./;
const MARKDOWN_RE = /[*#`]/g;
const bare = (d) =>
  String(d ?? "")
    .toLowerCase()
    .replace(WWW_RE, "");
function officialDomainsOf(domain) {
  return [
    ...new Set([
      bare(domain),
      ...(profiles[domain]?.officialDomains ?? []).map(bare),
    ]),
  ];
}
function aliasesOf(lead) {
  const list = profiles[lead.domain]?.aliases ?? [lead.brand, lead.brand_en];
  return [...new Set(list.filter((a) => a && a.length >= 2))];
}
const isOfficial = (sourceDomain, officials) => {
  const d = bare(sourceDomain);
  return officials.some((o) => d === o || d.endsWith(`.${o}`));
};

/** 출처 인용 — 원자료의 citedSources 를 공식 도메인 목록(해외 공식몰 포함)과 대조. */
function citationsOf(domain) {
  const rows = brandedRows.get(domain) ?? [];
  const officials = officialDomainsOf(domain);
  const withSources = rows.filter((r) => (r.citedSources ?? []).length > 0);
  const official = withSources.filter((r) =>
    r.citedSources.some((c) => isOfficial(c.domain, officials))
  );
  const others = new Map();
  for (const r of withSources) {
    for (const d of new Set(r.citedSources.map((c) => bare(c.domain)))) {
      if (d && !isOfficial(d, officials)) {
        others.set(d, (others.get(d) ?? 0) + 1);
      }
    }
  }
  return {
    officialDomains: officials,
    answersWithCitations: withSources.length,
    officialCited: official.length,
    topOtherSources: [...others.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([d, answers]) => ({ domain: d, answers })),
  };
}

function measurementOf(s) {
  if (!s) {
    return null;
  }
  const verdicts = Array.isArray(s.verdicts) ? s.verdicts : [];
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
    /** 출처 링크를 1개 이상 단 답변 / 그중 공식 도메인(해외 공식몰 포함)을 인용한 답변 — URL 대조라 판정기와 무관. */
    ...citationsOf(s.domain),
    hook,
  };
}

// ── 업종 구매 질문(job2: 브랜드 이름 없이 「어성초 토너 추천해줘」 등) ────────────
// 답변 원문에 브랜드 표기가 들어 있으면 「추천됨」으로 센다(문자열 대조, 판정기 없음).
const categoryRows = rawRows.filter(
  (r) => r.job === "job2" && !r.error && r.rawResponse
);
const beautyLeads = leads.filter((l) => industryOf(l.segment) === "beauty");
const mentions = (text, lead) => {
  const t = text.toLowerCase();
  return aliasesOf(lead).some((a) => t.includes(a.toLowerCase()));
};
/** 답변에서 브랜드 표기가 든 한 줄. 서식 기호(*, #, `)만 지우고 글자는 그대로 둔다. */
function lineWith(text, lead) {
  const line = text
    .split("\n")
    .find((l) => mentions(l, lead))
    ?.replace(MARKDOWN_RE, "")
    .trim();
  if (!line) {
    return null;
  }
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}
const questions = new Map();
for (const r of categoryRows) {
  const q = questions.get(r.promptId) ?? {
    promptId: r.promptId,
    prompt: r.prompt,
    topic: r.topic,
    rows: [],
  };
  q.rows.push(r);
  questions.set(r.promptId, q);
}
const mentionCount = new Map(
  beautyLeads.map((l) => [
    l.domain,
    categoryRows.filter((r) => mentions(r.rawResponse, l)).length,
  ])
);
const rankOrder = [...mentionCount.entries()].sort((a, b) => b[1] - a[1]);

function categoryOf(lead) {
  if (!(categoryRows.length && industryOf(lead.segment) === "beauty")) {
    return null;
  }
  const perQuestion = [...questions.values()].map((q) => {
    const counts = beautyLeads
      .map((l) => ({
        lead: l,
        mentioned: q.rows.filter((r) => mentions(r.rawResponse, l)).length,
      }))
      .sort((a, b) => b.mentioned - a.mentioned);
    const ours =
      counts.find((c) => c.lead.domain === lead.domain)?.mentioned ?? 0;
    const leader = counts.find((c) => c.lead.domain !== lead.domain);
    const leaderRow = leader
      ? q.rows.find((r) => mentions(r.rawResponse, leader.lead))
      : null;
    return {
      promptId: q.promptId,
      prompt: q.prompt,
      topic: q.topic,
      answers: q.rows.length,
      mentioned: ours,
      leader: leader
        ? { brand: leader.lead.brand, mentioned: leader.mentioned }
        : null,
      leaderExcerpt:
        leaderRow && leader
          ? {
              engine: ENGINE_NAMES[leaderRow.engine] ?? leaderRow.engine,
              text: lineWith(leaderRow.rawResponse, leader.lead),
            }
          : null,
    };
  });
  const missed = perQuestion
    .filter((q) => q.mentioned === 0 && q.leader && q.leader.mentioned > 0)
    .sort(
      (a, b) => b.leader.mentioned / b.answers - a.leader.mentioned / a.answers
    )
    .slice(0, 5);
  const won = perQuestion
    .filter((q) => q.mentioned > 0)
    .sort((a, b) => b.mentioned / b.answers - a.mentioned / a.answers)
    .slice(0, 3);
  return {
    questionSet: "K-뷰티 구매 질문 (브랜드명 없음)",
    questions: questions.size,
    answers: categoryRows.length,
    engines: ENGINE_ORDER.filter((name) =>
      categoryRows.some((r) => (ENGINE_NAMES[r.engine] ?? r.engine) === name)
    ),
    mentioned: mentionCount.get(lead.domain) ?? 0,
    questionsMentioned: perQuestion.filter((q) => q.mentioned > 0).length,
    rank: rankOrder.findIndex(([d]) => d === lead.domain) + 1,
    brandsCompared: beautyLeads.length,
    leaders: rankOrder
      .filter(([d]) => d !== lead.domain)
      .slice(0, 3)
      .map(([d, n]) => ({
        brand: beautyLeads.find((l) => l.domain === d)?.brand ?? d,
        mentioned: n,
      })),
    missed,
    won,
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
    category: categoryOf(lead),
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
