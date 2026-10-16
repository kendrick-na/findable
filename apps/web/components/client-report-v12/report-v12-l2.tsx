// biome-ignore-all lint/performance/noImgElement: 인쇄(PDF) 문서라 next/image 의 지연 로딩·srcset 이 오히려 해롭다 — 기존 v12 와 같은 방식
// biome-ignore-all lint/correctness/useImageSize: 크기는 CSS(mm 단위)가 정한다
// v12 리포트 레이아웃 v2(2026-10-16 · 대표 승인 「프란츠 1건에 먼저 적용해 보여 줘」).
//
// `config.display.layout_v2 === true` 인 발행본만 이 구성을 쓴다 — 켜지 않은 리포트는 기존 12쪽 그대로.
// 구성(11쪽): 1표지 / 2보는 법·용어 / 3핵심 숫자 / 4이름을 알려 주면 / 5이름 없이 물으면 / 6주제별 1위 /
//             7AI가 그린 모습·출처 / 8빠졌을 수 있는 매출 / 9원인·할 일 / 10측정 방법과 한계 / 11문의
// 원칙: 쪽당 메시지 1개 · 쪽 제목 한 문장(숫자 1개 이내) · 쪽 아래 캡션 1줄 · 상세는 10쪽.
//       🔴 자동 글자 축소(fit1~4)를 쓰지 않는다 — 넘치면 문장을 줄인다. 본문 9pt↑ · 캡션 7pt↑.
// 숫자·사실은 발행본 저장값(computed·copy)에서만 온다. 이 파일은 새 숫자를 만들지 않는다(합계·분수 표기만).

import {
  ENGINE_NAMES,
  LABELS,
  type LabelId,
  type ReportAnswer,
} from "@repo/audit/client-report/compute";
import type { ClientReportDataV2 } from "@repo/audit/client-report/report-data";
import type { ReactNode } from "react";
import {
  A,
  byEngine,
  CALL_CTA_V2,
  type Cfg,
  CONTACT_EMAIL,
  CONTACT_PHONE,
  CTA_V2_HEADLINE,
  Dot,
  Foot,
  Head,
  INTERNAL_STATUS_NOTE,
  iga,
  krw,
  Mono,
  missedRevenue,
  PLAN_GROUPS,
  pad2,
  rich,
  ST_NAME,
} from "./report-v12";

/** 레이아웃 v2 전용 문구(발행본 config.layout_v2). 없는 칸은 저장된 숫자로 만든 기본 문장을 쓴다. */
export interface L2Copy {
  cover?: { main?: string; revenue?: string; sub?: string };
  how?: {
    lede?: string;
    order?: string;
    terms?: { h: string; p: string }[];
    title?: string;
  };
  method?: { sections: { h: string; items: string[] }[]; title?: string };
  numbers?: {
    name_note?: string;
    nameless_note?: string;
    revenue_note?: string;
    title?: string;
  };
  p4?: { caption?: string; insight?: string; title?: string };
  p5?: { caption?: string; insight?: string; title?: string };
  p6?: { caption?: string; title?: string };
  p7?: { caption?: string; title?: string };
  p8?: { basis?: string[]; caption?: string; title?: string };
  p9?: {
    caption?: string;
    causes?: { h: string; p: string }[];
    title?: string;
  };
}

type Share = NonNullable<Cfg["category_share"]>;

interface Ctx {
  answers: ReportAnswer[];
  c: Cfg;
  channels: ClientReportDataV2["computed"]["channels"];
  engines: ClientReportDataV2["computed"]["engines"];
  fractions: boolean;
  L: L2Copy;
  name: string;
  per_q: ClientReportDataV2["computed"]["per_q"];
  revenue: ReturnType<typeof missedRevenue>;
  revenueRange: string | null;
  s: ClientReportDataV2["computed"]["s"];
  selfMentions: number;
  share: Share | null;
  stale: boolean;
  statusNote: string | undefined;
  top: ClientReportDataV2["computed"]["top"];
  topics: NonNullable<Cfg["topic_winners"]> | null;
}

const RANGE_WON_RE = /\s*원$/;
const MAX_RANK_ROWS = 8;
const MAX_TOP_SITES = 5;
/** 카드 값이 이 글자 수를 넘으면(범위 표기 등) 글자를 줄여 카드 안에 넣는다. */
const LONG_KPI_VALUE = 11;
const UNVERIFIED_RE = /확인하지 못|확인되지 않|미확인|확인 필요/;

const asFraction = (k: number, n: number) => `${k}/${n}`;

function shareOf(c: Cfg): Share | null {
  return c.category_share?.brands?.length ? c.category_share : null;
}

function Title({ children }: { children: ReactNode }) {
  return (
    <h1 className="sec l2h">
      {children}
      <Dot />
    </h1>
  );
}

function Caption({ text }: { text: string | undefined }) {
  return text ? <div className="notes l2cap" {...rich(text)} /> : null;
}

// ── 1 표지 ────────────────────────────────────────────────────────────────
function coverMainDefault(x: Ctx): string {
  const { share, selfMentions, name } = x;
  if (share) {
    return `AI에 추천을 물었더니, <b>${name}</b>는 ${share.answers}번 중 <b>${selfMentions}번</b> 나왔습니다`;
  }
  return `AI에게 <b>${name}</b>를 물었더니 ${x.s.n}번 중 <b>${x.s.ok_n}번</b> 맞게 답했습니다`;
}

function coverRevenueDefault(x: Ctx): string | null {
  if (!x.revenue) {
    return null;
  }
  const value = x.revenueRange ?? krw(x.revenue.missedAnnual);
  return `빠졌을 수 있는 매출, 연 약 ${value} (추정)`;
}

function CoverPage({ x }: { x: Ctx }) {
  const { c, L, s, share } = x;
  const revenueLine = L.cover?.revenue ?? coverRevenueDefault(x);
  return (
    <section className="page cover rv l2c">
      <img alt="" className="fbig" src={`${A}/F_cream.png`} />
      <img alt="Findable" className="logo" src={`${A}/Findable.png`} />
      <div className="kick">
        AI 검색 진단 리포트 · {c.issued_at.slice(0, 4)}
        {x.statusNote ? <span className="stn">{x.statusNote}</span> : null}
      </div>
      <h1 className="l2main" {...rich(L.cover?.main ?? coverMainDefault(x))} />
      {L.cover?.sub ? <div className="l2sub" {...rich(L.cover.sub)} /> : null}
      {revenueLine ? <div className="l2rev" {...rich(revenueLine)} /> : null}
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
            {x.stale ? " · 오래된 측정" : ""}
          </b>
        </div>
        <div>
          분석 답변
          {share ? (
            <>
              <b>
                이름 없이 묻는 질문 {share.questions}개 × AI {s.engines_total}곳
                = 답변 {share.answers}건
              </b>
              <span className="sm">이름을 넣은 질문 {s.nq}개는 별도</span>
            </>
          ) : (
            <b>
              질문 {s.nq}개 × AI {s.engines_total}곳 = 답변 {s.n}건
            </b>
          )}
        </div>
      </div>
    </section>
  );
}

// ── 2 보는 법과 용어 ───────────────────────────────────────────────────────
const DEFAULT_TERMS = [
  {
    h: "이름 없는 질문",
    p: "고객이 브랜드 이름 없이 AI에 묻는 질문입니다. 예: “민감성 피부 크림 추천해줘”",
  },
  {
    h: "다른 회사로 착각",
    p: "AI가 이름이 같거나 비슷한 다른 회사·브랜드를 설명한 답변입니다.",
  },
  {
    h: "확인 못 함",
    p: "공식 사이트로 맞는지 확인하지 못해, 맞다고도 틀리다고도 하지 않은 내용입니다.",
  },
];

function QuestionKinds({ x }: { x: Ctx }) {
  const { c, s, share } = x;
  return (
    <div className="l2kinds">
      <div>
        <div className="k">이름을 알려 주고 묻는 질문</div>
        <div className="v">
          질문 {s.nq}개 × AI {s.engines_total}곳 = 답변 {s.n}건
        </div>
        <div className="q" {...rich(`예: “${c.questions[0] ?? ""}”`)} />
      </div>
      {share ? (
        <div>
          <div className="k">이름 없이 묻는 질문</div>
          <div className="v">
            질문 {share.questions}개 × AI {s.engines_total}곳 = 답변{" "}
            {share.answers}건
          </div>
          <div className="q" {...rich(`예: “${share.examples[0] ?? ""}”`)} />
        </div>
      ) : null}
    </div>
  );
}

function HowPage({
  x,
  n,
  total,
  pageNo,
}: {
  x: Ctx;
  n: number;
  total: number;
  pageNo: (id: string) => number;
}) {
  const { c, L } = x;
  const terms = L.how?.terms ?? DEFAULT_TERMS;
  const order =
    L.how?.order ??
    `${pad2(pageNo("numbers"))}쪽 핵심 숫자 → ${pad2(pageNo("known"))}쪽 이름을 알려 주면 → ${x.share ? `${pad2(pageNo("nameless"))}쪽 이름 없이 물으면 → ` : ""}${x.revenue ? `${pad2(pageNo("revenue"))}쪽 매출 → ` : ""}${pad2(pageNo("action"))}쪽 할 일`;
  return (
    <section className="page rv l2 l2how">
      <Head sec="보는 법" />
      <div className="kicker">이 리포트 보는 법</div>
      <Title>
        <span {...rich(L.how?.title ?? "용어 세 가지만 알면 쉽게 읽힙니다")} />
      </Title>
      {L.how?.lede ? (
        <div className="deck l2deck" {...rich(L.how.lede)} />
      ) : null}
      <QuestionKinds x={x} />
      <h3 className="sq">알아 두면 좋은 말 세 가지</h3>
      <div className="l2terms">
        {terms.map((t) => (
          <div key={t.h}>
            <b {...rich(t.h)} />
            <p {...rich(t.p)} />
          </div>
        ))}
      </div>
      <h3 className="sq">읽는 순서</h3>
      <div className="l2order" {...rich(order)} />
      <Foot
        c={c}
        n={n}
        stale={x.stale}
        statusNote={x.statusNote}
        total={total}
      />
    </section>
  );
}

// ── 3 핵심 숫자 ────────────────────────────────────────────────────────────
function Kpi({
  label,
  value,
  note,
  basis,
  hot,
}: {
  basis?: string;
  hot?: boolean;
  label: string;
  note: string | undefined;
  value: string;
}) {
  return (
    <div className="l2kpi">
      <div className="k">{label}</div>
      <div
        className={[
          "v",
          hot ? "hot" : "",
          value.length > LONG_KPI_VALUE ? "long" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </div>
      {note ? <div className="n" {...rich(note)} /> : null}
      {basis ? <div className="b">{basis}</div> : null}
    </div>
  );
}

function EngineCards({ x }: { x: Ctx }) {
  const rows = x.answers.filter((a) => a.q === 0).sort(byEngine);
  return (
    <div className="l2eng">
      {rows.map((a) => (
        <div className={`row ${a.label}`} key={a.engine}>
          <span className="e">
            <Mono e={a.engine} />
            {ENGINE_NAMES[a.engine]}
          </span>
          <span className="w" {...rich(a.who)} />
          <span className={`lb ${a.label}`}>
            {LABELS[a.label as LabelId].name}
          </span>
        </div>
      ))}
    </div>
  );
}

function NumbersPage({ x, n, total }: { x: Ctx; n: number; total: number }) {
  const { c, L, s, share, revenue } = x;
  const nm = L.numbers;
  return (
    <section className="page rv l2">
      <Head sec="핵심 숫자" />
      <div className="kicker">핵심 숫자</div>
      <Title>
        <span {...rich(nm?.title ?? "핵심 숫자는 세 가지입니다")} />
      </Title>
      <div className="l2kpis">
        <Kpi
          basis={`질문 ${s.nq}개 × AI ${s.engines_total}곳 = 답변 ${s.n}건`}
          label="이름을 알려 줬을 때"
          note={nm?.name_note}
          value={asFraction(s.ok_n, s.n)}
        />
        {share ? (
          <Kpi
            basis={`질문 ${share.questions}개 × AI ${s.engines_total}곳 = 답변 ${share.answers}건`}
            hot
            label="이름 없이 물으면"
            note={nm?.nameless_note}
            value={asFraction(x.selfMentions, share.answers)}
          />
        ) : null}
        {revenue ? (
          <Kpi
            label="빠졌을 수 있는 매출(추정)"
            note={nm?.revenue_note}
            value={`연 약 ${x.revenueRange?.replace(RANGE_WON_RE, "") ?? krw(revenue.missedAnnual).replace(" 원", "")}`}
          />
        ) : null}
      </div>
      <h3 className="sq">
        이름을 알려 줬을 때
        <span className="sub">
          “{c.question_short[0]}” 질문에 AI 4곳이 답한 내용
        </span>
      </h3>
      <EngineCards x={x} />
      <Foot
        c={c}
        n={n}
        stale={x.stale}
        statusNote={x.statusNote}
        total={total}
      />
    </section>
  );
}

// ── 4 이름을 알려 주면 ──────────────────────────────────────────────────────
function EngineTable({ x }: { x: Ctx }) {
  return (
    <table className="tbl l2tbl">
      <tbody>
        <tr>
          <th>AI</th>
          <th style={{ width: "42mm" }}>정확히 설명한 답변</th>
          <th className="c">다른 회사로 착각</th>
          <th className="c">근거 없는 설명</th>
          <th className="c">일반 단어로 해석</th>
          <th className="c">모른다고 답함</th>
        </tr>
        {x.engines.map((e) => (
          <tr key={e.id}>
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
                <span className={e.ok ? "" : "zero"}>
                  {asFraction(e.ok, e.n)}
                </span>
              </div>
            </td>
            {(
              [
                ["other", e.other],
                ["made", e.made],
                ["generic", e.generic],
                ["unknown", e.unknown],
              ] as const
            ).map(([kind, v]) => (
              <td className="c" key={`${e.id}-${kind}`}>
                <b className={v ? "" : "zero"}>{v}</b>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QuestionMatrix({ x }: { x: Ctx }) {
  return (
    <table className="tbl l2tbl l2matrix">
      <tbody>
        <tr>
          <th>질문</th>
          {x.engines.map((e) => (
            <th className="c" key={e.id}>
              {e.name}
            </th>
          ))}
        </tr>
        {x.per_q.map((q) => (
          <tr key={q.i}>
            <td className="qcell">
              Q{q.i + 1} <span {...rich(x.c.question_short[q.i])} />
            </td>
            {x.engines.map((e) => {
              const a = e.cells[String(q.i)];
              return (
                <td className="c" key={`${q.i}-${e.id}`}>
                  {a ? (
                    <span className={`lb ${a.label}`}>
                      {LABELS[a.label as LabelId].name}
                    </span>
                  ) : (
                    <span className="zero">–</span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KnownPage({ x, n, total }: { x: Ctx; n: number; total: number }) {
  const { c, L, s } = x;
  const insight =
    L.p4?.insight ?? (c.insights_matrix ?? []).slice(0, 1).join(" ");
  return (
    <section className="page rv l2">
      <Head sec="이름을 알려 주면" />
      <div className="kicker">이름을 알려 주고 물었을 때</div>
      <Title>
        <span
          {...rich(
            L.p4?.title ??
              `이름을 알려 주고 물으면 ${s.n}번 중 ${s.ok_n}번은 맞게 답했습니다`
          )}
        />
      </Title>
      <EngineTable x={x} />
      <h3 className="sq">질문별 결과</h3>
      <QuestionMatrix x={x} />
      {insight ? <div className="l2insight" {...rich(insight)} /> : null}
      <Caption text={L.p4?.caption} />
      <Foot
        c={c}
        n={n}
        stale={x.stale}
        statusNote={x.statusNote}
        total={total}
      />
    </section>
  );
}

// ── 5 이름 없이 물으면 ─────────────────────────────────────────────────────
function NamelessPage({ x, n, total }: { x: Ctx; n: number; total: number }) {
  const { c, L, share } = x;
  if (!share) {
    return null;
  }
  const rows = share.brands.slice(0, MAX_RANK_ROWS);
  const insight =
    L.p5?.insight ??
    (c.insights_share as string[] | undefined)?.slice(0, 1).join(" ");
  return (
    <section className="page rv l2">
      <Head sec="이름 없이 물으면" />
      <div className="kicker">이름 없이 물으면</div>
      <Title>
        <span
          {...rich(
            L.p5?.title ??
              `이름 없이 물은 ${share.answers}번 중 ${iga(c.brand)} 나온 것은 ${x.selfMentions}번입니다`
          )}
        />
      </Title>
      <div className="hero">
        <div className="big">
          <div className="v">
            {x.selfMentions}
            <small>/ {share.answers}건</small>
          </div>
          <div className="t">{iga(c.brand)} 나온 답변</div>
        </div>
      </div>
      <h3 className="sq">
        추천에 나온 브랜드
        <span className="sub">답변 {share.answers}건 중 나온 횟수</span>
      </h3>
      <div className="rank">
        {rows.map((b, i) => (
          <div className={`row ${b.self ? "self" : ""}`} key={b.name}>
            <span className="i">{i + 1}</span>
            <span className="nm">{b.name}</span>
            <div className="track">
              <i
                style={{
                  width: `${Math.min(100, (b.mentions / (rows[0]?.mentions || 1)) * 100)}%`,
                }}
              />
            </div>
            <span className="p">{asFraction(b.mentions, share.answers)}</span>
          </div>
        ))}
      </div>
      {insight ? <div className="l2insight" {...rich(insight)} /> : null}
      <Caption text={L.p5?.caption} />
      <Foot
        c={c}
        n={n}
        stale={x.stale}
        statusNote={x.statusNote}
        total={total}
      />
    </section>
  );
}

// ── 6 주제별 1위 ───────────────────────────────────────────────────────────
const WIDE_TOPICS = 10;

function TopicsPage({ x, n, total }: { x: Ctx; n: number; total: number }) {
  const { c, L, topics } = x;
  if (!topics) {
    return null;
  }
  const wide = topics.length <= WIDE_TOPICS;
  return (
    <section className="page rv l2">
      <Head sec="주제별 1위" />
      <div className="kicker">주제별로 누가 1위일까</div>
      <Title>
        <span
          {...rich(
            L.p6?.title ??
              `질문 주제 ${topics.length}개에서 ${iga(c.brand)} 3위 안에 든 주제는 ${topics.filter((t) => t.self_rank !== null && t.self_rank <= 3).length}개입니다`
          )}
        />
      </Title>
      <table
        className={[
          "tbl",
          "l2tbl",
          "l2topics",
          topics.length > 12 ? "dense" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <tbody>
          <tr>
            <th style={{ width: "34mm" }}>주제</th>
            {wide ? <th>실제 질문</th> : null}
            <th className="c">1위</th>
            <th className="c">2위</th>
            <th className="c">3위</th>
            <th className="c">{c.brand} 순위</th>
          </tr>
          {topics.map((t) => (
            <tr key={t.topic}>
              <td className="name">{t.topic}</td>
              {wide ? (
                <td className="qcell" {...rich(`“${t.question}”`)} />
              ) : null}
              {[0, 1, 2].map((i) => (
                <td className="c" key={`${t.topic}-${i}`}>
                  {t.top[i] ?? <span className="zero">–</span>}
                </td>
              ))}
              <td className={t.self_rank ? "c selfc" : "c"}>
                {t.self_rank ? (
                  `${t.self_rank}위`
                ) : (
                  <span className="zero">순위 밖</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Caption
        text={
          wide || L.p6?.caption?.includes("10쪽")
            ? L.p6?.caption
            : `${L.p6?.caption ?? ""} 실제 질문은 10쪽 질문 목록을 보세요.`.trim()
        }
      />
      <Foot
        c={c}
        n={n}
        stale={x.stale}
        statusNote={x.statusNote}
        total={total}
      />
    </section>
  );
}

// ── 7 AI가 그린 모습과 출처 ─────────────────────────────────────────────────
function FacesBlock({ x }: { x: Ctx }) {
  const { c } = x;
  const rows = x.answers.filter((a) => a.q === 0).sort(byEngine);
  return (
    <div className="l2faces">
      <div className="l2real">
        <div className="k">실제 {c.brand}</div>
        <ul>
          {c.official_keywords.slice(0, 4).map((k) => (
            <li key={k} {...rich(k)} />
          ))}
        </ul>
      </div>
      <div className="l2flist">
        {rows.map((a) => (
          <div className="l2frow" key={a.engine}>
            <span className="e">
              <Mono e={a.engine} />
              {ENGINE_NAMES[a.engine]}
            </span>
            <span className="l2q" {...rich(a.who)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function SourcesBlock({ x }: { x: Ctx }) {
  const { s, top } = x;
  const official = x.channels.find((ch) => ch.id === "official")?.n ?? 0;
  return (
    <>
      <h3 className="sq">
        AI가 참고한 출처
        <span className="sub">
          전체 인용 {s.cites_total}건 중 공식 사이트 {official}건
        </span>
      </h3>
      <table className="tbl l2tbl tight">
        <tbody>
          <tr>
            <th>사이트</th>
            <th>종류</th>
            <th className="c">인용 수</th>
            <th>인용한 AI</th>
          </tr>
          {top.slice(0, MAX_TOP_SITES).map((t) => (
            <tr className={t.ch === "official" ? "top" : ""} key={t.domain}>
              <td className="name">{t.domain}</td>
              <td>
                <span className={`tag-ch ${t.ch}`}>{t.type}</span>
              </td>
              <td className="c">{t.n}</td>
              <td className="eng-list">{t.engines}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function FacesPage({ x, n, total }: { x: Ctx; n: number; total: number }) {
  const { c, L } = x;
  return (
    <section className="page rv l2">
      <Head sec="AI가 그린 모습" />
      <div className="kicker">AI가 그린 모습과 읽은 출처</div>
      <Title>
        <span
          {...rich(L.p7?.title ?? `AI는 ${c.brand}를 이렇게 설명했습니다`)}
        />
      </Title>
      <FacesBlock x={x} />
      <SourcesBlock x={x} />
      <Caption text={L.p7?.caption} />
      <Foot
        c={c}
        n={n}
        stale={x.stale}
        statusNote={x.statusNote}
        total={total}
      />
    </section>
  );
}

// ── 8 빠졌을 수 있는 매출 ──────────────────────────────────────────────────
function FormulaRows({ x }: { x: Ctx }) {
  const { revenue } = x;
  if (!revenue) {
    return null;
  }
  const missText =
    typeof revenue.miss_num === "number" &&
    typeof revenue.miss_den === "number" &&
    x.fractions
      ? asFraction(revenue.miss_num, revenue.miss_den)
      : `${revenue.missPct}%`;
  return (
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
          <span>이름 없이 물으면 맞게 나오지 않은 비율</span>
          <b>{missText}</b>
        </div>
        <i>=</i>
        <div className="res">
          <span>빠졌을 수 있는 매출</span>
          <b>연 {x.revenueRange ?? krw(revenue.missedAnnual)}</b>
        </div>
      </div>
    </div>
  );
}

function RevenuePage({ x, n, total }: { x: Ctx; n: number; total: number }) {
  const { c, L, revenue } = x;
  if (!revenue) {
    return null;
  }
  const basis = L.p8?.basis ?? revenue.basis.slice(0, 3);
  // 범위 표기일 때는 월 환산도 범위 문자열(revenue_range_monthly)이 있을 때만 — 하한값만 보이는 것을 막는다.
  const H = c.headlines ?? {};
  const monthlyText = x.revenueRange
    ? (H.revenue_range_monthly ?? null)
    : krw(revenue.missedMonthly);
  return (
    <section className="page rv l2">
      <Head sec="매출 기회" />
      <div className="kicker">빠졌을 수 있는 매출</div>
      <Title>
        <span
          {...rich(
            L.p8?.title ?? `AI 추천에 ${iga(c.brand)} 빠졌을 수 있는 매출`
          )}
        />
      </Title>
      <div className="hero rev">
        <div className="big">
          <div className="v">
            {x.revenueRange
              ? x.revenueRange.replace(RANGE_WON_RE, "")
              : krw(revenue.missedAnnual).replace(" 원", "")}
            <small>원 / 연</small>
          </div>
          <div className="t">빠졌을 수 있는 매출(추정)</div>
          {monthlyText ? <div className="m">월 약 {monthlyText}</div> : null}
        </div>
        <FormulaRows x={x} />
      </div>
      <h3 className="sq">이 숫자의 근거</h3>
      <ul className="basis">
        {basis.map((b) => (
          <li key={b} {...rich(b)} />
        ))}
      </ul>
      <Caption
        text={
          L.p8?.caption ??
          "추정치입니다. AI에 나오게 하면 매출이 늘어난다고 보장하지 않습니다."
        }
      />
      <Foot
        c={c}
        n={n}
        stale={x.stale}
        statusNote={x.statusNote}
        total={total}
      />
    </section>
  );
}

// ── 9 원인과 할 일 ─────────────────────────────────────────────────────────
function SiteChecks({ x }: { x: Ctx }) {
  return (
    <table className="tbl l2tbl tight">
      <tbody>
        <tr>
          <th style={{ width: "46mm" }}>점검 항목</th>
          <th style={{ width: "22mm" }}>상태</th>
          <th>확인 내용</th>
        </tr>
        {x.c.site_checks.map((k) => (
          <tr key={k.item}>
            <td className="name" {...rich(k.item)} />
            <td>
              <span className={`st ${k.state}`}>{ST_NAME[k.state]}</span>
            </td>
            <td className="l2note" {...rich(k.note)} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlanColumns({ x }: { x: Ctx }) {
  return (
    <div className="plan-cols l2plan">
      {PLAN_GROUPS.map(([grp, when, what]) => (
        <div className={`plan-col ${grp}`} key={grp}>
          <div className="ph">
            <b>{when}</b>
            <span>{what}</span>
          </div>
          {x.c.playbook
            .filter(
              (p) =>
                p.p === grp &&
                p.kind !== "한계" &&
                !p.h.startsWith("보장하지 않는")
            )
            .map((p, i) => (
              <div className="plan-item" key={p.h}>
                <h4>
                  <span className="i">{i + 1}</span>
                  <span {...rich(p.h)} />
                </h4>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

function ActionPage({ x, n, total }: { x: Ctx; n: number; total: number }) {
  const { c, L } = x;
  const unverified = c.site_checks.filter((k) =>
    UNVERIFIED_RE.test(k.note)
  ).length;
  return (
    <section className="page rv l2 l2act">
      <Head sec="원인과 할 일" />
      <div className="kicker">확인한 사실과 할 일</div>
      <Title>
        <span {...rich(L.p9?.title ?? "확인한 사실 세 가지와, 먼저 할 일")} />
      </Title>
      <ol className="l2causes">
        {(L.p9?.causes ?? c.causes.map((k) => ({ h: k.h, p: "" }))).map((k) => (
          <li key={k.h}>
            <b {...rich(k.h)} />
            {k.p ? <p {...rich(k.p)} /> : null}
          </li>
        ))}
      </ol>
      <h3 className="sq">
        홈페이지 기본 점검
        <span className="sub">
          {c.site_checked_at || c.measured_at} 확인
          {unverified > 0
            ? ` · 확인하지 못한 항목 ${unverified}개는 “확인 못 함”으로 적었습니다`
            : ""}
        </span>
      </h3>
      <SiteChecks x={x} />
      <h3 className="sq">할 일</h3>
      <PlanColumns x={x} />
      <div className="l2poc">
        <b>20일 일정</b>
        {c.poc.map((k) => (
          <span key={k.d}>
            {k.d} <i {...rich(k.h)} />
          </span>
        ))}
      </div>
      <Caption text={L.p9?.caption} />
      <Foot
        c={c}
        n={n}
        stale={x.stale}
        statusNote={x.statusNote}
        total={total}
      />
    </section>
  );
}

// ── 10 측정 방법과 한계 ────────────────────────────────────────────────────
function MethodPage({ x, n, total }: { x: Ctx; n: number; total: number }) {
  const { c, L } = x;
  const sections = L.method?.sections ?? [];
  const questions = (c.category_questions ?? []) as string[];
  return (
    <section className="page rv l2 l2m">
      <Head sec="측정 방법과 한계" />
      <div className="kicker">측정 방법과 한계</div>
      <Title>
        <span {...rich(L.method?.title ?? "이 숫자를 어떻게 만들었는지")} />
      </Title>
      <div className="l2method">
        {sections.map((sec) => (
          <div key={sec.h}>
            <h4>{sec.h}</h4>
            <ul>
              {sec.items.map((it) => (
                <li key={it} {...rich(it)} />
              ))}
            </ul>
          </div>
        ))}
      </div>
      {questions.length > 0 ? (
        <>
          <h4 className="l2qh">
            이름 없이 물은 질문 전체({questions.length}개)
          </h4>
          <ol className="l2qall">
            {questions.map((q) => (
              <li key={q} {...rich(q)} />
            ))}
          </ol>
        </>
      ) : null}
      <Foot
        c={c}
        n={n}
        stale={x.stale}
        statusNote={x.statusNote}
        total={total}
      />
    </section>
  );
}

// ── 11 문의 ────────────────────────────────────────────────────────────────
function ClosingPage({ x }: { x: Ctx }) {
  const { c } = x;
  return (
    <section className="page back rv">
      <img alt="Findable" className="fb" src={`${A}/F_mark.png`} />
      <div>
        <h2>{CTA_V2_HEADLINE}</h2>
        <p>
          AI 답변 원문을 함께 보면서 {c.brand}에 맞는 개선 순서를
          설명드리겠습니다.
          <br />
          받으신 메일에 회신하시거나 아래 주소로 연락 주세요.
        </p>
        <a className="url" href={`mailto:${CONTACT_EMAIL}`}>
          {CALL_CTA_V2}
        </a>
        <div className="mail">
          {CONTACT_EMAIL} · {CONTACT_PHONE}
        </div>
      </div>
      <div className="meta">
        <span>
          {c.brand} AI 검색 진단 리포트 · 측정 {c.measured_at} · 발행{" "}
          {c.issued_at}
        </span>
        <span>{x.statusNote ?? "고객 전용 · 무단 배포 금지"}</span>
      </div>
    </section>
  );
}

// ── 조립 ────────────────────────────────────────────────────────────────────
type PageId =
  | "cover"
  | "how"
  | "numbers"
  | "known"
  | "nameless"
  | "topics"
  | "faces"
  | "revenue"
  | "action"
  | "method"
  | "closing";

function buildCtx(data: ClientReportDataV2, sendApproved: boolean): Ctx {
  const c = data.config as unknown as Cfg;
  const { s, answers, per_q, channels, top } = data.computed;
  const H = c.headlines ?? {};
  const share = shareOf(c);
  const revenue = missedRevenue(c.revenue_opportunity, s);
  const layout = (c as unknown as { layout_v2?: L2Copy }).layout_v2 ?? {};
  return {
    answers,
    c,
    channels,
    engines: [...data.computed.engines].sort(byEngine),
    fractions: c.display?.fractions === true,
    L: layout,
    name: c.brand,
    per_q,
    revenue,
    revenueRange: revenue ? (H.revenue_range ?? null) : null,
    s,
    selfMentions: share?.brands.find((b) => b.self)?.mentions ?? 0,
    share,
    stale: c.stale === true,
    statusNote: sendApproved ? undefined : INTERNAL_STATUS_NOTE,
    top,
    topics: c.topic_winners?.length ? c.topic_winners : null,
  };
}

function pageOrder(x: Ctx): PageId[] {
  return [
    "cover",
    "how",
    "numbers",
    "known",
    ...(x.share ? (["nameless"] as const) : []),
    ...(x.topics ? (["topics"] as const) : []),
    "faces",
    ...(x.revenue ? (["revenue"] as const) : []),
    "action",
    "method",
    "closing",
  ];
}

export function ClientReportV12L2({
  data,
  sendApproved,
}: {
  data: ClientReportDataV2;
  sendApproved: boolean;
}) {
  const x = buildCtx(data, sendApproved);
  const order = pageOrder(x);
  const total = order.length;
  const pageNo = (id: string) => order.indexOf(id as PageId) + 1;
  const common = (id: PageId) => ({ n: pageNo(id), total, x });
  return (
    <>
      {order.map((id) => {
        switch (id) {
          case "cover":
            return <CoverPage key={id} x={x} />;
          case "how":
            return <HowPage key={id} pageNo={pageNo} {...common(id)} />;
          case "numbers":
            return <NumbersPage key={id} {...common(id)} />;
          case "known":
            return <KnownPage key={id} {...common(id)} />;
          case "nameless":
            return <NamelessPage key={id} {...common(id)} />;
          case "topics":
            return <TopicsPage key={id} {...common(id)} />;
          case "faces":
            return <FacesPage key={id} {...common(id)} />;
          case "revenue":
            return <RevenuePage key={id} {...common(id)} />;
          case "action":
            return <ActionPage key={id} {...common(id)} />;
          case "method":
            return <MethodPage key={id} {...common(id)} />;
          default:
            return <ClosingPage key={id} x={x} />;
        }
      })}
    </>
  );
}
