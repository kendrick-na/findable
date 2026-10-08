// biome-ignore-all lint/performance/noImgElement: 인쇄(PDF) 문서라 next/image 의 지연 로딩·srcset 이 오히려 해롭다 — 원본 템플릿처럼 원본 PNG 를 바로 쓴다
// biome-ignore-all lint/correctness/useImageSize: 크기는 CSS(mm 단위)가 정한다 — 원본 템플릿과 같은 방식
// v12 고객 영업 리포트 — A4. 원본 = `_v12_v4_minimal/fix/template.html`(Jinja) 11쪽.
//
// 2026-10-06 개정(대표 승인 「다 개선한 걸 보고 싶다」): 처음 보는 사람도 바로 이해하도록 다시 짰다.
// - 쪽 구성: 이유+목차 합침 · 플레이북+20일 계획 합침 · 신규 3쪽(카테고리 점유율·주제별 1~3위·매출 기회)
//   → 신규 쪽은 **발행본에 그 데이터가 있을 때만** 나온다(없는 숫자를 채우지 않는다). 쪽 번호는 실제 쪽 수로 매긴다.
// - 쪽마다 주인공 숫자 1개 · AI 순서 고정(ChatGPT→Claude→Perplexity→Gemini) · 내부 용어(엔진·P0·측정 ID) 숨김
// - 마지막 행동은 「15분 통화」 하나(메일과 같은 말).
// - 기본 CSS(report-v12.css)는 원본에서 기계 변환한 그대로 두고, 바뀐 모양은 report-v12-revise.css 에만 쓴다.
//
// 🔴 원칙(그대로)
// - 숫자는 발행본(Report.data v2)의 저장값만 쓴다(재계산 없음) — PDF 도 이 화면을 인쇄한다.
// - status_note 는 **발송 승인 상태가 정한다**(대표 최종 발송 승인 전이면 무조건 「내부 시안 · 외부 발송 금지」).

import {
  ENGINE_MONO,
  ENGINE_NAMES,
  ENGINE_ORDER,
  type EngineId,
  LABELS,
  type LabelId,
  type ReportAnswer,
} from "@repo/audit/client-report/compute";
import { pyFloatStr, pyRound } from "@repo/audit/client-report/py-compat";
import type { ClientReportDataV2 } from "@repo/audit/client-report/report-data";
import type { ReactNode } from "react";
import { safeInline } from "../client-report/client-report";

/** 이 컴포넌트의 기본 CSS 가 옮겨 온 원본 템플릿 지문. */
export const V12_TEMPLATE_MD5 = "cac3c89ebdc7b4ba1f8d6e46dbe4f3f7";
export const INTERNAL_STATUS_NOTE = "내부 시안 · 외부 발송 금지";
/** 마지막 행동 — 메일 본문의 「15분 통화」와 같은 말이어야 한다. */
export const CALL_CTA = "15분 결과 설명 통화 요청하기";
const CONTACT_EMAIL = "contact@findable.co.kr";

/**
 * 원본 템플릿은 autoescape=False 라 문구 속 `<b>`·`<em>`·`<br>` 가 서식으로 찍힌다.
 * 웹은 DB 값이므로 기존 리포트와 같은 safeInline(허용 태그만)으로 같은 결과를 낸다.
 */
const rich = (html: string | undefined) => ({
  dangerouslySetInnerHTML: { __html: safeInline(plain(html ?? "")) },
});

/**
 * 발행본 문구 속 내부 용어 → 고객이 바로 아는 말(2026-10-06 개정). 저장값은 그대로 두고 화면에서만 바꾼다.
 * 기술 항목은 영문 원어를 괄호로 남겨 개발 담당자에게 그대로 전달할 수 있게 한다.
 */
const PLAIN_TERMS: [RegExp, string][] = [
  [/\bP0\b/g, "이번 주 항목"],
  [/\bP1\b/g, "20일 안 항목"],
  [/\bP2\b/g, "재측정 항목"],
  [/(?<!검색\s?)엔진/g, "AI"],
  [/분모에서/g, "집계에서"],
  [/홈 title·description/g, "홈페이지 제목·설명 (title·description)"],
  [/canonical \(대표 주소\)/g, "대표 주소 지정 (canonical)"],
  [/구조화 데이터 \(JSON-LD\)/g, "AI가 읽는 회사 정보 (JSON-LD)"],
  [
    /robots\.txt · sitemap\.xml/g,
    "검색 로봇 안내·사이트 지도 (robots.txt·sitemap.xml)",
  ],
];
export function plain(text: string): string {
  return PLAIN_TERMS.reduce((t, [re, to]) => t.replace(re, to), text);
}
const A = "/report-assets";
const pad2 = (n: number) => String(n).padStart(2, "0");
const TRAILING_ZERO_RE = /\.0$/;

/** 원 단위 금액 → 「4,235만 원」「72.6억 원」. */
export function krw(won: number): string {
  if (won >= 100_000_000) {
    const eok = won / 100_000_000;
    return `${eok >= 100 ? Math.round(eok).toLocaleString("ko-KR") : eok.toFixed(1).replace(TRAILING_ZERO_RE, "")}억\u00a0원`;
  }
  return `${Math.round(won / 10_000).toLocaleString("ko-KR")}만\u00a0원`;
}

export const REVENUE_LABEL = "AI 추천에서 빠져서 놓치는 매출";

/**
 * 놓치는 매출 = 연매출 × 7% × (1 − 정확 노출률). 저장값 우선, 없으면 측정(bad_n / n)으로 계산.
 * 확인된 연매출(출처 포함)이 없거나 놓치는 매출이 0 이하이면 null — 돈 문장을 통째로 뺀다.
 */
export function missedRevenue(
  r: RevenueOpportunity | undefined,
  s: { bad_n: number; n: number }
) {
  if (!(r && r.annual_revenue > 0 && r.monthly > 0 && r.revenue_source)) {
    return null;
  }
  const aiRoutedAnnual =
    r.ai_routed_annual ?? Math.round((r.annual_revenue * r.ai_share_pct) / 100);
  const stored = typeof r.missed_annual === "number";
  let ratio: number | null = null;
  if (typeof r.miss_pct === "number") {
    ratio = r.miss_pct / 100;
  } else if (s.n > 0) {
    ratio = s.bad_n / s.n;
  }
  let missedAnnual = 0;
  if (stored) {
    missedAnnual = r.missed_annual as number;
  } else if (ratio !== null) {
    missedAnnual = Math.round(aiRoutedAnnual * ratio);
  }
  if (!(missedAnnual > 0)) {
    return null;
  }
  return {
    ...r,
    aiRoutedAnnual,
    /** 근거 목록에 측정 문장을 화면에서 덧붙일지(저장된 근거에 없을 때만). */
    measured: !stored,
    missPct: r.miss_pct ?? Math.round((ratio ?? 0) * 100),
    missedAnnual,
    missedMonthly: r.missed_monthly ?? Math.round(missedAnnual / 12),
  };
}

/** 신규 쪽 ① — 브랜드 이름 없이 묻는 구매 질문에서 누가 추천되나. */
interface CategoryShare {
  answers: number;
  brands: { mentions: number; name: string; pct: number; self?: boolean }[];
  /** 예: "PDRN 앰플 추천해줘" 같은 실제 검색어 기반 질문 */
  examples: string[];
  note?: string;
  questions: number;
}
/** 신규 쪽 ② — 주제별 추천 1~3위. */
interface TopicWinner {
  question: string;
  /** 우리 브랜드 순위. 상위권 밖이면 null. */
  self_rank: number | null;
  top: string[];
  topic: string;
}
/**
 * 신규 쪽 ③ — 놓치는 매출(2026-10-07 대표 확정 공식).
 *   놓치는 매출 = 확인된 연매출 × 7% × (1 − 정확 노출률)
 * 저장값(missed_annual 등)이 있으면 그 값을 쓰고, 없을 때만 화면에서 측정값(bad_n / n)으로 계산한다.
 */
interface RevenueOpportunity {
  /** 연매출 × 7% (원/연). 없으면 annual_revenue × ai_share_pct 로 계산. */
  ai_routed_annual?: number;
  ai_share_pct: number;
  annual_revenue: number;
  /** 근거 목록(출처 문장). */
  basis: string[];
  future?: string;
  /** AI가 정확히 소개하지 못한 비율(%). */
  miss_pct?: number;
  /** 놓치는 매출(원/연). */
  missed_annual?: number;
  /** 놓치는 매출(원/월). */
  missed_monthly?: number;
  monthly: number;
  revenue_source: string;
  /** 보조 시산(검색 경로) — 없으면 안 보인다. */
  support?: { label: string; monthly: number; note: string };
}

interface Cfg {
  audit_id: string;
  brand: string;
  brand_en?: string;
  category_share?: CategoryShare;
  causes: { h: string; p: string }[];
  domain: string;
  headlines?: Record<string, string>;
  insights_accuracy: string[];
  insights_citation: string[];
  insights_matrix: string[];
  issued_at: string;
  measured_at: string;
  official_domains: string[];
  official_keywords: string[];
  playbook: { d: string; h: string; kind?: string; p: string }[];
  poc: { d: string; h: string; p: string }[];
  question_short: string[];
  questions: string[];
  revenue_opportunity?: RevenueOpportunity;
  site_checked_at?: string;
  site_checks: { item: string; note: string; state: "ok" | "warn" | "bad" }[];
  topic_winners?: TopicWinner[];
  why: { h: string; p: string }[];
  [key: string]: unknown;
}

const str = (c: Cfg, key: string): string | undefined =>
  typeof c[key] === "string" && c[key] ? (c[key] as string) : undefined;

const engineRank = (id: string) => {
  const i = ENGINE_ORDER.indexOf(id as EngineId);
  return i === -1 ? ENGINE_ORDER.length : i;
};
/** 모든 쪽에서 AI 순서를 같게(ChatGPT→Claude→Perplexity→Gemini…). */
const byEngine = <T extends { engine?: string; id?: string }>(a: T, b: T) =>
  engineRank(a.engine ?? a.id ?? "") - engineRank(b.engine ?? b.id ?? "");

function Mono({ e }: { e: string }) {
  return <span className="mono">{ENGINE_MONO[e as EngineId]}</span>;
}

function Head({ sec }: { sec: string }) {
  return (
    <div className="hd">
      <img alt="Findable" src={`${A}/Findable.png`} />
      <span className="sec-tag">
        <i />
        {sec}
      </span>
    </div>
  );
}

function Dot() {
  return <span className="dot">.</span>;
}

function Foot({
  c,
  n,
  total,
  stale,
  statusNote,
}: {
  c: Cfg;
  n: number;
  stale: boolean;
  statusNote: string | undefined;
  total: number;
}) {
  return (
    <div className="ft">
      <span>
        Findable AI 검색 진단 · {c.brand} · 측정 {c.measured_at}
        {stale ? " (오래된 측정)" : ""} · {statusNote ?? "고객 전용"}
      </span>
      <span>
        {pad2(n)} / {pad2(total)}
      </span>
    </div>
  );
}

const ST_NAME = { ok: "양호", warn: "보완 필요", bad: "부족" } as const;
const PLAN_GROUPS: [string, string, string][] = [
  ["P0", "이번 주", "바로 고칠 것"],
  ["P1", "20일 안", "외부에 알릴 것"],
  ["P2", "다시 측정", "효과 확인"],
];
/** 출처 막대는 상위 4개 + 기타(색 5개 이하). */
const MAX_CHANNELS = 4;

type PageId =
  | "cover"
  | "intro"
  | "accuracy"
  | "matrix"
  | "share"
  | "topics"
  | "faces"
  | "sources"
  | "revenue"
  | "causes"
  | "plan"
  | "back";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 원본 Jinja 템플릿의 쪽 순서를 한 파일에서 그대로 따라가도록 둔다 — 쪽마다 쪼개면 인쇄본과 나란히 대조하기 어려워진다
export function ClientReportV12({
  data,
  sendApproved,
}: {
  data: ClientReportDataV2;
  /** 대표 최종 발송 승인 여부(판별 검토 승인과 다른 단계). */
  sendApproved: boolean;
}) {
  const c = data.config as unknown as Cfg;
  const { s, answers, per_q, channels, top } = data.computed;
  const engines = [...data.computed.engines].sort(byEngine);
  const H = c.headlines ?? {};
  const stale = c.stale === true;
  // 발송 승인 전: 무조건 내부 시안. 승인 후: 원본 템플릿 기본값(status_note 없음)과 같게.
  const statusNote = sendApproved ? undefined : INTERNAL_STATUS_NOTE;
  const officialPct = s.cites_total ? pyFloatStr(s.official_pct) : "0";
  const noteBase = `측정 ${c.measured_at} · 브랜드 이름을 넣은 질문 ${s.nq}개(한국어·영어) × AI ${s.engines_total}곳 = 답변 ${s.n}건 · 질문마다 1번씩 물어봤습니다(물을 때마다 답이 조금 달라질 수 있음). 답변은 사람이 한 건씩 읽고 공식 사이트 내용과 비교해 분류했습니다. ${str(c, "excluded_note") ?? ""}`;

  const share = c.category_share?.brands?.length ? c.category_share : null;
  const topics = c.topic_winners?.length ? c.topic_winners : null;
  const revenue = missedRevenue(c.revenue_opportunity, s);

  const order: PageId[] = [
    "cover",
    "intro",
    "accuracy",
    "matrix",
    ...(share ? (["share"] as const) : []),
    ...(topics ? (["topics"] as const) : []),
    "faces",
    "sources",
    ...(revenue ? (["revenue"] as const) : []),
    "causes",
    "plan",
    "back",
  ];
  const TOTAL = order.length;
  const no = (id: PageId) => order.indexOf(id) + 1;
  const foot = (id: PageId) => (
    <Foot
      c={c}
      n={no(id)}
      stale={stale}
      statusNote={statusNote}
      total={TOTAL}
    />
  );

  const titles: Partial<Record<PageId, string>> = {
    accuracy: `AI는 ${c.brand}를 정확히 알고 있을까`,
    matrix: "질문별·AI별 답변 결과",
    share: "이름 없이 물으면 누가 추천될까",
    topics: "주제별로 누가 1위일까",
    faces: `AI가 그리는 ${c.brand}의 모습`,
    sources: "AI가 참고하는 출처",
    revenue: REVENUE_LABEL,
    causes: "왜 이런 결과가 나왔을까",
    plan: "무엇부터 고치면 될까",
  };
  const toc = order
    .filter((id) => titles[id])
    .map((id) => [titles[id] as string, no(id)] as const);

  const coverEngines = Array.isArray(c.cover_engines)
    ? [...(c.cover_engines as string[])].sort((a, b) =>
        byEngine({ id: a }, { id: b })
      )
    : ["chatgpt", "claude", "perplexity", "gemini"];
  const picks: ReportAnswer[] = [];
  for (const e of coverEngines) {
    for (const a of answers) {
      if (a.engine === e && a.q === 0) {
        picks.push(a);
      }
    }
  }
  const legend = (Object.keys(LABELS) as LabelId[]).filter((k) => k !== "none");
  const lines = (items: string[]): ReactNode =>
    items.map((t) => <div key={t} {...rich(t)} />);

  const mainChannels = channels.slice(0, MAX_CHANNELS);
  const restChannels = channels.slice(MAX_CHANNELS);
  const rest = restChannels.reduce(
    (acc, ch) => ({ n: acc.n + (ch.n ?? 0), pct: acc.pct + ch.pct }),
    { n: 0, pct: 0 }
  );
  const shownChannels = [
    ...mainChannels.map((ch) => ({
      id: ch.id,
      name: ch.name as string,
      n: ch.n as number,
      pct: ch.pct,
    })),
    ...(restChannels.length
      ? [{ id: "etc", name: "기타", n: rest.n, pct: rest.pct }]
      : []),
  ];

  const selfShare = share?.brands.find((b) => b.self);
  const selfRank = share
    ? share.brands.findIndex((b) => b.self) + 1 || null
    : null;
  const selfMentions = selfShare?.mentions ?? 0;
  const shareTop = share?.brands[0];
  const shareThird = share?.brands[2];
  // 순위표만 있으면 「그래서 뭐?」가 남는다 → 저장된 숫자로 바로 계산되는 해석 두 줄을 붙인다(추측 없음).
  const shareInsights: string[] = share
    ? ((c.insights_share as string[] | undefined) ?? [
        `1위 <b>${shareTop?.name}</b>는 답변 ${share.answers}건 중 ${shareTop?.mentions}건에서 추천됐고, ${c.brand}는 ${selfMentions}건이었습니다.`,
        selfRank !== null && selfRank <= 3
          ? `${c.brand}는 3위 안에 들어 있습니다. 1위와의 차이는 추천 <b>${(shareTop?.mentions ?? 0) - selfMentions}건</b>입니다.`
          : `${c.brand}가 3위 안에 들려면 추천이 <b>${(shareThird?.mentions ?? 0) - selfMentions + 1}건</b> 더 필요합니다.`,
      ])
    : [];
  const topicWins = new Map<string, number>();
  for (const t of topics ?? []) {
    if (t.top[0]) {
      topicWins.set(t.top[0], (topicWins.get(t.top[0]) ?? 0) + 1);
    }
  }
  const topicLeader = [...topicWins.entries()].sort((a, b) => b[1] - a[1])[0];
  const topicInsights: string[] = topics
    ? ((c.insights_topics as string[] | undefined) ??
      [
        `${c.brand}가 1위인 주제는 <b>${topics.filter((t) => t.self_rank === 1).length}개</b>, 3위 안에 든 주제는 ${topics.filter((t) => t.self_rank !== null && t.self_rank <= 3).length}개입니다.`,
        topicLeader
          ? `가장 많은 주제에서 1위에 오른 브랜드는 <b>${topicLeader[0]}</b>(${topicLeader[1]}개 주제)입니다.`
          : "",
      ].filter(Boolean))
    : [];

  // 2쪽 「이 리포트를 만든 이유」 — 모든 리포트에 같은 배경(IR 덱 2026-09 실측 사실)을 쓰고, 측정 숫자만 끼운다.
  // 리포트마다 따로 쓰려면 config.why_custom=true.
  const engineNames = engines.map((e) => e.name).join("·");
  const why =
    c.why_custom === true
      ? c.why
      : [
          {
            h: "고객은 이제 검색창 대신 AI에게 묻습니다",
            p: "예전 검색은 백화점 진열대처럼 여러 브랜드를 보여 줬습니다. AI 추천은 직원이 고객 앞에서 <b>브랜드 3개만 골라 주는 것</b>과 같습니다. 그 3개에 들지 못하면 검색 1위여도 <b>추천 목록 밖</b>에 놓입니다.",
          },
          {
            h: "AI는 웹에 있는 근거로만 답합니다",
            p: "AI가 브랜드를 빼먹거나 다른 회사로 착각하는 건 제품이 나빠서가 아니라 <b>인용할 근거가 웹에 없기 때문</b>입니다. 특히 한국어는 AI 답변의 바탕이 되는 공개 웹 데이터의 <b>0.84%</b>뿐이라(Common Crawl 기준), 한국 브랜드일수록 근거가 부족합니다.",
          },
          {
            h: `그래서 AI가 ${c.brand}를 어떻게 말하는지 직접 물어봤습니다`,
            p: `${engineNames} <b>AI ${s.engines_total}곳</b>에 질문 ${s.nq}개를 묻고, 돌아온 <b>답변 ${s.n}건을 한 건씩 읽어</b> 정확한지, 다른 회사로 착각했는지, 어떤 출처를 근거로 삼았는지 확인했습니다. AI 답변은 물을 때마다 달라지기 때문에(같은 질문을 3번 물어 추천 목록이 똑같았던 경우는 36개 중 4개), 마지막 장의 계획대로 <b>같은 조건으로 다시 측정</b>해 변화를 확인합니다.`,
          },
        ];

  const categoryQuestions = Array.isArray(c.category_questions)
    ? (c.category_questions as string[])
    : [];
  const questionList = categoryQuestions.length ? (
    <>
      <h3 className="sq">
        물어본 구매 질문 전체
        <span className="sub">
          실제 검색어(네이버·구글 검색량)에서 고른 질문{" "}
          {categoryQuestions.length}개
        </span>
      </h3>
      <ol className="qall">
        {categoryQuestions.map((q) => (
          <li key={q}>“{q}”</li>
        ))}
      </ol>
    </>
  ) : null;

  // 표지 결론은 「10번 중 몇 번」으로 바로 읽히게(16건 중 11건 → 10번 중 7번). 반올림은 표지 문장에만 쓰고 숫자 칸은 원래 값.
  const wrongOf10 = s.n ? Math.round((s.bad_n / s.n) * 10) : 0;
  const bestEngine = engines.reduce<(typeof engines)[number] | null>(
    (best, e) => (best === null || e.rate > best.rate ? e : best),
    null
  );

  return (
    <>
      {/* 01 표지 */}
      <section className="page cover rv">
        <img alt="" className="fbig" src={`${A}/F_cream.png`} />
        <img alt="Findable" className="logo" src={`${A}/Findable.png`} />
        <div className="kick">
          AI 검색 진단 리포트 · {c.issued_at.slice(0, 4)}
          {statusNote ? <span className="stn">{statusNote}</span> : null}
        </div>
        <h1 {...rich(str(c, "cover_title"))} />
        <div className="csub" {...rich(str(c, "cover_sub"))} />
        <div className="verdict hook">
          <div className="l">한 줄 결론</div>
          <div className="s">
            AI에게 {c.brand}를 물으면{" "}
            <em>
              {wrongOf10 === 0
                ? "대부분 맞는 답"
                : `10번 중 ${wrongOf10}번은 틀린 답`}
            </em>
            이 나옵니다.
          </div>
          {revenue ? (
            <div className="money">
              {REVENUE_LABEL} <b>연 약 {krw(revenue.missedAnnual)}</b>{" "}
              <small>월 약 {krw(revenue.missedMonthly)}</small>
            </div>
          ) : null}
          <div className="nums">
            {revenue ? (
              <div>
                <b className="hot">
                  연 {krw(revenue.missedAnnual).replace("\u00a0원", "")}
                </b>
                {REVENUE_LABEL}(추정)
              </div>
            ) : null}
            <div>
              <b className={revenue ? "" : "hot"}>
                {s.bad_n}/{s.n}
              </b>
              틀리거나 모른다고 한 답변
            </div>
            <div>
              <b>
                {s.engines_correct}/{s.engines_total}곳
              </b>
              한 번이라도 맞힌 AI
            </div>
          </div>
        </div>
        <div className="answers">
          <div className="ask">
            Q. “<span {...rich(c.questions[0])} />”
          </div>
          {picks.map((a) => (
            <div
              className={`acard ${a.label === "ok" ? "good" : "bad"}`}
              key={`${a.engine}-${a.q}`}
            >
              <div className="eg">
                <Mono e={a.engine} />
                {ENGINE_NAMES[a.engine]}
              </div>
              <div className="qt" {...rich(a.who)} />
              <div className="mk">{a.label === "ok" ? "정확" : "틀림"}</div>
            </div>
          ))}
        </div>
        <div className="cmeta">
          <div>
            진단 대상
            <b>
              {c.brand} · {c.domain}
            </b>
          </div>
          <div>
            측정일
            <b>
              {c.measured_at}
              {stale ? " · 오래된 측정" : ""}
            </b>
          </div>
          <div>
            분석 답변
            <b>
              AI {s.engines_total}곳 · {s.n}건
            </b>
          </div>
        </div>
      </section>

      {/* 02 이유 + 확인 방법 + 목차 */}
      <section className="page rv">
        <Head sec="들어가며" />
        <h1 className="sec">
          이 리포트를 만든 이유
          <Dot />
        </h1>
        <div className="why-grid">
          {why.map((w, i) => (
            <div className="why-item" key={w.h}>
              <div className="n">{i + 1}</div>
              <div>
                <h4 {...rich(w.h)} />
                <p {...rich(w.p)} />
              </div>
            </div>
          ))}
        </div>
        <h3 className="sq">이렇게 확인했습니다</h3>
        <div className="method">
          <div className="k">물어본 AI</div>
          <div className="v eng-list">
            {engines.map((e) => (
              <span key={e.id}>
                <Mono e={e.id} />
                {e.name}
              </span>
            ))}
          </div>
          <div className="k">질문</div>
          <div className="v qlist">
            {c.questions.map((q, i) => (
              <div key={q}>
                <b>Q{i + 1}</b>
                <span {...rich(q)} />
              </div>
            ))}
          </div>
          <div className="k">답변 분류</div>
          <div className="v legend">
            {legend.map((k) => (
              <span className={`lb ${k}`} key={k}>
                {LABELS[k].name}
              </span>
            ))}
          </div>
          <div className="k">조건</div>
          <div className="v">
            {c.measured_at} · 로그인하지 않은 기본 상태 · 질문당 1회 · 비교 답변{" "}
            {s.n}건 (AI {s.engines_total}곳 × 질문 {s.nq}개)
          </div>
        </div>
        <h3 className="sq">목차</h3>
        <div className="toc2">
          {toc.map(([t, p]) => (
            <div className="row" key={t}>
              <span className="pg">{pad2(p)}</span>
              <span className="n">{t}</span>
            </div>
          ))}
        </div>
        {foot("intro")}
      </section>

      {/* 03 정확도 */}
      <section className="page rv">
        <Head sec="정확도" />
        <div className="kicker">{titles.accuracy}?</div>
        <h1 className="sec">
          <span
            {...rich(
              H.p4 ??
                `AI 답변 ${s.n}개 중 ${s.ok_n}개만 ${c.brand}를 정확히 설명했습니다`
            )}
          />
          <Dot />
        </h1>
        <div className="hero">
          <div className="big">
            <div className="v">
              {s.ok_n}
              <small>/ {s.n}건</small>
            </div>
            <div className="t">정확히 설명한 답변</div>
          </div>
          <ul className="facts">
            <li>
              <b>{s.bad_n}건</b>은 정확히 설명하지 못했습니다
              <span>{s.bad_parts}</span>
            </li>
            <li>
              AI {s.engines_total}곳 중 <b>{s.engines_correct}곳</b>만 한 번
              이상 정답을 냈습니다
              <span>{s.correct_engine_names}</span>
            </li>
            <li>
              공식 사이트를 출처로 든 답변은 <b>{s.off_ans}건</b>이었고, 그중{" "}
              {s.ok_with_official}건이 정확했습니다
              <span>함께 나타났다는 뜻이지, 원인이라는 뜻은 아닙니다</span>
            </li>
          </ul>
        </div>
        <h3 className="sq">
          AI별 결과
          <span className="sub">AI마다 같은 질문 {s.nq}개</span>
        </h3>
        <table className="tbl">
          <tbody>
            <tr>
              <th>AI</th>
              <th style={{ width: "40mm" }}>정확히 설명한 비율</th>
              <th className="c">정확 / 질문</th>
              <th className="c">다른 회사로 착각</th>
              <th className="c">없는 내용</th>
              <th className="c">일반 단어로 이해</th>
              <th className="c">모름</th>
              <th className="r">공식 사이트 인용</th>
            </tr>
            {/* biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 템플릿 표의 칸 조건(0이면 흐리게)을 1:1 로 옮긴 것 */}
            {engines.map((e) => (
              <tr
                className={bestEngine?.id === e.id && e.ok ? "top" : ""}
                key={e.id}
              >
                <td>
                  <span className="eng">
                    <Mono e={e.id} />
                    {e.name}
                  </span>
                </td>
                <td>
                  <div className="bar">
                    <div className="track">
                      {e.rate ? <i style={{ width: `${e.rate}%` }} /> : null}
                    </div>
                    <span className={e.rate ? "" : "zero"}>{e.rate}%</span>
                  </div>
                </td>
                <td className="c">
                  <b className={e.ok ? "" : "zero"}>{e.ok}</b> / {e.n}
                </td>
                <td className={`c ${e.other ? "" : "zero"}`}>{e.other}</td>
                <td className={`c ${e.made ? "" : "zero"}`}>{e.made}</td>
                <td className={`c ${e.generic ? "" : "zero"}`}>{e.generic}</td>
                <td className={`c ${e.unknown ? "" : "zero"}`}>{e.unknown}</td>
                <td className="r">
                  {e.cites ? (
                    <>
                      <b className={e.official ? "" : "zero"}>{e.official}</b> /{" "}
                      {e.cites}건
                    </>
                  ) : (
                    <span className="zero">출처 없음</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ins">{lines(c.insights_accuracy)}</div>
        <div className="notes">
          <span {...rich(noteBase)} />
        </div>
        {foot("accuracy")}
      </section>

      {/* 04 질문별·AI별 */}
      <section className="page rv">
        <Head sec="질문별 결과" />
        <div className="kicker">{titles.matrix}</div>
        <h1 className="sec">
          <span
            {...rich(
              H.p5 ?? "같은 질문에도 AI마다 전혀 다른 회사를 설명합니다"
            )}
          />
          <Dot />
        </h1>
        <table className="tbl mx" style={{ marginTop: "7mm" }}>
          <tbody>
            <tr>
              <th style={{ width: "27mm" }}>AI</th>
              {per_q.map((q) => (
                <th key={q.i}>
                  Q{q.i + 1} <span {...rich(q.short)} />
                </th>
              ))}
            </tr>
            {engines.map((e) => (
              <tr key={e.id}>
                <td>
                  <span className="eng">
                    <Mono e={e.id} />
                    {e.name}
                  </span>
                </td>
                {per_q.map((q) => {
                  const a = e.cells[String(q.i)];
                  return (
                    <td key={q.i}>
                      {a ? (
                        <div className={`cell ${a.label}`}>
                          <span className={`lb ${a.label}`}>
                            {LABELS[a.label].name}
                          </span>
                          <span className="w" {...rich(a.who)} />
                        </div>
                      ) : (
                        <div className="cell na">측정 안 함</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="sq">질문별 정확한 답변</h3>
        <div className="qrow">
          {per_q.map((q) => (
            <div key={q.i}>
              <div className="l">Q{q.i + 1}</div>
              <div className="t" {...rich(q.short)} />
              <div className="v">
                {q.ok}
                <small>/ {q.n}건</small>
              </div>
              <div className="track">
                {q.rate ? <i style={{ width: `${q.rate}%` }} /> : null}
              </div>
            </div>
          ))}
        </div>
        <div className="ins">{lines(c.insights_matrix)}</div>
        <div className="notes">
          질문 원문 —{" "}
          <span
            {...rich(c.questions.map((q, i) => `Q${i + 1} “${q}”`).join(" · "))}
          />
        </div>
        {foot("matrix")}
      </section>

      {/* 신규 — 카테고리 점유율 */}
      {share ? (
        <section className="page rv">
          <Head sec="경쟁 현황" />
          <div className="kicker">{titles.share}?</div>
          <h1 className="sec">
            <span
              {...rich(
                H.share ??
                  (selfShare
                    ? `구매 질문에서 ${c.brand}가 추천된 비율은 ${pyRound(selfShare.pct)}%입니다`
                    : `구매 질문에서 ${c.brand}는 추천되지 않았습니다`)
              )}
            />
            <Dot />
          </h1>
          <div className="deck">
            고객이 브랜드 이름 없이 묻는 질문 {share.questions}개를 AI에 물어,
            답변 {share.answers}건에서 어떤 브랜드가 추천되는지 셌습니다.
          </div>
          <div className="hero">
            <div className="big">
              <div className="v">
                {selfShare ? `${pyRound(selfShare.pct)}` : "0"}
                <small>%</small>
              </div>
              <div className="t">
                {c.brand} 추천 비율
                {selfRank ? ` · ${selfRank}위` : " · 순위 밖"}
              </div>
            </div>
            <ul className="facts">
              <li>
                1위는 <b>{share.brands[0]?.name}</b>(
                {pyRound(share.brands[0]?.pct ?? 0)}%)입니다
              </li>
              <li>
                실제로 물어본 질문 예
                <span>
                  {share.examples
                    .slice(0, 3)
                    .map((q) => `“${q}”`)
                    .join(" · ")}
                </span>
              </li>
            </ul>
          </div>
          <h3 className="sq">
            추천된 브랜드 순위
            <span className="sub">답변 {share.answers}건 중 추천 비율</span>
          </h3>
          <div className="rank">
            {share.brands.slice(0, 8).map((b, i) => (
              <div className={`row ${b.self ? "self" : ""}`} key={b.name}>
                <span className="i">{i + 1}</span>
                <span className="nm">{b.name}</span>
                <div className="track">
                  <i style={{ width: `${Math.min(100, b.pct)}%` }} />
                </div>
                <span className="p">{pyRound(b.pct)}%</span>
              </div>
            ))}
          </div>
          <div className="ins">{lines(shareInsights)}</div>
          {topics ? null : questionList}
          {share.note ? (
            <div className="notes" {...rich(share.note)} />
          ) : (
            <div className="notes">
              추천 비율 = 그 브랜드가 한 번 이상 이름이 나온 답변 수 ÷ 전체 답변
              수. 한 답변에 여러 브랜드가 나올 수 있어 합계는 100%를 넘습니다.
            </div>
          )}
          {foot("share")}
        </section>
      ) : null}

      {/* 신규 — 주제별 1~3위 */}
      {topics ? (
        <section className="page rv">
          <Head sec="주제별 승자" />
          <div className="kicker">{titles.topics}?</div>
          <h1 className="sec">
            <span
              {...rich(
                H.topics ??
                  `${topics.length}개 주제 중 ${c.brand}가 3위 안에 든 주제는 ${topics.filter((t) => t.self_rank !== null && t.self_rank <= 3).length}개입니다`
              )}
            />
            <Dot />
          </h1>
          <table className="tbl topics" style={{ marginTop: "7mm" }}>
            <tbody>
              <tr>
                <th style={{ width: "30mm" }}>주제</th>
                <th>실제 질문</th>
                <th className="c">1위</th>
                <th className="c">2위</th>
                <th className="c">3위</th>
                <th className="c" style={{ width: "22mm" }}>
                  {c.brand}
                </th>
              </tr>
              {topics.map((t) => (
                <tr key={t.topic}>
                  <td className="name">{t.topic}</td>
                  <td className="qcell">“{t.question}”</td>
                  {[0, 1, 2].map((i) => (
                    <td
                      className={`c ${t.top[i] && t.self_rank === i + 1 ? "selfc" : ""}`}
                      key={i}
                    >
                      {t.top[i] ?? "–"}
                    </td>
                  ))}
                  <td className="c">
                    {t.self_rank ? (
                      <b>{t.self_rank}위</b>
                    ) : (
                      <span className="zero">순위 밖</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ins">{lines(topicInsights)}</div>
          {questionList}
          <div className="notes">
            주제마다 실제 검색어에서 고른 질문을 AI 여러 곳에 묻고, 답변에
            추천된 순서와 횟수로 순위를 매겼습니다.
          </div>
          {foot("topics")}
        </section>
      ) : null}

      {/* 브랜드 이미지 */}
      <section className="page rv">
        <Head sec="브랜드 이미지" />
        <div className="kicker">{titles.faces}</div>
        <h1 className="sec">
          <span
            {...rich(
              H.p6 ?? `AI가 만든 ${c.brand}의 모습은 ${s.faces_n}가지입니다`
            )}
          />
          <Dot />
        </h1>
        <div
          className="deck"
          style={{ marginTop: "2mm" }}
          {...rich(
            `${c.question_short[0]}·${c.question_short[1]} 질문에 AI가 설명한 ${c.brand}의 정체입니다.`
          )}
        />
        <div className="faces">
          <div className="real">
            <div className="k">실제 {c.brand}</div>
            <div className="n">
              {c.brand}
              {c.brand_en && c.brand_en !== c.brand ? ` (${c.brand_en})` : ""}
            </div>
            <ul>
              {c.official_keywords.map((k) => (
                <li key={k} {...rich(k)} />
              ))}
            </ul>
            <div className="foot">
              출처: {c.domain} 공식 사이트
              <br />
              {c.site_checked_at || c.measured_at} 확인
            </div>
          </div>
          <div className="flist">
            {answers
              .filter((a) => a.q === 0 || a.q === 1)
              .sort((a, b) => a.q - b.q || byEngine(a, b))
              .map((a) => (
                <div className={`row ${a.label}`} key={`${a.engine}-${a.q}`}>
                  <div className="e">
                    <Mono e={a.engine} />
                    <span>
                      {ENGINE_NAMES[a.engine]}
                      <br />
                      <span className="qtag">
                        Q{a.q + 1} <span {...rich(c.question_short[a.q])} />
                      </span>
                    </span>
                  </div>
                  <div>
                    <div className="who">
                      <span className={`lb ${a.label}`} />
                      <span {...rich(a.who)} />
                    </div>
                    <div className="q" {...rich(a.quote)} />
                  </div>
                </div>
              ))}
          </div>
        </div>
        <div className="notes">
          답변 문장은 원문에서 핵심만 줄여 옮긴 요약입니다. 영어 질문(Q3·Q4)
          결과는 {pad2(no("matrix"))}쪽에 있습니다.
        </div>
        {foot("faces")}
      </section>

      {/* 인용 출처 */}
      <section className="page rv">
        <Head sec="인용 출처" />
        <div className="kicker">{titles.sources}</div>
        <h1 className="sec">
          <span
            {...rich(
              H.p7 ??
                `AI가 근거로 삼은 출처 중 공식 사이트는 ${officialPct}%뿐입니다`
            )}
          />
          <Dot />
        </h1>
        <h3 className="sq">
          출처 종류<span className="sub">인용 {s.cites_total}건</span>
        </h3>
        <div className="stackbar">
          {shownChannels.map((ch) => (
            <div
              className={`ch-${ch.id} ${["wiki", "news", "etc", "bizdb"].includes(ch.id) ? "lt" : ""}`}
              key={ch.id}
              style={{ flex: ch.n }}
            >
              {ch.pct >= 12 ? `${pyRound(ch.pct)}%` : null}
            </div>
          ))}
        </div>
        <div className="ch-legend">
          {shownChannels.map((ch) => (
            <span className={`ch-${ch.id}`} key={ch.id}>
              {ch.name}
              <b>{pyFloatStr(ch.pct)}%</b>
            </span>
          ))}
        </div>
        <div className="vs">
          <div className="g">
            <div className="t">정확한 답변 중 공식 사이트를 인용한 답변</div>
            <div className="v">
              {s.ok_with_official}
              <small>/ {s.ok_n}건</small>
            </div>
          </div>
          <div className="b">
            <div className="t">
              틀리거나 답하지 못한 답변 중 공식 사이트를 인용한 답변
            </div>
            <div className="v">
              {s.bad_with_official}
              <small>/ {s.bad_n}건</small>
            </div>
          </div>
        </div>
        <h3 className="sq">AI가 가장 많이 참고한 사이트</h3>
        <table className="tbl tight">
          <tbody>
            <tr>
              <th className="c" style={{ width: "8mm" }}>
                #
              </th>
              <th>사이트</th>
              <th>종류</th>
              <th style={{ width: "40mm" }}>인용 수</th>
              <th>인용한 AI</th>
              <th className="c">정확한 답변의 근거</th>
            </tr>
            {top.slice(0, 8).map((t, i) => (
              <tr className={t.ch === "official" ? "top" : ""} key={t.domain}>
                <td className="c">{i + 1}</td>
                <td className="name">{t.domain}</td>
                <td>
                  <span className={`tag-ch ${t.ch}`}>{t.type}</span>
                </td>
                <td>
                  <div className="bar">
                    <div className="track">
                      <i
                        className={t.ch === "official" ? "" : "g"}
                        style={{ width: `${t.w}%` }}
                      />
                    </div>
                    <span>{t.n}</span>
                  </div>
                </td>
                <td style={{ fontSize: "8pt", color: "var(--ink2)" }}>
                  {t.engines}
                </td>
                <td className="c">
                  {t.in_ok ? (
                    <span className="lb ok">예</span>
                  ) : (
                    <span className="zero">–</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ins">{lines(c.insights_citation)}</div>
        <div className="notes">
          인용 = 답변이 근거로 표시한 출처 {s.cites_total}건(한 답변에 여러 출처
          가능). 출처 종류는 주소 규칙으로 자동 분류해 일부 틀릴 수 있습니다.
        </div>
        {foot("sources")}
      </section>

      {/* 신규 — 매출 기회 */}
      {revenue ? (
        <section className="page rv">
          <Head sec="매출 기회" />
          <div className="kicker">{titles.revenue}</div>
          <h1 className="sec">
            <span
              {...rich(
                H.revenue ??
                  `${c.brand}가 AI 추천에서 빠져서 놓치는 매출, 연 약 ${krw(revenue.missedAnnual)}`
              )}
            />
            <Dot />
          </h1>
          <div className="hero rev">
            <div className="big">
              <div className="v">
                {krw(revenue.missedAnnual).replace("\u00a0원", "")}
                <small>원 / 연</small>
              </div>
              <div className="t">{REVENUE_LABEL}(추정)</div>
              <div className="m">월 약 {krw(revenue.missedMonthly)}</div>
            </div>
            <div className="formula-rows">
              <div className="formula">
                <div>
                  <span>연매출</span>
                  <b>{krw(revenue.annual_revenue)}</b>
                  <em>{revenue.revenue_source}</em>
                </div>
                <i>×</i>
                <div>
                  <span>AI가 관여하는 구매 비중</span>
                  <b>{revenue.ai_share_pct}%</b>
                </div>
                <i>=</i>
                <div>
                  <span>AI 추천을 거치는 매출</span>
                  <b>연 {krw(revenue.aiRoutedAnnual)}</b>
                </div>
              </div>
              <div className="formula">
                <i>×</i>
                <div>
                  <span>AI가 정확히 소개하지 못한 비율</span>
                  <b>{revenue.missPct}%</b>
                  <em>
                    {revenue.measured
                      ? `AI 답변 ${s.n}건 중 정확 ${s.ok_n}건`
                      : "Findable 측정"}
                  </em>
                </div>
                <i>=</i>
                <div className="res">
                  <span>{REVENUE_LABEL}</span>
                  <b>연 {krw(revenue.missedAnnual)}</b>
                </div>
              </div>
            </div>
          </div>
          <p className="rsub">
            고객이 AI에게 물었을 때, {c.brand} 대신 다른 브랜드가 추천되거나{" "}
            {c.brand}가 잘못 소개된 만큼입니다. (추정)
          </p>
          {revenue.support ? (
            <div className="support">
              <div className="t">{revenue.support.label}</div>
              <div className="v">월 {krw(revenue.support.monthly)}</div>
              <div className="f" {...rich(revenue.support.note)} />
            </div>
          ) : null}
          <h3 className="sq">이 숫자의 근거</h3>
          <ul className="basis">
            {revenue.basis.map((b) => (
              <li key={b} {...rich(b)} />
            ))}
            {revenue.measured ? (
              <li>
                AI가 정확히 소개하지 못한 비율 {revenue.missPct}%: Findable 측정
                — AI 답변 {s.n}건 중 {s.ok_n}건만 {c.brand}를 정확히 설명·추천
              </li>
            ) : null}
          </ul>
          {revenue.future ? (
            <div className="ins one">
              <div {...rich(revenue.future)} />
            </div>
          ) : null}
          <div className="notes">
            추정치입니다. AI가 {c.brand}를 정확히 소개할 때 이 매출을 더 많이
            가져올 수 있다는 뜻이지, 매출 증가를 보장하지 않습니다.
          </div>
          {foot("revenue")}
        </section>
      ) : null}

      {/* 원인 + 사이트 점검 */}
      <section className="page rv">
        <Head sec="원인" />
        <div className="kicker">{titles.causes}</div>
        <h1 className="sec">
          <span
            {...rich(H.p8 ?? `AI가 ${c.brand}를 놓치는 이유는 세 가지입니다`)}
          />
          <Dot />
        </h1>
        <div className="causes">
          {c.causes.map((x, i) => (
            <div className="cause" key={x.h}>
              <div className="n">{i + 1}</div>
              <div>
                <h4 {...rich(x.h)} />
                <p {...rich(x.p)} />
              </div>
            </div>
          ))}
        </div>
        <h3 className="sq">
          홈페이지 기본 점검
          <span className="sub">
            {c.site_checked_at || c.measured_at} 확인 · 영문 항목은 개발
            담당자에게 그대로 전달하시면 됩니다
          </span>
        </h3>
        <table className="tbl">
          <tbody>
            <tr>
              <th>점검 항목</th>
              <th style={{ width: "24mm" }}>상태</th>
              <th>확인 내용</th>
            </tr>
            {c.site_checks.map((x) => (
              <tr key={x.item}>
                <td className="name" {...rich(x.item)} />
                <td>
                  <span className={`st ${x.state}`}>{ST_NAME[x.state]}</span>
                </td>
                <td style={{ color: "var(--ink2)" }} {...rich(x.note)} />
              </tr>
            ))}
          </tbody>
        </table>
        <div className="notes">
          홈페이지 기본기를 갖춰도 AI 추천이 보장되지는 않습니다. Google 공식
          안내도 AI 검색 전용 필수 장치는 없고, 검색 기본기와 도움이 되는
          콘텐츠가 핵심이라고 설명합니다.
        </div>
        {foot("causes")}
      </section>

      {/* 개선 계획(플레이북 + 20일 일정) */}
      <section className="page rv">
        <Head sec="개선 계획" />
        <div className="kicker">{titles.plan}</div>
        <h1 className="sec">
          <span
            {...rich(H.p9 ?? "AI가 어디서 읽든 같은 설명을 만나게 하세요")}
          />
          <Dot />
        </h1>
        <div className="plan-cols">
          {PLAN_GROUPS.map(([grp, when, what]) => (
            <div className={`plan-col ${grp}`} key={grp}>
              <div className="ph">
                <b>{when}</b>
                <span>{what}</span>
              </div>
              {c.playbook
                .filter((x) => x.p === grp)
                .map((x, i) => (
                  <div className="plan-item" key={x.h}>
                    <h4>
                      <span className="i">{i + 1}</span>
                      <span {...rich(x.h)} />
                    </h4>
                    <p {...rich(x.d)} />
                  </div>
                ))}
            </div>
          ))}
        </div>
        <h3 className="sq">
          20일 일정
          <span className="sub">
            같은 질문·같은 AI로 다시 측정해 전후를 비교합니다
          </span>
        </h3>
        <div className="tl">
          {c.poc.map((x) => (
            <div key={x.d}>
              <div className="d" {...rich(x.d)} />
              <div className="h" {...rich(x.h)} />
              <div className="p" {...rich(x.p)} />
            </div>
          ))}
        </div>
        <div className="notes">
          변화는 관찰 결과로만 보고하며 매출 효과로 단정하지 않습니다.
        </div>
        {foot("plan")}
      </section>

      {/* 뒷표지 — 행동 1개 */}
      <section className="page back rv">
        <img alt="Findable" className="fb" src={`${A}/F_mark.png`} />
        <div>
          <h2>
            결과가 궁금하시면
            <br />
            15분만 시간을 내 주세요.
          </h2>
          <p>
            AI 답변 원문을 함께 보면서 {c.brand}에 맞는 개선 순서를
            설명드리겠습니다.
            <br />
            받으신 메일에 회신하시거나 아래 주소로 연락 주세요.
          </p>
          <a className="url" href={`mailto:${CONTACT_EMAIL}`}>
            {CALL_CTA}
          </a>
          <div className="mail">{CONTACT_EMAIL} · findable.co.kr</div>
        </div>
        <div className="meta">
          <span>
            {c.brand} AI 검색 진단 리포트 · 측정 {c.measured_at} · 발행{" "}
            {c.issued_at}
          </span>
          <span>{statusNote ?? "고객 전용 · 무단 배포 금지"}</span>
        </div>
      </section>
    </>
  );
}
