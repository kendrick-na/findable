// Findable SoV 분포 차트 — Linear "Cycle time by agent" 패턴 (CSS·SVG 자체 구현)
// 외부 라이브러리 의존성 0
//
// 🔴 2026-08-16 — **난수를 걷어내고 실측 데이터로 바꿨다.**
//   이전 버전은 `seedRandom()` 으로 점을 뿌리면서 `Last 30 days`·`medicube.co.kr`·
//   `n ≈ 200 responses` 를 붙여 측정한 것처럼 보이게 했다. 날조를 세 번 걷어냈지만
//   (b73ca5a·6760b01·0fdc25d) **데이터가 가짜인 한 구멍은 계속 생긴다** → 소스를 바꿨다.
//   이제 점 하나 = **브랜드 1곳의 실제 측정값**이다(난수 아님).
//
//   📊 원본: `public/data/k-geo-bench-v0_1.jsonl` — `/report`·`/research` 와 **같은 파일**
//   ⭐ 경쟁사 규율(4곳 실측): 회사가 만든 성과 숫자는 0곳, 수치는 출처와 함께.
//      → 여기도 데이터셋 이름·시점·표본수를 화면에 같이 적는다.
//   🔴 이 차트가 말하는 것: **글로벌 엔진은 높고 다음(Daum)만 뚝 떨어진다** =
//      "아무도 안 재는 곳을 잰다"는 우리 주장의 시각적 증거.

import { type EngineStat, loadSoVChartData } from "./sov-chart-data";

const ENGINE_COLOR: Record<string, string> = {
  chatgpt: "#10a37f",
  gemini: "#3b9eff",
  claude: "#d97757",
  perplexity: "#20808d", // Perplexity 시그니처 틸
  hyperclova: "#03c75a",
  naver: "#1c5fd6", // 네이버 블루 (HyperCLOVA 그린과 구분)
  daum: "#ffc53d",
};

interface SoVChartProps {
  locale?: string;
}

export const SoVChart = ({ locale = "ko" }: SoVChartProps) => {
  const isKo = locale.startsWith("ko");
  const lp = isKo ? "/ko" : "";
  const data = loadSoVChartData();

  const chartTitle = isKo
    ? "7개 AI 엔진별 브랜드 인용률"
    : "Brand citation rate across 7 AI engines";

  // 🔴 "한국 엔진 평균이 낮다"는 **데이터를 잘못 요약한 것**이다.
  //   실측: HyperCLOVA 81% · 네이버 92% 로 오히려 높고, **다음만 41%** 로 혼자 떨어진다.
  //   평균끼리 빼면 10%p 라 차이가 작아 보이지만 눈에 보이는 건 최고↔최저 격차다.
  //   → 평균 대신 **가장 높은 엔진과 가장 낮은 엔진**을 그대로 말한다.
  const sorted = [...data.engines].sort((a, b) => b.avg - a.avg);
  const top = sorted.at(0);
  const bottom = sorted.at(-1);
  const spread = top && bottom ? Math.round(top.avg - bottom.avg) : 0;

  return (
    <div
      className="rounded-xl border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] p-8"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}
    >
      {/* header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
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
        {/* 🔴 출처를 화면에 박는다 — 경쟁사 4곳 공통 규율 */}
        <div
          className="flex items-center gap-2 text-[11px] text-[var(--findable-ink-tertiary)]"
          style={{ fontFamily: "var(--findable-font-mono)" }}
        >
          <span className="rounded-full border border-[var(--findable-primary)]/30 bg-[var(--findable-primary)]/10 px-2 py-0.5 text-[var(--findable-primary)]">
            {isKo ? "실측" : "Measured"}
          </span>
          <span>
            {isKo
              ? `K-뷰티 ${data.brandCount}사 · ${data.measuredAt}`
              : `${data.brandCount} K-beauty brands · ${data.measuredAt}`}
          </span>
        </div>
      </div>

      {/* 차트 — 모바일 3칸(칸폭 98px). 7칸 고정이면 33px 라 "HyperCLOVA"(70px)가 겹친다.
          엔진 7개는 제품의 핵심 주장이라 모바일에서도 하나도 숨기지 않는다. */}
      <div className="mt-8 grid grid-cols-3 gap-4 sm:grid-cols-7">
        {data.engines.map((engine) => (
          <EngineColumn engine={engine} key={engine.id} />
        ))}
      </div>

      {/* footer — 이 차트가 말하는 한 문장 */}
      <div className="mt-6 flex flex-col gap-2 border-[var(--findable-hairline)] border-t pt-4 text-[11px] sm:flex-row sm:items-center sm:justify-between">
        <p
          className="text-[var(--findable-ink-muted)]"
          style={{ fontFamily: "var(--findable-font-sans)" }}
        >
          {isKo ? (
            <>
              같은 브랜드인데{" "}
              <strong className="text-[var(--findable-ink)]">
                {top?.label} {Math.round(top?.avg ?? 0)}%
              </strong>{" "}
              ↔{" "}
              <strong className="text-[var(--findable-ink)]">
                {bottom?.label} {Math.round(bottom?.avg ?? 0)}%
              </strong>
              {spread > 0 ? ` — 엔진에 따라 ${spread}%p 갈립니다` : ""}
            </>
          ) : (
            <>
              Same brands, but{" "}
              <strong className="text-[var(--findable-ink)]">
                {top?.label} {Math.round(top?.avg ?? 0)}%
              </strong>{" "}
              vs{" "}
              <strong className="text-[var(--findable-ink)]">
                {bottom?.label} {Math.round(bottom?.avg ?? 0)}%
              </strong>
              {spread > 0 ? ` — a ${spread}pt spread across engines` : ""}
            </>
          )}
        </p>
        <a
          className="text-[var(--findable-primary)] hover:underline"
          href={`${lp}/research/k-geo-bench-v0_1`}
          style={{ fontFamily: "var(--findable-font-sans)" }}
        >
          {isKo ? "데이터셋 보기 →" : "View the dataset →"}
        </a>
      </div>
    </div>
  );
};

/** 엔진 1칸 — 점 = 브랜드 1곳의 실제 측정값 */
const EngineColumn = ({ engine }: { engine: EngineStat }) => {
  const color = ENGINE_COLOR[engine.id] ?? "#8a8f98";
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[120px] w-full sm:h-[200px]">
        <div
          className="absolute inset-0 rounded-md"
          style={{
            backgroundImage:
              "linear-gradient(to top, var(--findable-hairline) 1px, transparent 1px)",
            backgroundSize: "100% 25%",
            opacity: 0.5,
          }}
        />
        {/* 브랜드별 실측 점 — 가로 위치는 순서(겹침 방지), 세로는 값 */}
        {/* 🔴 인덱스를 key 에 쓰는 이유(biome noArrayIndexKey 억제):
              인덱스가 **좌표 그 자체**다 — 아래 `left: ((i + 0.5) / length) * 100%` 가
              i 로 가로 위치를 정한다. 같은 값(v)이 여러 번 나오는 것도 정상이라
              (같은 점유율이 반복될 수 있다) `id-v` 만으로는 key 가 **중복**된다.
              게다가 이 목록은 재정렬·중간삽입이 없다(측정 시계열은 append-only)
              → 인덱스 key 가 이 자리에선 올바른 선택이다. */}
        {engine.points.map((v, i) => (
          <span
            className="absolute h-2 w-2 rounded-full"
            // biome-ignore lint/suspicious/noArrayIndexKey: 인덱스가 좌표다(위 주석 참조)
            key={`${engine.id}-${v}-${i}`}
            style={{
              left: `${((i + 0.5) / engine.points.length) * 100}%`,
              bottom: `${v}%`,
              backgroundColor: color,
              opacity: 0.75,
              transform: "translate(-50%, 50%)",
            }}
          />
        ))}
        {/* 평균선 */}
        <span
          className="absolute right-0 left-0 h-px"
          style={{
            bottom: `${engine.avg}%`,
            backgroundColor: color,
            opacity: 0.5,
          }}
        />
      </div>

      <p
        className="mt-3 text-center text-[11px] text-[var(--findable-ink-muted)]"
        style={{ fontFamily: "var(--findable-font-sans)" }}
      >
        {engine.label}
      </p>
      <p
        className="text-[10px] text-[var(--findable-ink-tertiary)]"
        style={{ fontFamily: "var(--findable-font-mono)" }}
      >
        {Math.round(engine.avg)}%
        {/* 🔴 표본이 5사 미만이면 숨기지 말고 적는다(naver 는 3사만 유효) */}
        {engine.points.length < 5 ? ` · n=${engine.points.length}` : ""}
      </p>
    </div>
  );
};
