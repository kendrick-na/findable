// Findable Steps v3 — Linear feature-card 패턴
// 4단계 (측정 / 분석 / 추천 / 발행) — Linear surface-1 + hairline + radius lg
// D-060 (2026-05-11): locale 분기 추가

import { Check } from "lucide-react";
import { Reveal } from "./reveal";

const SECTIONS_KO = [
  {
    stage: "측정",
    en: "Measure",
    title: "도메인만 입력하면 끝.",
    body: "7개 AI 답변을 동시에 모아서, 3분 안에 결과를 드립니다. 한국어와 영어, 둘 다 추적합니다.",
    bullets: [
      "글로벌 4개 + 한국 3개 = 7개 AI 병렬 호출",
      "Princeton GEO-Bench 산식 기반 점유율 측정",
      "한국어 표기 변형까지 빠짐없이 추적",
    ],
    mock: "engines",
  },
  {
    stage: "분석",
    en: "Analyze",
    title: "한국어 변형까지 빠짐없이.",
    body: "영문 약칭, 영문 정식명, 한글명. 같은 브랜드의 모든 표기를 자동으로 묶습니다. 글로벌 GEO 도구가 못 잡는 차별화입니다.",
    bullets: [
      "인용 도메인을 URL 단위까지 추적",
      "5축 점수 시스템 (v1.5 예정)",
      "산업별 자동 분류 (K-뷰티 · D2C · B2B · 한국지사)",
    ],
    mock: "entity",
  },
  {
    stage: "추천",
    en: "Recommend",
    title: "추측이 아닌, 검증된 액션.",
    body: "Princeton 연구가 검증한 8가지 GEO 전략 중 효과 큰 3개를 우선 제안합니다. Cite Sources · Quotation · Statistics로 가시성 +40%.",
    bullets: [
      "Top 3 액션: 우선순위 · 예상 효과 · 난이도",
      "산업별 맞춤 가이드 (K-뷰티 · 한국지사 · 내수 D2C)",
      "월간 자동 리포트 (Notion · Google Docs) — 준비 중",
    ],
    mock: "actions",
  },
  {
    stage: "발행",
    en: "Publish",
    title: "클릭 한 번으로 적용.",
    // 🔴 문구 정직화(2026-08-17 세션N-39 · 👤 승인). 이 카드는 **아직 없는 기능**이다.
    //   전에는 본문이 *"바로 발행합니다"* 라고 **현재형**인데 불릿만 `(v1.5)` 라
    //   같은 카드 안에서 앞뒤가 안 맞았다 — 본문만 읽은 방문자는 되는 줄 안다.
    //   → 본문을 미래형으로 바꾸고, 불릿마다 반복하던 `(v1.5)` 를 걷어
    //     **카드 단위 배지 1개**(`upcoming`)로 올린다.
    //   ⚠️ `v1.5` 라는 **버전 표기를 뺀 이유**: 날짜 약속처럼 읽힌다. 선행조건인
    //     Cafe24 앱 심사·개발 일정이 미정이라 버전을 박으면 그것도 거짓이 된다.
    //     (조사 2026-08-17: 카페24 심사 3~5영업일이나 **개발 기간은 별개**)
    upcoming: true,
    body: "추천안을 Cafe24 · 네이버 스마트스토어 · WordPress에 바로 올릴 수 있게 준비하고 있습니다. AI가 인용하기 좋은 형태로 정리해 다시 측정하는 것까지가 목표입니다.",
    bullets: [
      "원클릭 발행: Cafe24 · 네이버 · WordPress",
      "K-뷰티 톤앤매너 자동 감수",
      "AI 답변 → 구매 전환 추적",
    ],
    mock: "publish",
  },
];

const SECTIONS_EN = [
  {
    ...SECTIONS_KO[0],
    stage: "Measure",
    title: "Just enter your domain.",
    body: "We pull 7 AI answers in parallel and return results within 3 minutes, tracking both Korean and English.",
    bullets: [
      "4 global + 3 Korean = 7 AI engines called in parallel",
      "Share-of-voice scored on the Princeton GEO-Bench formula",
      "Tracks every Korean spelling variant, no misses",
    ],
  },
  {
    ...SECTIONS_KO[1],
    stage: "Analyze",
    title: "Every Korean variant, covered.",
    body: "The short English name, the full English name, the Korean name. We auto-merge every spelling of the same brand. The edge global GEO tools can't match.",
    bullets: [
      "Cited domains tracked down to the URL",
      "5-axis scoring system (planned v1.5)",
      "Auto-classified by industry (K-beauty · D2C · B2B · Korea HQ)",
    ],
  },
  {
    ...SECTIONS_KO[2],
    stage: "Recommend",
    title: "Verified actions, not guesses.",
    body: "From the 8 GEO strategies validated by Princeton research, we surface the 3 with the highest impact. Cite Sources · Quotation · Statistics for +40% visibility.",
    bullets: [
      "Top 3 actions: priority · expected impact · difficulty",
      "Industry-specific guides (K-beauty · Korea HQ · domestic D2C)",
      "Monthly auto report (Notion · Google Docs) — coming soon",
    ],
  },
  {
    ...SECTIONS_KO[3],
    stage: "Publish",
    title: "Apply with one click.",
    // 🔴 KO 와 **같이** 고친다. 함정 기록: KO 만 고치고 EN 날조 4건을 놓친 적이 있다.
    body: "We're building the ability to push recommendations straight to Cafe24 · Naver Smart Store · WordPress — formatted for AI to cite, then re-measured.",
    bullets: [
      "One-click publish: Cafe24 · Naver · WordPress",
      "Auto K-beauty tone & manner review",
      "AI answer → purchase conversion tracking",
    ],
  },
];

interface StepSectionsProps {
  locale?: string;
}

export const StepSections = ({ locale = "ko" }: StepSectionsProps) => {
  const isKo = locale.startsWith("ko");
  const SECTIONS = isKo ? SECTIONS_KO : SECTIONS_EN;
  const eyebrow = isKo ? "Findable, 이렇게 작동합니다" : "How Findable works";
  const heading = isKo
    ? "측정부터 발행까지, Findable 하나로."
    : "From measure to publish, all in Findable.";
  return (
    <section
      className="relative bg-[var(--findable-canvas)] px-8 pt-8 pb-14 md:pt-10 md:pb-16"
      id="product"
      style={{ scrollMarginTop: "72px" }}
    >
      <div className="mx-auto max-w-[1200px]">
        {/* Section header */}
        <div className="mb-12 max-w-[720px]">
          <p
            className="text-[12px] text-[var(--findable-primary)] uppercase tracking-[0.18em]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {eyebrow}
          </p>
          <h2
            className="mt-4 max-w-[900px] text-[var(--findable-ink)]"
            style={{
              fontFamily: isKo
                ? "var(--findable-font-display-kr)"
                : "var(--findable-font-display)",
              fontSize: "clamp(32px, 4vw, 48px)",
              lineHeight: 1.15,
              // 한글은 정사각 격자 → 자간 0 (영문만 좁힌다)
              letterSpacing: isKo ? "0" : "-0.025em",
              fontWeight: 500,
              wordBreak: "keep-all",
            }}
          >
            {heading}
          </h2>
        </div>

        {/* 4 카드 그리드 — Linear feature-card 패턴 + hover + stagger reveal */}
        <Reveal
          className="findable-glass-field grid gap-8 md:grid-cols-2"
          stagger={60}
        >
          {SECTIONS.map((s) => (
            <article
              className="findable-glass group relative overflow-hidden rounded-xl p-8 transition-all duration-300 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/15 before:to-transparent hover:-translate-y-0.5"
              data-reveal-item
              key={s.en}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="text-[12px] text-[var(--findable-primary)] uppercase tracking-[0.14em]"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {s.stage}
                </span>
                {/* 🔴 아직 없는 단계임을 **카드 맨 위에서** 알린다(2026-08-17 · 👤 승인).
                    불릿마다 `(v1.5)` 를 세 번 반복하던 걸 배지 하나로 올렸다 —
                    본문만 읽고 "이미 되는 기능"으로 오해하던 걸 막는 게 목적이다. */}
                {"upcoming" in s && s.upcoming ? (
                  <span
                    className="rounded-full border border-[var(--findable-ink-muted)]/30 px-2 py-0.5 text-[11px] text-[var(--findable-ink-muted)] tracking-[0.02em]"
                    style={{ fontFamily: "var(--findable-font-sans)" }}
                  >
                    {isKo ? "준비 중" : "In progress"}
                  </span>
                ) : null}
              </div>
              <h3
                className="mt-4 text-[var(--findable-ink)]"
                style={{
                  fontFamily: isKo
                    ? "var(--findable-font-display-kr)"
                    : "var(--findable-font-display)",
                  fontSize: "26px",
                  lineHeight: 1.25,
                  // 한글은 정사각 격자 → 자간 0 (영문만 좁힌다)
                  letterSpacing: isKo ? "0" : "-0.02em",
                  fontWeight: 500,
                }}
              >
                {s.title}
              </h3>
              <p
                className="mt-4 text-[15px] text-[var(--findable-ink-muted)] leading-[1.65]"
                style={{ fontFamily: "var(--findable-font-sans)" }}
              >
                {s.body}
              </p>
              <ul className="mt-6 space-y-2.5">
                {s.bullets.map((b) => (
                  <li
                    className="flex items-start gap-2.5 text-[14px] text-[var(--findable-ink-muted)]"
                    key={b}
                    style={{ fontFamily: "var(--findable-font-sans)" }}
                  >
                    <Check
                      className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-[var(--findable-primary)]"
                      strokeWidth={2.5}
                    />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              {/* 모형 미니 카드: 글래스 위에선 canvas가 떠 보여 반투명 딥 톤으로 */}
              <div className="mt-8 rounded-lg bg-[rgba(1,1,2,0.5)] p-4">
                <MiniMock isKo={isKo} kind={s.mock} />
              </div>
            </article>
          ))}
        </Reveal>
      </div>
    </section>
  );
};

// 단계별 모형 (Linear product-screenshot-card 미니 버전)
const MiniMock = ({ kind, isKo = true }: { kind: string; isKo?: boolean }) => {
  const fontMono: React.CSSProperties = {
    fontFamily: "var(--findable-font-mono)",
  };
  if (kind === "engines") {
    return (
      <div className="text-[12px] leading-[1.7]" style={fontMono}>
        <div className="text-[var(--findable-ink-subtle)]">
          $ findable audit your-brand.co.kr
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[var(--findable-ink-muted)]">
          <span>
            <span className="text-[var(--findable-success)]">✓</span> ChatGPT
            <span className="float-right text-[var(--findable-ink-tertiary)]">
              23s
            </span>
          </span>
          <span>
            <span className="text-[var(--findable-success)]">✓</span> Gemini
            <span className="float-right text-[var(--findable-ink-tertiary)]">
              19s
            </span>
          </span>
          <span>
            <span className="text-[var(--findable-success)]">✓</span> Claude
            <span className="float-right text-[var(--findable-ink-tertiary)]">
              27s
            </span>
          </span>
          <span>
            <span className="text-[var(--findable-success)]">✓</span> Perplexity
            <span className="float-right text-[var(--findable-ink-tertiary)]">
              21s
            </span>
          </span>
        </div>
        <div className="mt-2 border-[var(--findable-hairline)] border-t pt-2 text-[var(--findable-primary)]">
          → 7/7 engines OK · 25s avg
        </div>
      </div>
    );
  }
  if (kind === "entity") {
    return (
      <div className="space-y-1.5 text-[12px]" style={fontMono}>
        {/* 🔴 390px 실측(2026-08-15): 이름이 길면 3칸이 줄바꿈되며 서로 겹친다.
            실존사(메디큐브 등)를 걷어내며 이름이 길어졌기 때문 → 짧은 라벨로 맞춘다.
            이 mock 이 보여줄 건 "같은 브랜드의 여러 표기가 하나로 묶인다" 뿐이다. */}
        {[
          { ko: isKo ? "우리 브랜드" : "Our Brand", aka: "OURBRAND · Our" },
          { ko: isKo ? "경쟁사 A" : "Rival A", aka: "RIVAL-A · RivalA" },
          { ko: isKo ? "경쟁사 B" : "Rival B", aka: "RIVAL-B · RivalB" },
        ].map((b) => (
          <div className="flex items-center justify-between gap-3" key={b.ko}>
            <span className="shrink-0 text-[var(--findable-ink)]">{b.ko}</span>
            <span className="truncate text-[11px] text-[var(--findable-ink-tertiary)]">
              {b.aka}
            </span>
          </div>
        ))}
        <div className="mt-2 border-[var(--findable-hairline)] border-t pt-2 text-[var(--findable-primary)]">
          →{" "}
          {isKo
            ? "한국어 표기·별칭을 하나의 개체로 묶습니다"
            : "Korean names and aliases resolved into one entity"}
        </div>
      </div>
    );
  }
  if (kind === "actions") {
    return (
      <div className="space-y-1.5 text-[12px]" style={fontMono}>
        {[
          { n: "01", t: "Cite peer-reviewed sources", impact: "High" },
          { n: "02", t: "Add quotation patterns", impact: "High" },
          { n: "03", t: "Inject Korean statistics", impact: "Medium" },
        ].map((a) => (
          <div className="flex items-center gap-3" key={a.n}>
            <span className="text-[var(--findable-ink-tertiary)]">{a.n}</span>
            <span className="flex-1 text-[var(--findable-ink-muted)]">
              {a.t}
            </span>
            <span className="text-[var(--findable-primary)]">{a.impact}</span>
          </div>
        ))}
      </div>
    );
  }
  // publish
  return (
    <div className="space-y-1.5 text-[12px]" style={fontMono}>
      {/* 🔴 2026-08-15 — `Connected`(연결됨) 는 **미출시 기능을 라이브로 표시**하던 것이다.
          같은 카드가 미출시를 고지하므로 여기도 **같은 말**을 써야 한다(한 화면 두 표기 금지).
          🔄 2026-08-17 세션N-39 — 카드 표기를 `v1.5` → 「준비 중」 배지로 바꾸면서
             **여기도 같이** 바꾼다. `v1.5` 는 날짜 약속처럼 읽히는데 선행조건인
             Cafe24 앱 심사·개발 일정이 미정이다. 출시되면 그때 실제 상태로 바꾼다. */}
      {[
        { name: "Cafe24", status: isKo ? "준비 중" : "In progress" },
        { name: "Naver Smart Store", status: isKo ? "준비 중" : "In progress" },
        { name: "WordPress", status: isKo ? "준비 중" : "In progress" },
        { name: "Shopify", status: isKo ? "검토 중" : "Under review" },
      ].map((p) => (
        <div className="flex items-center justify-between" key={p.name}>
          <span className="text-[var(--findable-ink-muted)]">{p.name}</span>
          <span className="text-[var(--findable-ink-tertiary)]">
            ○ {p.status}
          </span>
        </div>
      ))}
    </div>
  );
};
