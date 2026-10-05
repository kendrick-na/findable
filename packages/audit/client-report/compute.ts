// 고객 GEO 진단 리포트 — 숫자 계산.
//
// 원본 = `Findable_GEO리포트_템플릿/build.py` 의 compute(). **한 줄씩 그대로 옮겼다.**
// 🔴 로직을 여기서만 바꾸지 말 것 — 웹 리포트와 PDF(파이썬 템플릿)가 서로 다른 숫자를
//   말하게 된다. 바꿀 땐 build.py 도 같이 바꾸고 `client-report-compute.test.ts`
//   (파이썬 출력과 전 키 대조)를 다시 돌린다.
//
// 이 파일은 순수 함수다(DB·fs 없음) — 웹 페이지·import 스크립트·테스트가 같이 쓴다.

import { pyCompareStrings, pyRound } from "./py-compat";

export const ENGINE_NAMES = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  hyperclova: "HyperCLOVA X",
  naver: "네이버 검색 노출",
  daum: "다음 검색",
} as const;
export type EngineId = keyof typeof ENGINE_NAMES;
export const ENGINE_ORDER = Object.keys(ENGINE_NAMES) as EngineId[];
export const ENGINE_MONO: Record<EngineId, string> = {
  chatgpt: "GPT",
  claude: "Cl",
  perplexity: "Px",
  gemini: "Ge",
  hyperclova: "HX",
  naver: "N",
  daum: "D",
};

/** Current display labels also normalize labels stored by older snapshots. */
export function currentEngineDisplayName(
  engineId: string,
  fallback?: string,
  legacySyntheticEngineIds: readonly string[] = []
): string {
  if (engineId === "naver" && legacySyntheticEngineIds.includes("naver")) {
    return "네이버 Cue 재현 (Findable 합성)";
  }
  return ENGINE_NAMES[engineId as EngineId] ?? fallback ?? engineId;
}

export function currentEngineDisplayText(
  text: string,
  legacySyntheticEngineIds: readonly string[] = []
): string {
  if (!legacySyntheticEngineIds.includes("naver")) {
    return text;
  }
  return text.replace(
    /(^|[·,]\s*)네이버 AI(?=\s*(?:$|[·,]))/g,
    "$1네이버 Cue 재현 (Findable 합성)"
  );
}

export const LABELS = {
  ok: { name: "정확", desc: "실제 브랜드와 서비스를 맞게 설명" },
  other: { name: "다른 회사로 착각", desc: "이름이 비슷한 실존 회사를 설명" },
  made: { name: "지어낸 설명", desc: "근거 없이 엉뚱한 업종·서비스를 설명" },
  generic: {
    name: "일반명사로 해석",
    desc: "브랜드가 아닌 일반 개념으로 설명",
  },
  unknown: { name: "모른다", desc: "정보를 찾지 못했다고 답변" },
  none: { name: "결과 없음", desc: "답변 없음 또는 무관한 검색 결과" },
} as const;
export type LabelId = keyof typeof LABELS;
const BAD = new Set<LabelId>(["other", "made", "generic", "unknown", "none"]);

export const CHANNELS = [
  ["official", "공식 사이트"],
  ["lookalike", "동명·유사명 회사"],
  ["blog", "블로그"],
  ["bizdb", "기업정보·리뷰"],
  ["wiki", "위키·커뮤니티"],
  ["news", "뉴스·미디어"],
  ["video", "영상"],
  ["etc", "기타 웹사이트"],
] as const;
export type ChannelId = (typeof CHANNELS)[number][0];
const CH_NAME = Object.fromEntries(CHANNELS) as Record<ChannelId, string>;
// 파이썬 dict 순서 그대로(판정 우선순위가 이 순서다).
const PATTERNS: [ChannelId, string[]][] = [
  [
    "blog",
    [
      "blog.naver.com",
      "tistory.com",
      "steemit.com",
      "medium.com",
      "brunch.co.kr",
      "blogspot.com",
      "velog.io",
    ],
  ],
  [
    "bizdb",
    [
      "bizwiki.co.kr",
      "saramin.co.kr",
      "linkedin.com",
      "thevc.kr",
      "cbinsights.com",
      "g2.com",
      "crunchbase.com",
      "jobkorea.co.kr",
      "alternativeto.net",
      "diningcode.com",
    ],
  ],
  ["wiki", ["namu.wiki", "wikipedia.org", "reddit.com", "inven.co.kr"]],
  [
    "news",
    [
      "v.daum.net",
      "news.",
      "fnnews.com",
      "allurekorea.com",
      "traveldaily.co.kr",
      "investing.com",
      "elle.com",
      "byrdie.com",
      "marieclairekorea.com",
    ],
  ],
  ["video", ["youtube.com"]],
];

/** 사람이 확정한 답변 1건 판별. `l`=판정, `who`=AI가 말한 정체, `q`=답변 핵심 한 줄. */
export interface ClientReportLabel {
  l: LabelId;
  q: string;
  who: string;
}

/** config.json — 사람이 원문을 읽고 채운 판별·문구. compute 에 필요한 필드만 강제한다. */
export interface ClientReportConfig {
  labels: ClientReportLabel[];
  lookalike_domains?: string[];
  official_domains: string[];
  question_short: string[];
  questions: string[];
  [key: string]: unknown;
}

/** audit.json(= `/api/audit/<id>` 응답) 중 compute 가 읽는 부분. */
export interface ClientReportAudit {
  result: {
    engineResponses: {
      citedSources?: unknown[] | null;
      engineId?: string | null;
      promptText?: string | null;
    }[];
  };
}

export interface ReportAnswer {
  domains: string[];
  engine: EngineId;
  label: LabelId;
  official: number;
  q: number;
  quote: string;
  who: string;
}

export interface ReportEngine {
  /** 질문 번호(문자열 키) → 그 질문의 답변. JSON 으로 동결되므로 키가 문자열이다. */
  cells: Record<string, ReportAnswer>;
  cites: number;
  generic: number;
  id: EngineId;
  made: number;
  n: number;
  name: string;
  official: number;
  ok: number;
  other: number;
  rate: number;
  unknown: number;
}

export interface ReportQuestionStat {
  i: number;
  n: number;
  ok: number;
  rate: number;
  short: string;
  text: string;
}

export interface ReportChannel {
  id: ChannelId;
  n: number;
  name: string;
  pct: number;
}

export interface ReportTopDomain {
  ch: ChannelId;
  domain: string;
  engines: string;
  in_ok: boolean;
  n: number;
  type: string;
  w: number;
}

export interface ReportStats {
  bad_n: number;
  /** v12 문장용(발행 v2 에서만 채움) — 「다른 회사로 착각 5 · 지어낸 설명 3 · 모른다 3」. */
  bad_parts?: string;
  bad_rate: number;
  bad_with_official: number;
  cites_total: number;
  correct_engine_names: string;
  engines_correct: number;
  engines_total: number;
  faces_n: number;
  generic_n: number;
  made_n: number;
  n: number;
  nq: number;
  /** v12 — 출처에 공식 사이트가 있던 답변 수(v2 에서만 채움). */
  off_ans?: number;
  official_cites: number;
  /** 파이썬에서 인용이 있으면 소수 1자리 실수, 없으면 정수 0. 표시는 formatOfficialPct. */
  official_pct: number;
  ok_n: number;
  ok_rate: number;
  ok_with_official: number;
  other_n: number;
  unknown_n: number;
  wrong_n: number;
  wrong_rate: number;
}

export interface ClientReportComputed {
  answers: ReportAnswer[];
  channels: ReportChannel[];
  engines: ReportEngine[];
  per_q: ReportQuestionStat[];
  s: ReportStats;
  top: ReportTopDomain[];
}

const isEngineId = (v: unknown): v is EngineId =>
  typeof v === "string" && Object.hasOwn(ENGINE_NAMES, v);

export function norm(d: string | null | undefined): string {
  const x = (d || "").toLowerCase().trim();
  return x.startsWith("www.") ? x.slice(4) : x;
}

export function matchDomain(d: string, doms: readonly string[]): boolean {
  return doms.some((x) => d === x || d.endsWith(`.${x}`));
}

export function channelOf(d: string, cfg: ClientReportConfig): ChannelId {
  if (matchDomain(d, cfg.official_domains)) {
    return "official";
  }
  if (matchDomain(d, cfg.lookalike_domains ?? [])) {
    return "lookalike";
  }
  for (const [ch, pats] of PATTERNS) {
    if (pats.some((p) => d.includes(p))) {
      return ch;
    }
  }
  return "etc";
}

/** Python `Counter` 처럼 없는 키는 0. */
const countBy = <T>(items: T[], key: (t: T) => string) => {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return (k: string) => m.get(k) ?? 0;
};

const domainOf = (s: unknown): string | null => {
  if (typeof s !== "object" || s === null || Array.isArray(s)) {
    return null; // 파이썬: isinstance(s, dict) 가 아니면 건너뛴다
  }
  const d = (s as { domain?: unknown }).domain;
  return norm(typeof d === "string" ? d : "");
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: build.py compute() 를 한 줄씩 대응시켜 옮겼다 — 쪼개면 파이썬과 나란히 대조하기 어려워진다
export function computeClientReport(
  cfg: ClientReportConfig,
  audit: ClientReportAudit
): ClientReportComputed {
  const rows = audit.result.engineResponses.filter((r) =>
    isEngineId(r.engineId)
  );
  const labels = cfg.labels;
  if (rows.length !== labels.length) {
    throw new Error(`답변 ${rows.length}건인데 판별 ${labels.length}건`);
  }

  // 질문 인덱스: 엔진 순서가 한 바퀴 돌 때마다 다음 질문
  const answers: ReportAnswer[] = [];
  let q = 0;
  let seen = new Set<string>();
  rows.forEach((r, idx) => {
    const lab = labels[idx];
    const e = r.engineId as EngineId;
    const pt = (r.promptText || "").trim();
    if (pt && cfg.questions.includes(pt)) {
      q = cfg.questions.indexOf(pt); // 저장된 질문 원문이 있으면 그걸로 확정
    } else {
      if (seen.has(e)) {
        // 없으면(구 측정) 엔진 순서로 추정
        q += 1;
        seen = new Set();
      }
      seen.add(e);
    }
    const doms = (r.citedSources || [])
      .map(domainOf)
      .filter((d): d is string => d !== null)
      .filter((d) => d && !d.includes("vertexaisearch") && d !== "google.com");
    answers.push({
      engine: e,
      q,
      label: lab.l,
      who: lab.who,
      quote: lab.q,
      domains: doms,
      official: doms.filter((d) => matchDomain(d, cfg.official_domains)).length,
    });
  });

  const n = answers.length;
  if (n === 0) {
    throw new Error("판별된 답변이 0건입니다"); // 파이썬도 max([]) 에서 멈춘다
  }
  const cnt = countBy(answers, (a) => a.label);
  const ok = answers.filter((a) => a.label === "ok");
  const bad = answers.filter((a) => BAD.has(a.label));

  const engines: ReportEngine[] = [];
  for (const e of ENGINE_ORDER) {
    const mine = answers.filter((a) => a.engine === e);
    if (mine.length === 0) {
      continue;
    }
    const c = countBy(mine, (a) => a.label);
    const cells: Record<string, ReportAnswer> = {};
    for (const a of mine) {
      cells[String(a.q)] = a;
    }
    engines.push({
      id: e,
      name: ENGINE_NAMES[e],
      n: mine.length,
      ok: c("ok"),
      rate: pyRound((100 * c("ok")) / mine.length),
      other: c("other"),
      made: c("made"),
      generic: c("generic"),
      unknown: c("unknown") + c("none"),
      cites: mine.reduce((acc, a) => acc + a.domains.length, 0),
      official: mine.reduce((acc, a) => acc + a.official, 0),
      cells,
    });
  }

  const nq = Math.max(...answers.map((a) => a.q)) + 1;
  const perQ: ReportQuestionStat[] = [];
  for (let i = 0; i < nq; i++) {
    const mine = answers.filter((a) => a.q === i);
    const k = mine.filter((a) => a.label === "ok").length;
    if (i >= cfg.questions.length || i >= cfg.question_short.length) {
      throw new Error(`질문 ${i + 1}번 문구가 config 에 없습니다`);
    }
    if (mine.length === 0) {
      throw new Error(
        `질문 ${i + 1}번 답변이 0건입니다(파이썬은 0으로 나눠 멈춘다)`
      );
    }
    perQ.push({
      i,
      text: cfg.questions[i],
      short: cfg.question_short[i],
      n: mine.length,
      ok: k,
      rate: pyRound((100 * k) / mine.length),
    });
  }

  // 인용 출처 — Map 은 파이썬 Counter 처럼 처음 본 순서를 지킨다(동률 정렬이 이 순서).
  const domCnt = new Map<string, number>();
  const domEng = new Map<string, Set<string>>();
  const domOk = new Map<string, number>();
  for (const a of answers) {
    for (const d of a.domains) {
      domCnt.set(d, (domCnt.get(d) ?? 0) + 1);
      const set = domEng.get(d) ?? new Set<string>();
      set.add(ENGINE_NAMES[a.engine]);
      domEng.set(d, set);
      if (a.label === "ok") {
        domOk.set(d, (domOk.get(d) ?? 0) + 1);
      }
    }
  }
  let totalC = 0;
  for (const k of domCnt.values()) {
    totalC += k;
  }
  const chCnt = new Map<ChannelId, number>();
  for (const [d, k] of domCnt) {
    const ch = channelOf(d, cfg);
    chCnt.set(ch, (chCnt.get(ch) ?? 0) + k);
  }
  const chGet = (c: ChannelId) => chCnt.get(c) ?? 0;
  const channels: ReportChannel[] = CHANNELS.filter(([c]) => chGet(c) > 0)
    .map(([c, nm]) => ({
      id: c,
      name: nm,
      n: chGet(c),
      pct: pyRound((100 * chGet(c)) / totalC, 1),
    }))
    .sort((x, y) => y.n - x.n); // Array.sort 는 안정 정렬 = 파이썬 sort 와 같다

  // Counter.most_common = 개수 내림차순, 동률은 처음 본 순서
  const mostCommon = [...domCnt.entries()].sort((x, y) => y[1] - x[1]);
  const maxk = mostCommon.length > 0 ? mostCommon[0][1] : 1;
  const top: ReportTopDomain[] = mostCommon.slice(0, 10).map(([d, k]) => {
    const ch = channelOf(d, cfg);
    return {
      domain: d,
      n: k,
      w: pyRound((100 * k) / maxk),
      type: CH_NAME[ch],
      ch,
      engines: [...(domEng.get(d) ?? [])].sort(pyCompareStrings).join(", "),
      in_ok: (domOk.get(d) ?? 0) > 0,
    };
  });

  engines.sort(
    (a, b) =>
      b.rate - a.rate ||
      b.n - a.n ||
      ENGINE_ORDER.indexOf(a.id) - ENGINE_ORDER.indexOf(b.id)
  );
  const wrongFaces = new Set(
    answers
      .filter((a) => a.label === "other" || a.label === "made")
      .map((a) => a.who)
  );
  const correctEngines = engines.filter((e) => e.ok).map((e) => e.name);
  const s: ReportStats = {
    n,
    ok_n: ok.length,
    ok_rate: pyRound((100 * ok.length) / n),
    wrong_n: cnt("other") + cnt("made"),
    wrong_rate: pyRound((100 * (cnt("other") + cnt("made"))) / n),
    other_n: cnt("other"),
    made_n: cnt("made"),
    generic_n: cnt("generic"),
    unknown_n: cnt("unknown") + cnt("none"),
    bad_n: bad.length,
    ok_with_official: ok.filter((a) => a.official > 0).length,
    bad_with_official: bad.filter((a) => a.official > 0).length,
    engines_total: engines.length,
    engines_correct: correctEngines.length,
    correct_engine_names: correctEngines.join("·") || "없음",
    cites_total: totalC,
    official_cites: chGet("official"),
    official_pct: totalC ? pyRound((100 * chGet("official")) / totalC, 1) : 0,
    nq,
    faces_n: wrongFaces.size,
    bad_rate: pyRound((100 * bad.length) / n),
  };
  return { answers, engines, per_q: perQ, channels, top, s };
}
