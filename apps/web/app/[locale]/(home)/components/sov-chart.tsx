// Findable SoV 분포 차트 — Linear "Cycle time by agent" 패턴 (CSS·SVG 자체 구현)
// 외부 라이브러리 의존성 0

const ENGINES = [
  { name: "ChatGPT", color: "#10a37f" },
  { name: "Gemini", color: "#3b9eff" },
  { name: "Claude", color: "#d97757" },
  { name: "Perplexity", color: "#20808d" }, // Perplexity 시그니처 틸
  { name: "HyperCLOVA", color: "#03c75a" },
  { name: "네이버", color: "#1c5fd6" }, // 네이버 블루 (HyperCLOVA 그린과 구분)
  { name: "다음", color: "#ffc53d" },
];

// deterministic seeded random (브랜드별 고정된 점 분포)
function seedRandom(seed: number) {
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

function generatePoints(seed: number, count: number, mean: number) {
  const rand = seedRandom(seed);
  return Array.from({ length: count }, () => {
    const offset = (rand() - 0.5) * 6;
    return {
      x: rand() * 100,
      y: Math.max(0, Math.min(20, mean + offset)),
    };
  });
}

interface SoVChartProps {
  locale?: string;
}

export const SoVChart = ({ locale = "ko" }: SoVChartProps) => {
  const isKo = locale.startsWith("ko");
  const chartTitle = isKo
    ? "7개 AI 엔진별 브랜드 인용률 분포"
    : "Brand citation-rate distribution across 7 AI engines";
  return (
    <div
      className="rounded-xl border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-8"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}
    >
      {/* header */}
      <div className="flex items-baseline justify-between">
        <div>
          <p
            className="text-[12px] text-[var(--findable-ink-subtle)]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            Share of Voice
          </p>
          <h3
            className="mt-1 text-[16px] text-[var(--findable-ink)]"
            style={{ fontFamily: "var(--findable-font-sans)", fontWeight: 500 }}
          >
            {chartTitle}
          </h3>
        </div>
        <div
          className="flex items-center gap-2 text-[11px] text-[var(--findable-ink-tertiary)]"
          style={{ fontFamily: "var(--findable-font-mono)" }}
        >
          <span>Last 30 days</span>
          <span>·</span>
          <span>medicube.co.kr</span>
        </div>
      </div>

      {/* 차트 */}
      <div className="mt-8 grid grid-cols-7 gap-4">
        {ENGINES.map((engine, i) => {
          // 엔진별 차이 강조: 4 → 18% 분포
          const means = [4.2, 6.8, 9.5, 14.2, 11.0, 7.5, 13.8];
          const points = generatePoints(i + 1, 32, means[i] ?? 10);
          const avg = points.reduce((s, p) => s + p.y, 0) / points.length;
          return (
            <div key={engine.name} className="flex flex-col items-center">
              {/* 점 분포 */}
              <div className="relative h-[200px] w-full">
                <div
                  className="absolute inset-0 rounded-md"
                  style={{
                    backgroundImage:
                      "linear-gradient(to top, var(--findable-hairline) 1px, transparent 1px)",
                    backgroundSize: "100% 25%",
                    opacity: 0.5,
                  }}
                />
                {points.map((p, j) => (
                  <span
                    key={j}
                    className="absolute h-1.5 w-1.5 rounded-full transition-all"
                    style={{
                      left: `${p.x}%`,
                      bottom: `${(p.y / 20) * 100}%`,
                      backgroundColor: engine.color,
                      opacity: 0.55,
                      transform: "translate(-50%, 50%)",
                    }}
                  />
                ))}
                {/* 평균 라인 */}
                <span
                  className="absolute right-0 left-0 h-px"
                  style={{
                    bottom: `${(avg / 20) * 100}%`,
                    backgroundColor: engine.color,
                    opacity: 0.4,
                  }}
                />
              </div>

              {/* 라벨 */}
              <p
                className="mt-3 text-[11px] text-[var(--findable-ink-muted)]"
                style={{ fontFamily: "var(--findable-font-sans)" }}
              >
                {engine.name}
              </p>
              <p
                className="text-[10px] text-[var(--findable-ink-tertiary)]"
                style={{ fontFamily: "var(--findable-font-mono)" }}
              >
                {avg.toFixed(1)}%
              </p>
            </div>
          );
        })}
      </div>

      {/* footer 통계 */}
      <div className="mt-6 flex items-center justify-between border-[var(--findable-hairline)] border-t pt-4 text-[11px]">
        <div
          className="flex items-center gap-4 text-[var(--findable-ink-tertiary)]"
          style={{ fontFamily: "var(--findable-font-mono)" }}
        >
          <span>n = 196 responses</span>
          <span>·</span>
          <span>Korean: 89% / English: 72%</span>
        </div>
        <span
          className="text-[var(--findable-primary)]"
          style={{ fontFamily: "var(--findable-font-sans)" }}
        >
          + 4.2% vs last 30d
        </span>
      </div>
    </div>
  );
};
