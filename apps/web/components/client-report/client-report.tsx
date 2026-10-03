// biome-ignore-all lint/performance/noImgElement: 인쇄(PDF) 문서라 next/image 의 지연 로딩·srcset 이 오히려 해롭다 — 원본 템플릿처럼 원본 PNG 를 바로 쓴다
// biome-ignore-all lint/correctness/useImageSize: 크기는 CSS(mm 단위)가 정한다 — 원본 템플릿과 같은 방식
// 고객 GEO 진단 리포트 — A4 11쪽. 웹 화면과 PDF 가 **이 컴포넌트 하나**를 쓴다.
//
// 🔴 원본 = `Findable_GEO리포트_템플릿/template.html`(Jinja). 쪽 순서·문구·조건을 그대로 옮겼다.
//   문구를 여기서만 바꾸면 템플릿 PDF 와 웹이 달라진다 — 템플릿도 같이 고칠 것.
// 🔴 숫자를 여기서 계산하지 않는다. 전부 import 때 동결된 `data.computed` 에서 읽는다
//   (유일한 예외: 파이썬 템플릿 안에서 하던 표시용 반올림 `ch.pct|round|int`).

import {
  ENGINE_MONO,
  currentEngineDisplayName,
  currentEngineDisplayText,
  type EngineId,
  LABELS,
  type LabelId,
} from "@repo/audit/client-report/compute";
import { pyFloatStr, pyRound } from "@repo/audit/client-report/py-compat";
import { formatOfficialPct } from "@repo/audit/client-report/render-strings";
import type { ClientReportData } from "@repo/audit/client-report/report-data";

const TOTAL = 11;
const ASSET = {
  logo: "/report-assets/Findable.png",
  fCream: "/report-assets/F_cream.png",
  fMark: "/report-assets/F_mark.png",
};

/**
 * config 문구는 운영자가 쓴 짧은 HTML(`<b>`·`<em>`·`<br>`)을 담는다. 템플릿은 그대로 찍지만
 * 여기선 DB 에서 오는 값이라 **허용한 태그만** 살리고 나머지는 글자로 보이게 한다.
 */
const ALLOWED_TAG = /&lt;(\/?)(b|strong|em|i|br)\s*\/?&gt;/g;
export function safeInline(html: string): string {
  return html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(ALLOWED_TAG, "<$1$2>");
}
const rich = (html: string) => ({
  dangerouslySetInnerHTML: { __html: safeInline(html) },
});

const PROTOCOL_RE = /^https?:\/\//;
const pad2 = (n: number) => String(n).padStart(2, "0");

function Mono({ engine }: { readonly engine: EngineId }) {
  return <span className="mono">{ENGINE_MONO[engine]}</span>;
}

function Lb({
  label,
  text,
}: {
  readonly label: LabelId;
  readonly text?: string;
}) {
  return <span className={`lb ${label}`}>{text}</span>;
}

function Head({
  brand,
  sec,
}: {
  readonly brand: string;
  readonly sec?: string;
}) {
  return (
    <div className="hd">
      <img alt="Findable" src={ASSET.logo} />
      {sec ? (
        <span className="sec-tag">
          <i />
          {sec}
        </span>
      ) : (
        <span className="sec-tag">{brand} AI 검색 진단</span>
      )}
    </div>
  );
}

function Foot({
  auditId,
  brand,
  measuredAt,
  n,
}: {
  readonly auditId: string;
  readonly brand: string;
  readonly measuredAt: string;
  readonly n: number;
}) {
  return (
    <div className="ft">
      <span>
        Findable AI 검색 진단 · {brand} · 측정 {measuredAt} · 측정 ID{" "}
        {auditId.slice(0, 8)} · 고객 전용
      </span>
      <span>
        {pad2(n)} / {TOTAL}
      </span>
    </div>
  );
}

export interface ClientReportProps {
  readonly data: ClientReportData;
  readonly legacySyntheticEngineIds?: readonly string[];
  /** 표지에 작게 찍는 웹 리포트 주소(PDF 에서 웹으로 돌아오는 길). */
  readonly webUrl: string | null;
}

export function ClientReport({
  data,
  legacySyntheticEngineIds = [],
  webUrl,
}: ClientReportProps) {
  const c = data.config;
  const { answers, engines, per_q: perQ, channels, top, s } = data.computed;
  const H = c.headlines ?? {};
  const officialPct = formatOfficialPct(s);

  const noteBase = `측정 Findable ${c.measured_at} · 질문 ${s.nq}종(한국어·영어) × AI·검색 엔진 ${s.engines_total}곳 · 유효 답변 ${s.n}건 · 질문당 1회 측정(시점에 따라 답이 달라질 수 있음). 판별: 답변 원문을 사람이 한 건씩 읽고 공식 사이트 내용과 대조.`;

  const picks = (["chatgpt", "claude", "naver", "gemini"] as const).flatMap(
    (e) => answers.filter((a) => a.engine === e && a.q === 0)
  );
  const toc: [string, string, number][] = [
    ["Intro", "이 리포트를 만든 이유", 2],
    ["Section 1", `AI는 ${c.brand}를 정확히 알고 있을까`, 4],
    ["Section 2", "엔진·질문별 답변 결과", 5],
    ["Section 3", `AI가 바라보는 ${c.brand}`, 6],
    ["Section 4", "AI가 인용하는 콘텐츠", 7],
    ["Section 5", "왜 이런 결과가 나왔을까", 8],
    ["Playbook", "바로 실천하는 개선 플레이북", 9],
    ["Next", "20일 개선·재측정 계획", 10],
  ];
  const stateName = { ok: "양호", warn: "보완", bad: "부족" } as const;

  return (
    <>
      {/* 01 표지 */}
      <section className="page cover">
        <img alt="" className="fbig" src={ASSET.fCream} />
        <img alt="Findable" className="logo" src={ASSET.logo} />
        <div className="kick">
          AI 검색 진단 리포트 · {c.issued_at.slice(0, 4)}
        </div>
        <h1 {...rich(c.cover_title)} />
        <div className="csub" {...rich(c.cover_sub)} />
        <div className="verdict">
          <div className="l">한 줄 결론</div>
          <div className="s">
            AI 답변 {s.n}개 중 {s.ok_n}개만 {c.brand}를 정확히 설명했습니다.
          </div>
          <div className="nums">
            <div>
              <b className="hot">{s.ok_rate}%</b>정확 인식률
            </div>
            <div>
              <b>{s.wrong_n}건</b>다른 회사로 설명
            </div>
            <div>
              <b>
                {s.engines_correct}/{s.engines_total}곳
              </b>
              정답을 낸 엔진
            </div>
          </div>
        </div>
        <div className="answers">
          <div className="ask">
            Q. “<span {...rich(c.questions[0])} />”
          </div>
          {picks.map((a, i) => (
            <div
              className={`acard ${a.label === "ok" ? "good" : "bad"}`}
              // biome-ignore lint/suspicious/noArrayIndexKey: 한 엔진이 같은 질문에 답을 여러 건 가질 수 있어 순번이 유일한 식별자다(목록은 동결 데이터라 순서가 바뀌지 않는다)
              key={`${a.engine}-${i}`}
            >
              <div className="eg">
                <Mono engine={a.engine} />
                {currentEngineDisplayName(a.engine, undefined, legacySyntheticEngineIds)}
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
            측정일<b>{c.measured_at}</b>
          </div>
          <div>
            분석 답변
            <b>
              {s.engines_total}개 엔진 · {s.n}건
            </b>
          </div>
        </div>
        {webUrl ? (
          <div className="weblink">
            웹에서 보기 · v{data.version}
            <b>{webUrl.replace(PROTOCOL_RE, "")}</b>
          </div>
        ) : null}
      </section>

      {/* 02 이유 + 방법 */}
      <section className="page">
        <Head brand={c.brand} sec="Intro" />
        <h1 className="sec">
          이 리포트를 만든 이유<span className="dot">.</span>
        </h1>
        <div className="why-grid">
          {c.why.map((w, i) => (
            <div className="why-item" key={w.h}>
              <div className="n">{i + 1}</div>
              <div>
                <h4 {...rich(w.h)} />
                <p {...rich(w.p)} />
              </div>
            </div>
          ))}
        </div>
        <div className="method">
          <div className="k">측정 엔진</div>
          <div className="v eng-list">
            {engines.map((e) => (
              <span key={e.id}>
                <Mono engine={e.id} />
                {currentEngineDisplayName(
                  e.id,
                  e.name,
                  legacySyntheticEngineIds
                )}
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
          <div className="k">판별 기준</div>
          <div className="v legend">
            {(Object.keys(LABELS) as LabelId[])
              .filter((k) => k !== "none")
              .map((k) => (
                <Lb key={k} label={k} text={LABELS[k].name} />
              ))}
          </div>
          <div className="k">측정 조건</div>
          <div className="v">
            {c.measured_at} · 로그인하지 않은 기본 상태 · 질문당 1회 · 유효 답변{" "}
            {s.n}건
          </div>
        </div>
        <Foot
          auditId={c.audit_id}
          brand={c.brand}
          measuredAt={c.measured_at}
          n={2}
        />
      </section>

      {/* 03 목차 */}
      <section className="page">
        <Head brand={c.brand} />
        <div className="kicker" style={{ marginTop: "14mm" }}>
          Contents
        </div>
        <div className="toc-h">
          목차<span className="dot">.</span>
        </div>
        <div className="toc">
          {toc.map(([a, b, p]) => (
            <div className="row" key={a}>
              <span className="s">{a}</span>
              <span className="n">{b}</span>
              <span className="pg">{pad2(p)}</span>
            </div>
          ))}
        </div>
        <Foot
          auditId={c.audit_id}
          brand={c.brand}
          measuredAt={c.measured_at}
          n={3}
        />
      </section>

      {/* 04 섹션1 */}
      <section className="page">
        <Head brand={c.brand} sec="Section 1 · 정확도" />
        <div className="kicker">AI는 {c.brand}를 정확히 알고 있을까?</div>
        <h1 className="sec">
          <span
            {...rich(
              H.p4 ??
                `AI 답변 ${s.n}개 중 ${s.ok_n}개만 ${c.brand}를 정확히 설명했습니다`
            )}
          />
          <span className="dot">.</span>
        </h1>
        <div className="band">
          <div>
            <div className="t">정확 인식률</div>
            <div className="v hot">
              {s.ok_rate}
              <small>%</small>
            </div>
            <div className="f">
              {s.n}건 중 {s.ok_n}건이
              <br />
              실제 서비스를 맞게 설명
            </div>
          </div>
          <div>
            <div className="t">잘못 설명한 답변</div>
            <div className="v">
              {s.wrong_n}
              <small>건</small>
            </div>
            <div className="f">
              다른 회사로 착각 {s.other_n}
              <br />
              없는 내용 지어냄 {s.made_n}
            </div>
          </div>
          <div>
            <div className="t">정답을 낸 엔진</div>
            <div className="v">
              {s.engines_correct}
              <small>/ {s.engines_total}곳</small>
            </div>
            <div className="f">
              {currentEngineDisplayText(
                s.correct_engine_names,
                legacySyntheticEngineIds
              )}
            </div>
          </div>
          <div>
            <div className="t">공식 사이트 인용</div>
            <div className="v">
              {officialPct}
              <small>%</small>
            </div>
            <div className="f">
              AI가 든 출처 {s.cites_total}건 중
              <br />
              공식 사이트 {s.official_cites}건
            </div>
          </div>
        </div>
        <h3 className="sq">
          엔진별 결과
          <span className="sub">
            정확 인식률 높은 순 · 엔진마다 받은 질문 수가 다름
          </span>
        </h3>
        <table className="tbl">
          <tbody>
            <tr>
              <th>엔진</th>
              <th style={{ width: "40mm" }}>정확 인식률</th>
              <th className="c">정확 / 질문</th>
              <th className="c">다른 회사</th>
              <th className="c">지어냄</th>
              <th className="c">일반명사</th>
              <th className="c">모름·없음</th>
              <th className="r">공식 사이트 인용</th>
            </tr>
            {/* biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 템플릿 표의 칸 조건(0이면 흐리게)을 1:1 로 옮긴 것 */}
            {engines.map((e, i) => (
              <tr className={i === 0 && e.ok ? "top" : undefined} key={e.id}>
                <td>
                  <span className="eng">
                    <Mono engine={e.id} />
                    {currentEngineDisplayName(
                      e.id,
                      e.name,
                      legacySyntheticEngineIds
                    )}
                  </span>
                </td>
                <td>
                  <div className="bar">
                    <div className="track">
                      {e.rate ? <i style={{ width: `${e.rate}%` }} /> : null}
                    </div>
                    <span className={e.rate ? undefined : "zero"}>
                      {e.rate}%
                    </span>
                  </div>
                </td>
                <td className="c">
                  <b className={e.ok ? undefined : "zero"}>{e.ok}</b> / {e.n}
                </td>
                <td className={`c ${e.other ? "" : "zero"}`}>{e.other}</td>
                <td className={`c ${e.made ? "" : "zero"}`}>{e.made}</td>
                <td className={`c ${e.generic ? "" : "zero"}`}>{e.generic}</td>
                <td className={`c ${e.unknown ? "" : "zero"}`}>{e.unknown}</td>
                <td className="r">
                  {e.cites ? (
                    <>
                      <b className={e.official ? undefined : "zero"}>
                        {e.official}
                      </b>{" "}
                      / {e.cites}건
                    </>
                  ) : (
                    <span className="zero">출처 없음</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ins">
          {c.insights_accuracy.map((t) => (
            <div key={t} {...rich(t)} />
          ))}
        </div>
        <div className="notes">
          {noteBase}
          <br />
          공식 사이트 인용 = 답변이 근거로 표시한 출처 중{" "}
          {c.official_domains.join("·")} 수. Gemini는 출처 주소 대신 도메인만
          제공해 도메인 기준으로 집계.
        </div>
        <Foot
          auditId={c.audit_id}
          brand={c.brand}
          measuredAt={c.measured_at}
          n={4}
        />
      </section>

      {/* 05 섹션2 */}
      <section className="page">
        <Head brand={c.brand} sec="Section 2 · 엔진·질문별" />
        <div className="kicker">엔진·질문별 답변 결과</div>
        <h1 className="sec">
          <span
            {...rich(
              H.p5 ?? "같은 질문에도 엔진마다 전혀 다른 회사를 설명합니다"
            )}
          />
          <span className="dot">.</span>
        </h1>
        <table className="tbl mx" style={{ marginTop: "7mm" }}>
          <tbody>
            <tr>
              <th style={{ width: "27mm" }}>엔진</th>
              {perQ.map((q) => (
                <th key={q.i}>
                  Q{q.i + 1} {q.short}
                </th>
              ))}
            </tr>
            {engines.map((e) => (
              <tr key={e.id}>
                <td>
                  <span className="eng">
                    <Mono engine={e.id} />
                    {currentEngineDisplayName(
                      e.id,
                      e.name,
                      legacySyntheticEngineIds
                    )}
                  </span>
                </td>
                {perQ.map((q) => {
                  const a = e.cells[String(q.i)];
                  return (
                    <td key={q.i}>
                      {a ? (
                        <div className={`cell ${a.label}`}>
                          <Lb label={a.label} text={LABELS[a.label].name} />
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
        <h3 className="sq">질문 유형별 정확 인식률</h3>
        <div className="qrow">
          {perQ.map((q) => (
            <div key={q.i}>
              <div className="l">Q{q.i + 1}</div>
              <div className="t">{q.short}</div>
              <div className="v">
                {q.rate}%
                <small>
                  {q.ok}/{q.n}건
                </small>
              </div>
              <div className="track">
                {q.rate ? <i style={{ width: `${q.rate}%` }} /> : null}
              </div>
            </div>
          ))}
        </div>
        <div className="ins">
          {c.insights_matrix.map((t) => (
            <div key={t} {...rich(t)} />
          ))}
        </div>
        <div className="notes">
          {noteBase}
          <br />
          질문 원문 —{" "}
          {c.questions.map((q, i) => (
            <span key={q}>
              Q{i + 1} “<span {...rich(q)} />”
              {i < c.questions.length - 1 ? " · " : ""}
            </span>
          ))}
        </div>
        <Foot
          auditId={c.audit_id}
          brand={c.brand}
          measuredAt={c.measured_at}
          n={5}
        />
      </section>

      {/* 06 섹션3 */}
      <section className="page">
        <Head brand={c.brand} sec="Section 3 · 브랜드 이미지" />
        <div className="kicker">AI가 바라보는 {c.brand}</div>
        <h1 className="sec">
          <span
            {...rich(
              H.p6 ?? `AI가 만든 ${c.brand}의 얼굴은 ${s.faces_n}가지입니다`
            )}
          />
          <span className="dot">.</span>
        </h1>
        <div className="deck" style={{ marginTop: "2mm" }}>
          {c.question_short[0]}·{c.question_short[1]} 질문에 AI가 설명한{" "}
          {c.brand}의 정체입니다.
        </div>
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
              .map((a, i) => (
                <div
                  className={`row ${a.label}`}
                  // biome-ignore lint/suspicious/noArrayIndexKey: 위와 같은 이유(동결 목록·중복 가능)
                  key={`${a.engine}-${a.q}-${i}`}
                >
                  <div className="e">
                    <Mono engine={a.engine} />
                    <span>
                      {currentEngineDisplayName(
                        a.engine,
                        undefined,
                        legacySyntheticEngineIds
                      )}
                      <br />
                      <span
                        style={{
                          fontWeight: 500,
                          color: "var(--mut)",
                          fontSize: "7.4pt",
                        }}
                      >
                        Q{a.q + 1} {c.question_short[a.q]}
                      </span>
                    </span>
                  </div>
                  <div>
                    <div className="who">
                      <Lb label={a.label} />
                      <span {...rich(a.who)} />
                    </div>
                    <div className="q" {...rich(a.quote)} />
                  </div>
                </div>
              ))}
          </div>
        </div>
        <div className="notes">
          측정 {c.measured_at} · 질문당 1회 · 답변 문장은 원문에서 핵심만 줄여
          옮김 · 판별은 사람이 원문을 공식 사이트와 대조. 영문 질문(Q3·Q4)
          결과는 5쪽.
        </div>
        <Foot
          auditId={c.audit_id}
          brand={c.brand}
          measuredAt={c.measured_at}
          n={6}
        />
      </section>

      {/* 07 섹션4 */}
      <section className="page">
        <Head brand={c.brand} sec="Section 4 · 인용 출처" />
        <div className="kicker">AI가 인용하는 콘텐츠</div>
        <h1 className="sec">
          <span
            {...rich(
              H.p7 ??
                `AI가 근거로 삼은 출처 중 공식 사이트는 ${officialPct}%뿐입니다`
            )}
          />
          <span className="dot">.</span>
        </h1>
        <h3 className="sq">
          출처 채널 구성<span className="sub">인용 {s.cites_total}건</span>
        </h3>
        <div className="stackbar">
          {channels.map((ch) => (
            <div
              className={`ch-${ch.id} ${["wiki", "news", "etc", "bizdb"].includes(ch.id) ? "lt" : ""}`}
              key={ch.id}
              style={{ flex: ch.n }}
            >
              {ch.pct >= 7 ? `${pyRound(ch.pct)}%` : null}
            </div>
          ))}
        </div>
        <div className="ch-legend">
          {channels.map((ch) => (
            <span className={`ch-${ch.id}`} key={ch.id}>
              {ch.name}
              <b>{pyFloatStr(ch.pct)}%</b>
            </span>
          ))}
        </div>
        <div className="vs">
          <div className="g">
            <div className="t">정답을 낸 답변 중 공식 사이트를 인용한 답변</div>
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
        <h3 className="sq">AI가 가장 많이 참고한 사이트 TOP 8</h3>
        <table className="tbl tight">
          <tbody>
            <tr>
              <th className="c" style={{ width: "8mm" }}>
                #
              </th>
              <th>도메인</th>
              <th>유형</th>
              <th style={{ width: "40mm" }}>인용 수</th>
              <th>인용한 엔진</th>
              <th className="c">정답 근거</th>
            </tr>
            {top.slice(0, 8).map((t, i) => (
              <tr
                className={t.ch === "official" ? "top" : undefined}
                key={t.domain}
              >
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
                  {currentEngineDisplayText(
                    t.engines,
                    legacySyntheticEngineIds
                  )}
                </td>
                <td className="c">
                  {t.in_ok ? (
                    <Lb label="ok" text="예" />
                  ) : (
                    <span className="zero">–</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ins">
          {c.insights_citation.map((t) => (
            <div key={t} {...rich(t)} />
          ))}
        </div>
        <div className="notes">
          인용 = 각 답변이 근거로 표시한 출처 도메인 {s.cites_total}건(한 답변에
          여러 출처 가능). 다음 검색은 AI 답변 대신 검색 결과 문서를 반환해 그
          문서를 출처로 집계. 정답 근거 ‘예’ = 그 사이트를 인용한 답변 중 하나
          이상이 ‘정확’.
        </div>
        <Foot
          auditId={c.audit_id}
          brand={c.brand}
          measuredAt={c.measured_at}
          n={7}
        />
      </section>

      {/* 08 섹션5 */}
      <section className="page">
        <Head brand={c.brand} sec="Section 5 · 원인" />
        <div className="kicker">왜 이런 결과가 나왔을까</div>
        <h1 className="sec">
          <span
            {...rich(H.p8 ?? `AI가 ${c.brand}를 놓치는 이유는 세 가지입니다`)}
          />
          <span className="dot">.</span>
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
          사이트 기본기 점검
          <span className="sub">
            {c.site_checked_at || c.measured_at} 직접 확인
          </span>
        </h3>
        <table className="tbl">
          <tbody>
            <tr>
              <th>점검 항목</th>
              <th style={{ width: "22mm" }}>상태</th>
              <th>확인 내용</th>
            </tr>
            {c.site_checks.map((x) => (
              <tr key={x.item}>
                <td className="name" {...rich(x.item)} />
                <td>
                  <span className={`st ${x.state}`}>{stateName[x.state]}</span>
                </td>
                <td style={{ color: "var(--ink2)" }} {...rich(x.note)} />
              </tr>
            ))}
          </tbody>
        </table>
        <div className="notes">
          기술 기본기(제목·사이트맵 등)가 갖춰져도 AI 추천이 보장되지는
          않습니다. Google 공식 안내도 AI 검색 전용 필수 마크업은 없으며 검색
          기본기와 도움이 되는 콘텐츠가 핵심이라고 설명합니다.
        </div>
        <Foot
          auditId={c.audit_id}
          brand={c.brand}
          measuredAt={c.measured_at}
          n={8}
        />
      </section>

      {/* 09 플레이북 */}
      <section className="page">
        <Head brand={c.brand} sec="Playbook" />
        <div className="kicker">바로 실천하는 개선 플레이북</div>
        <h1 className="sec">
          <span
            {...rich(H.p9 ?? "AI가 어디서 읽든 같은 설명을 만나게 하세요")}
          />
          <span className="dot">.</span>
        </h1>
        <div className="pb-cols">
          {(
            [
              ["P0", "이번 주"],
              ["P1", "20일 안"],
              ["P2", "재측정 설계"],
            ] as const
          ).map(([grp, when]) => (
            <div className={`pb-col ${grp}`} key={grp}>
              <div className="ph">
                <b>{grp}</b>
                <span>{when}</span>
              </div>
              {c.playbook
                .filter((x) => x.p === grp)
                .map((x) => (
                  <div className="pb-item" key={x.h}>
                    <h4 {...rich(x.h)} />
                    <p {...rich(x.d)} />
                  </div>
                ))}
            </div>
          ))}
        </div>
        <div className="cta">
          <div>
            <h4>수정 문구까지 함께 만들어 드립니다</h4>
            <p>
              P0·P1 항목의 구체적인 수정 문구와 외부 발행용 소개글 초안을
              Findable이 준비합니다.
            </p>
            <span className="btn">20일 개선 PoC 알아보기 →</span>
          </div>
          <img alt="" className="fmark" src={ASSET.fMark} />
        </div>
        <Foot
          auditId={c.audit_id}
          brand={c.brand}
          measuredAt={c.measured_at}
          n={9}
        />
      </section>

      {/* 10 계획 */}
      <section className="page">
        <Head brand={c.brand} sec="Next" />
        <div className="kicker">20일 개선·재측정 계획</div>
        <h1 className="big">
          20일 뒤, AI의 대답이
          <br />
          달라졌는지 확인합니다<span className="dot">.</span>
        </h1>
        <div className="deck">
          이번 리포트와 <b>같은 질문·같은 엔진</b>으로 다시 측정해 전후를
          비교합니다. 변화는 관찰 결과로만 보고하며 매출 효과로 단정하지
          않습니다.
        </div>
        <div className="tl">
          {c.poc.map((x) => (
            <div key={x.d}>
              <div className="d" {...rich(x.d)} />
              <div className="h" {...rich(x.h)} />
              <div className="p" {...rich(x.p)} />
            </div>
          ))}
        </div>
        <h3 className="sq" style={{ marginTop: "12mm" }}>
          PoC 기간 동안 Findable이 드리는 것
        </h3>
        <div className="give">
          <div>
            <h4>원문·판별 근거</h4>
            <p>모든 AI 답변 원문과 판별 사유, 인용 출처를 표로 공유합니다.</p>
          </div>
          <div>
            <h4>수정안과 문구 초안</h4>
            <p>P0·P1 항목의 수정 문구와 발행용 소개글 초안을 드립니다.</p>
          </div>
          <div>
            <h4>재측정 리포트</h4>
            <p>같은 조건의 전후 비교 리포트와 30분 해석 미팅.</p>
          </div>
        </div>
        <div className="cta">
          <div>
            <h4>AI가 우리 브랜드를 어떻게 말하는지 궁금하다면?</h4>
            <p>
              Findable이 AI 검색 현황을 직접 진단하고, 무엇부터 고칠지
              알려드립니다.
            </p>
            <span className="btn">findable.co.kr</span>
          </div>
          <img alt="" className="fmark" src={ASSET.fMark} />
        </div>
        <Foot
          auditId={c.audit_id}
          brand={c.brand}
          measuredAt={c.measured_at}
          n={10}
        />
      </section>

      {/* 11 뒷표지 */}
      <section className="page back">
        <img alt="Findable" className="fb" src={ASSET.fMark} />
        <div>
          <h2>AI가 먼저 찾는 브랜드로.</h2>
          <p>
            Findable은 ChatGPT·Gemini·네이버 등 AI가 우리 브랜드를 어떻게
            설명하는지 측정하고,
            <br />
            무엇을 고치면 되는지 우선순위로 알려드립니다.
          </p>
          <span className="url">findable.co.kr</span>
        </div>
        <div className="meta">
          <span>
            {c.brand} AI 검색 진단 리포트 · 측정 {c.measured_at} · 발행{" "}
            {c.issued_at}
          </span>
          <span>고객 전용 · 무단 배포 금지</span>
        </div>
      </section>
    </>
  );
}
