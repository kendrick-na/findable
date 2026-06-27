// Findable Steps v3 — Linear feature-card 패턴
// 4단계 (측정 / 분석 / 추천 / 발행) — Linear surface-1 + hairline + radius lg
// D-060 (2026-05-11): locale 분기 추가

import { Check } from "lucide-react";
import { Reveal } from "./reveal";

const SECTIONS_KO = [
  {
    num: "1.0",
    stage: "측정",
    en: "Measure",
    title: "도메인만 입력하면 끝.",
    body: "7개 AI 답변을 동시에 모아서, 평균 25초 안에 결과를 드립니다. 한국어와 영어, 둘 다 추적합니다.",
    bullets: [
      "글로벌 4개 + 한국 3개 = 7개 AI 병렬 호출",
      "Princeton GEO-Bench 산식 기반 점유율 측정",
      "한국어 표기 변형까지 빠짐없이 추적",
    ],
    mock: "engines",
  },
  {
    num: "2.0",
    stage: "분석",
    en: "Analyze",
    title: "한국어 변형까지 빠짐없이.",
    body: "아모레, Amorepacific, 아모레퍼시픽 — 같은 브랜드의 모든 표기를 자동으로 묶습니다. 글로벌 GEO 도구가 못 잡는 차별화입니다.",
    bullets: [
      "인용 도메인을 URL 단위까지 추적",
      "5축 점수 시스템 (v1.5 예정)",
      "산업별 자동 분류 (K-뷰티 · D2C · B2B · 한국지사)",
    ],
    mock: "entity",
  },
  {
    num: "3.0",
    stage: "추천",
    en: "Recommend",
    title: "추측이 아닌, 검증된 액션.",
    body: "Princeton 연구가 검증한 8가지 GEO 전략 중 효과 큰 3개를 우선 제안합니다. Cite Sources · Quotation · Statistics로 가시성 +40%.",
    bullets: [
      "Top 3 액션 — 우선순위 · 예상 효과 · 난이도",
      "산업별 맞춤 가이드 (K-뷰티 · 한국지사 · 내수 D2C)",
      "월간 자동 리포트 (Notion · Google Docs)",
    ],
    mock: "actions",
  },
  {
    num: "4.0",
    stage: "발행",
    en: "Publish",
    title: "클릭 한 번으로 적용.",
    body: "Cafe24 · 네이버 스마트스토어 · WordPress에 추천안을 바로 발행합니다. AI가 인용하기 좋은 형태로 정리되어 다시 측정합니다.",
    bullets: [
      "원클릭 발행 — Cafe24 · 네이버 · WordPress (v1.5)",
      "K-뷰티 톤앤매너 자동 감수 (v1.5)",
      "AI 답변 → 구매 전환 추적 (v1.5)",
    ],
    mock: "publish",
  },
];

const SECTIONS_EN = [
  {
    ...SECTIONS_KO[0],
    stage: "Measure",
    title: "Just enter your domain.",
    body: "We pull 7 AI answers in parallel and return results in ~25 seconds — tracking both Korean and English.",
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
    body: "Amore, Amorepacific, 아모레퍼시픽 — we auto-merge every spelling of the same brand. The edge global GEO tools can't match.",
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
      "Top 3 actions — priority · expected impact · difficulty",
      "Industry-specific guides (K-beauty · Korea HQ · domestic D2C)",
      "Monthly auto report (Notion · Google Docs)",
    ],
  },
  {
    ...SECTIONS_KO[3],
    stage: "Publish",
    title: "Apply with one click.",
    body: "Publish recommendations straight to Cafe24 · Naver Smart Store · WordPress — formatted for AI to cite, then re-measured.",
    bullets: [
      "One-click publish — Cafe24 · Naver · WordPress (v1.5)",
      "Auto K-beauty tone & manner review (v1.5)",
      "AI answer → purchase conversion tracking (v1.5)",
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
    : "From measure to publish — all in Findable.";
  return (
    <section
      id="product"
      className="relative bg-[var(--findable-canvas)] px-8 pt-8 pb-14 md:pt-10 md:pb-16"
      style={{ scrollMarginTop: "72px" }}
    >
      <div className="mx-auto max-w-[1200px]">
        {/* Section header */}
        <div className="mb-12 max-w-[720px]">
          <p
            className="text-[12px] uppercase tracking-[0.18em] text-[var(--findable-primary)]"
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
              letterSpacing: "-0.025em",
              fontWeight: 500,
              wordBreak: "keep-all",
            }}
          >
            {heading}
          </h2>
        </div>

        {/* 4 카드 그리드 — Linear feature-card 패턴 + hover + stagger reveal */}
        <Reveal stagger={100} className="grid gap-8 md:grid-cols-2">
          {SECTIONS.map((s) => (
            <article
              key={s.num}
              data-reveal-item
              className="group relative overflow-hidden rounded-xl border border-white/[0.06] bg-[var(--findable-surface-1)] p-8 transition-all duration-300 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/15 before:to-transparent hover:-translate-y-0.5 hover:border-white/[0.12]"
              style={{
                boxShadow:
                  "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 24px 48px -16px rgba(0,0,0,0.5)",
              }}
            >
              <div className="flex items-baseline gap-3">
                <span
                  className="text-[12px] text-[var(--findable-primary)]"
                  style={{ fontFamily: "var(--findable-font-mono)" }}
                >
                  {s.num}
                </span>
                <span
                  className="text-[12px] uppercase tracking-[0.14em] text-[var(--findable-ink-subtle)]"
                  style={{ fontFamily: "var(--findable-font-sans)" }}
                >
                  {s.en}
                </span>
              </div>
              <h3
                className="mt-5 text-[var(--findable-ink)]"
                style={{
                  fontFamily: isKo
                    ? "var(--findable-font-display-kr)"
                    : "var(--findable-font-display)",
                  fontSize: "26px",
                  lineHeight: 1.25,
                  letterSpacing: "-0.02em",
                  fontWeight: 500,
                }}
              >
                {s.stage} — {s.title}
              </h3>
              <p
                className="mt-4 text-[15px] leading-[1.65] text-[var(--findable-ink-muted)]"
                style={{ fontFamily: "var(--findable-font-sans)" }}
              >
                {s.body}
              </p>
              <ul className="mt-6 space-y-2.5">
                {s.bullets.map((b) => (
                  <li
                    key={b}
                    className="flex items-start gap-2.5 text-[14px] text-[var(--findable-ink-muted)]"
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
              {/* 모형 미니 카드 — surface-2/lift 만, 테두리 제거 */}
              <div className="mt-8 rounded-lg bg-[var(--findable-canvas)] p-4">
                <MiniMock kind={s.mock} />
              </div>
            </article>
          ))}
        </Reveal>
      </div>
    </section>
  );
};

// 단계별 모형 (Linear product-screenshot-card 미니 버전)
const MiniMock = ({ kind }: { kind: string }) => {
  const fontMono: React.CSSProperties = {
    fontFamily: "var(--findable-font-mono)",
  };
  if (kind === "engines") {
    return (
      <div style={fontMono} className="text-[12px] leading-[1.7]">
        <div className="text-[var(--findable-ink-subtle)]">
          $ findable audit medicube.co.kr
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
          → 7/7 engines OK · 25.4s avg
        </div>
      </div>
    );
  }
  if (kind === "entity") {
    return (
      <div style={fontMono} className="space-y-1.5 text-[12px]">
        {[
          { ko: "메디큐브", aka: "Medicube · MEDICUBE", n: 47 },
          { ko: "아모레퍼시픽", aka: "Amorepacific · 아모레", n: 32 },
          { ko: "조선미녀", aka: "Beauty of Joseon", n: 28 },
        ].map((b) => (
          <div key={b.ko} className="flex items-center justify-between">
            <span className="text-[var(--findable-ink)]">{b.ko}</span>
            <span className="text-[var(--findable-ink-tertiary)]">{b.aka}</span>
            <span className="text-[var(--findable-primary)]">{b.n}</span>
          </div>
        ))}
        <div className="mt-2 border-[var(--findable-hairline)] border-t pt-2 text-[var(--findable-primary)]">
          → Korean Moat Score: 89%
        </div>
      </div>
    );
  }
  if (kind === "actions") {
    return (
      <div style={fontMono} className="space-y-1.5 text-[12px]">
        {[
          { n: "01", t: "Cite peer-reviewed sources", impact: "+18%" },
          { n: "02", t: "Add quotation patterns", impact: "+14%" },
          { n: "03", t: "Inject Korean statistics", impact: "+9%" },
        ].map((a) => (
          <div key={a.n} className="flex items-center gap-3">
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
    <div style={fontMono} className="space-y-1.5 text-[12px]">
      {[
        { name: "Cafe24", status: "Connected" },
        { name: "Naver Smart Store", status: "Connected" },
        { name: "WordPress", status: "Connected" },
        { name: "Shopify", status: "Available" },
      ].map((p) => (
        <div key={p.name} className="flex items-center justify-between">
          <span className="text-[var(--findable-ink-muted)]">{p.name}</span>
          <span
            className={
              p.status === "Connected"
                ? "text-[var(--findable-success)]"
                : "text-[var(--findable-ink-tertiary)]"
            }
          >
            ● {p.status}
          </span>
        </div>
      ))}
    </div>
  );
};
