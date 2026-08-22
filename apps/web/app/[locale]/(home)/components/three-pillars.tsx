// Findable 3-Pillar — Linear "Built for purpose / Powered by AI agents / Designed for speed" 패턴
// 아이소메트릭 와이어 SVG (자체 작성, Lucide 의존성 없음)
// D-060 (2026-05-11): locale 분기 추가

import { Reveal } from "./reveal";

const PILLARS_KO = [
  {
    title: "글로벌+한국 AI 동시에",
    body: "ChatGPT · Gemini · Claude부터 HyperCLOVA · 네이버까지. 한국어 AI 3개를 잡는 건 Findable이 유일합니다.",
    illustration: (
      <svg
        aria-hidden="true"
        className="h-full w-full"
        fill="none"
        viewBox="0 0 200 140"
      >
        {/* 아이소메트릭 검색창 */}
        <g
          opacity="0.6"
          stroke="currentColor"
          strokeWidth="1.2"
          transform="translate(20 50) rotate(-15) skewX(-20)"
        >
          <rect height="40" rx="4" width="160" x="0" y="0" />
          <line x1="0" x2="160" y1="14" y2="14" />
          <circle cx="14" cy="7" r="2.5" />
          <circle cx="22" cy="7" r="2.5" />
          <circle cx="30" cy="7" r="2.5" />
          <line x1="14" x2="120" y1="28" y2="28" />
        </g>
        {/* 그래프 노드 */}
        <g opacity="0.4" stroke="currentColor" strokeWidth="1">
          <circle cx="160" cy="30" r="4" />
          <circle cx="180" cy="60" r="4" />
          <circle cx="140" cy="100" r="4" />
          <circle cx="170" cy="115" r="4" />
          <line x1="160" x2="180" y1="30" y2="60" />
          <line x1="180" x2="140" y1="60" y2="100" />
          <line x1="140" x2="170" y1="100" y2="115" />
        </g>
      </svg>
    ),
  },
  {
    title: "자율 에이전트가 24시간",
    body: "AI 에이전트가 측정·분석·추천까지 알아서 처리합니다. 마케터는 결과만 확인하면 됩니다.",
    illustration: (
      <svg
        aria-hidden="true"
        className="h-full w-full"
        fill="none"
        viewBox="0 0 200 140"
      >
        {/* 중심 노드 */}
        <g opacity="0.6" stroke="currentColor" strokeWidth="1.2">
          <rect height="30" rx="4" width="40" x="80" y="55" />
          <line x1="80" x2="120" y1="65" y2="65" />
          <circle cx="86" cy="60" fill="currentColor" r="1.5" />
          <circle cx="92" cy="60" fill="currentColor" r="1.5" />
          <circle cx="98" cy="60" fill="currentColor" r="1.5" />
        </g>
        {/* 4 에이전트 위성 */}
        <g opacity="0.4" stroke="currentColor" strokeWidth="1">
          <circle cx="40" cy="30" r="10" />
          <circle cx="160" cy="30" r="10" />
          <circle cx="40" cy="110" r="10" />
          <circle cx="160" cy="110" r="10" />
          <line strokeDasharray="3 2" x1="50" x2="80" y1="35" y2="60" />
          <line strokeDasharray="3 2" x1="150" x2="120" y1="35" y2="60" />
          <line strokeDasharray="3 2" x1="50" x2="80" y1="105" y2="80" />
          <line strokeDasharray="3 2" x1="150" x2="120" y1="105" y2="80" />
        </g>
      </svg>
    ),
  },
  {
    title: "측정만 하지 않아요",
    body: "분석 결과를 바로 콘텐츠에 반영하고, 다시 측정해 결과를 봅니다. 인용이 빠르게 쌓여요.",
    illustration: (
      <svg
        aria-hidden="true"
        className="h-full w-full"
        fill="none"
        viewBox="0 0 200 140"
      >
        {/* 시간 축 */}
        <g opacity="0.4" stroke="currentColor" strokeWidth="1">
          <line x1="20" x2="180" y1="120" y2="120" />
          <line x1="20" x2="20" y1="115" y2="125" />
          <line x1="100" x2="100" y1="115" y2="125" />
          <line x1="180" x2="180" y1="115" y2="125" />
        </g>
        {/* 상승 그래프 */}
        <g opacity="0.7" stroke="currentColor" strokeWidth="1.2">
          <path d="M 20 100 L 60 85 L 100 70 L 140 45 L 180 25" fill="none" />
          <circle cx="20" cy="100" fill="currentColor" r="2.5" />
          <circle cx="60" cy="85" fill="currentColor" r="2.5" />
          <circle cx="100" cy="70" fill="currentColor" r="2.5" />
          <circle cx="140" cy="45" fill="currentColor" r="2.5" />
          <circle cx="180" cy="25" fill="currentColor" r="2.5" />
        </g>
        {/* 인용 마크 */}
        <g
          opacity="0.5"
          stroke="currentColor"
          strokeWidth="1"
          transform="translate(150 5)"
        >
          <text fill="currentColor" fontFamily="serif" fontSize="20">
            "
          </text>
        </g>
      </svg>
    ),
  },
];

// 영문 텍스트만 교체 (일러스트는 동일 SVG 재사용)
const PILLARS_EN = PILLARS_KO.map((p, i) => ({
  ...p,
  title: [
    "Global + Korean AI at once",
    "Autonomous agents, 24/7",
    "We don't just measure",
  ][i],
  body: [
    "From ChatGPT · Gemini · Claude to HyperCLOVA · Naver. Findable is the only tool covering all three Korean AI engines.",
    "AI agents handle measurement, analysis, and recommendations on their own. Marketers just review the results.",
    "We feed the analysis straight back into content, then re-measure. Citations stack up fast.",
  ][i],
}));

interface ThreePillarsProps {
  locale?: string;
}

export const ThreePillars = ({ locale = "ko" }: ThreePillarsProps) => {
  const isKo = locale.startsWith("ko");
  const PILLARS = isKo ? PILLARS_KO : PILLARS_EN;
  const heading = isKo
    ? "전세계 상위 AI 진단을 한번에."
    : "Top global + Korean AI, diagnosed at once.";

  return (
    <section className="bg-[var(--findable-canvas)] px-8 pt-8 pb-14 md:pt-10 md:pb-16">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-12 max-w-[720px]">
          <h2
            className="max-w-[900px] text-[var(--findable-ink)]"
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

        <Reveal
          className="findable-glass-field grid gap-8 md:grid-cols-3"
          stagger={60}
        >
          {PILLARS.map((p) => (
            <article
              className="findable-glass group relative overflow-hidden rounded-xl p-8 transition before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/15 before:to-transparent"
              data-reveal-item
              key={p.title}
            >
              {/* 일러스트 박스 — 미세한 dot grid + radial mask */}
              <div
                className="relative aspect-[16/10] overflow-hidden rounded-md text-[var(--findable-ink-muted)]"
                style={{
                  backgroundImage:
                    "radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)",
                  backgroundSize: "16px 16px",
                  maskImage:
                    "radial-gradient(ellipse at center, black 60%, transparent 100%)",
                }}
              >
                <div className="relative z-10 h-full p-2">{p.illustration}</div>
              </div>

              <h3
                className="mt-6 text-[18px] text-[var(--findable-ink)]"
                style={{
                  fontFamily: "var(--findable-font-sans)",
                  fontWeight: 500,
                }}
              >
                {p.title}
              </h3>

              <p
                className="mt-3 text-[14px] text-[var(--findable-ink-muted)] leading-[1.6]"
                style={{ fontFamily: "var(--findable-font-sans)" }}
              >
                {p.body}
              </p>
            </article>
          ))}
        </Reveal>
      </div>
    </section>
  );
};
