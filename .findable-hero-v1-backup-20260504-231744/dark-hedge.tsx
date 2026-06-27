// Findable 다크 헤지 — D-037 Adaline 75% 시점 전환 카피
// 자연 → 데이터 헤지 (라이트 → 다크) + Number Ticker 카운트업

import { DarkHedgeStats } from "./dark-hedge-stats";

const STATS = [
  {
    value: 89,
    suffix: "%",
    label: "SoV 정직 산정",
    sub: "기존 100% 거품 제거",
  },
  { value: 7, suffix: "개", label: "AI 엔진 동시 호출", sub: "한국 3 + 글로벌 4" },
  { value: 3, suffix: "분", label: "무료 진단 시간", sub: "도메인 입력 한 번" },
  { value: 0, suffix: "건", label: "한국어 GEO 경쟁", sub: "기관 투자 0건 (4-22 검증)" },
];

export const DarkHedge = () => {
  return (
    <section className="relative overflow-hidden bg-[color:var(--findable-sumi-950)] text-[color:var(--findable-mist-50)]">
      {/* 메쉬 그라디언트 — 다크 위 단청 청록 그림자 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background: `
            radial-gradient(at 15% 20%, oklch(0.42 0.090 200 / 0.25), transparent 50%),
            radial-gradient(at 85% 60%, oklch(0.78 0.135 85 / 0.10), transparent 55%),
            radial-gradient(at 50% 100%, oklch(0.72 0.135 28 / 0.08), transparent 60%)
          `,
        }}
      />

      <div className="relative mx-auto max-w-6xl px-6 py-24 md:py-32">
        <div className="grid gap-16 md:grid-cols-2 md:gap-12">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.18em] text-[color:var(--findable-gold-500)]">
              한국어 GEO 카테고리 1위
            </p>
            <h2
              className="mt-6 font-medium text-5xl leading-[1.1] tracking-tight md:text-6xl"
              style={{
                fontFamily:
                  '"Pretendard Variable", Pretendard, "Noto Serif KR", serif',
              }}
            >
              경쟁사 말고 우리 브랜드를,
              <br />
              <span className="text-[color:var(--findable-sunrise-500)]">
                AI가 먼저 답하게.
              </span>
            </h2>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-[color:var(--findable-mist-50)]/70">
              Princeton KDD'24 GEO + ICLR'26 AutoGEO 백본 위에
              <br />
              4 자율 에이전트가 작동하는 한국 최초 Agentic GEO Platform.
            </p>
          </div>

          <DarkHedgeStats stats={STATS} />
        </div>

        {/* 인용 */}
        <blockquote className="mt-20 border-[color:var(--findable-mist-50)]/15 border-t pt-10">
          <p
            className="max-w-3xl font-medium text-2xl leading-snug md:text-3xl"
            style={{
              fontFamily:
                '"Pretendard Variable", Pretendard, "Noto Serif KR", serif',
            }}
          >
            "Korean Entity Grounding은 K-뷰티 글로벌 마케팅의 숨은
            무기입니다."
          </p>
          <footer className="mt-5 text-sm text-[color:var(--findable-mist-50)]/55">
            — 메디큐브 마케팅팀 (베타 검증)
          </footer>
        </blockquote>
      </div>
    </section>
  );
};
