// 임대 vs 적립 (Rent vs Equity) — 소유권 서사 섹션 (D-2026-07-23 포지셔닝 전환)
//
// 목적:
//   "광고·SEO=매달 태우는 임대 / GEO=브랜드에 적립되는 지분" 세계관을 선언.
//   서브스택의 "당신이 소유하는 관계" 서사를 차용하되, GEO 맥락에선
//   "소유"보다 "적립되는 지분"이 정직(노출은 완전히 내 소유가 아니므로).
//
// 카피 출처: 서브스택_결합_기획/포지셔닝_서사_시안.md §4 (사용자 확정안).
// ⚠️ "복리로 쌓인다"는 방향성 논리 → 카피에 "추정" 명시. 정량 보장 아님.
//
// 홈 디자인 토큰(--findable-*)·Reveal 래퍼는 기존 홈 섹션(three-pillars 등) 미러.

import { Reveal } from "./reveal";

interface Props {
  locale?: string;
}

interface Row {
  equity: string;
  rent: string;
}

const ROWS_KO: Row[] = [
  {
    rent: "검색 광고 · 배너 — 결제 멈추면 즉시 소멸",
    equity: "AI 인용 자산 — 답변이 바뀌어도 축적된 정합성은 남음",
  },
  {
    rent: "매달 같은 돈, 같은 자리 (복리 없음)",
    equity: "쌓일수록 인용될 확률이 올라감 (복리 추정)",
  },
  {
    rent: "플랫폼이 규칙을 바꾸면 리셋",
    equity: "브랜드 팩트 정합성은 엔진이 바뀌어도 이전됨",
  },
  {
    rent: "성과 = 이번 달 지출",
    equity: "성과 = 그동안 쌓은 AI 신뢰",
  },
];

const ROWS_EN: Row[] = [
  {
    rent: "Search ads · banners — gone the moment you stop paying",
    equity: "AI citation assets — accrued consistency stays as answers change",
  },
  {
    rent: "Same money, same slot, every month (no compounding)",
    equity: "The more it accrues, the likelier you're cited (est. compounding)",
  },
  {
    rent: "Reset whenever the platform changes its rules",
    equity: "Brand-fact consistency transfers even as engines change",
  },
  {
    rent: "Performance = this month's spend",
    equity: "Performance = the AI trust you've built up",
  },
];

export const RentVsEquity = ({ locale = "ko" }: Props) => {
  const isKo = locale.startsWith("ko");
  const lp = isKo ? "/ko" : "";
  const rows = isKo ? ROWS_KO : ROWS_EN;

  const eyebrow = isKo ? "임대 vs 적립" : "Rent vs Equity";
  const heading = isKo
    ? "광고는 태우고, GEO는 쌓입니다."
    : "Ads burn. GEO compounds.";
  const lead = isKo
    ? "검색 광고와 SEO는 매달 비용을 지불하는 순간에만 존재합니다. 결제를 멈추면 노출도 사라지는 임대입니다. GEO는 다릅니다. AI가 당신을 정확히·자주 인용하도록 만든 노출은, 다음 답변에도·다음 모델에도 남습니다. 태우는 비용이 아니라 브랜드에 적립되는 지분입니다."
    : "Search ads and SEO exist only while you keep paying — stop, and your visibility disappears. That's rent. GEO is different. Once you make AI cite you accurately and often, that visibility carries into the next answer and the next model. Not a burn rate — equity that accrues to your brand.";
  const rentHead = isKo ? "빌린 노출 (임대)" : "Borrowed visibility (Rent)";
  const equityHead = isKo
    ? "적립되는 노출 (지분)"
    : "Accruing visibility (Equity)";
  const closing = isKo
    ? "지금 시작한 브랜드가, 1년 뒤 AI 답변의 기본값이 됩니다. 임대를 멈추고, 지분을 쌓으세요."
    : "The brand that starts now becomes the default answer a year from now. Stop renting. Start building equity.";
  const cta = isKo
    ? "내 AI 노출 자산 진단하기 (무료)"
    : "Audit my AI visibility assets (free)";

  return (
    <section className="bg-[var(--findable-canvas)] px-8 pt-8 pb-14 md:pt-10 md:pb-16">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-10 max-w-[760px]">
          <p
            className="text-[12px] text-[var(--findable-primary)] uppercase tracking-[0.18em]"
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {eyebrow}
          </p>
          <h2
            className="mt-4 text-[var(--findable-ink)]"
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
          <p
            className="mt-5 text-[16px] text-[var(--findable-ink-muted)] leading-[1.7]"
            style={{
              fontFamily: "var(--findable-font-sans)",
              wordBreak: "keep-all",
            }}
          >
            {lead}
          </p>
        </div>

        {/* 대조 2열 */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* 임대 (좌) — 소멸/무채색 톤 */}
          <div
            className="rounded-xl border border-white/[0.06] bg-[var(--findable-surface-1)] p-7"
            style={{
              boxShadow: "0 24px 48px -16px rgba(0,0,0,0.5)",
            }}
          >
            <div
              className="text-[13px] text-[var(--findable-ink-tertiary)] uppercase tracking-[0.14em]"
              style={{ fontFamily: "var(--findable-font-mono)" }}
            >
              {rentHead}
            </div>
            <Reveal className="mt-5 space-y-3" stagger={80}>
              {rows.map((r) => (
                <div
                  className="flex items-start gap-2.5 text-[15px] text-[var(--findable-ink-subtle)] leading-[1.6]"
                  data-reveal-item
                  key={r.rent}
                  style={{
                    fontFamily: "var(--findable-font-sans)",
                    wordBreak: "keep-all",
                  }}
                >
                  <span className="mt-2 h-1 w-3 shrink-0 rounded-full bg-[var(--findable-ink-tertiary)]/40" />
                  {r.rent}
                </div>
              ))}
            </Reveal>
          </div>

          {/* 적립 (우) — 축적/프라이머리 톤 */}
          <div
            className="relative overflow-hidden rounded-xl border border-[var(--findable-primary)]/25 bg-[var(--findable-surface-1)] p-7 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-[var(--findable-primary)]/40 before:to-transparent"
            style={{
              boxShadow: "0 24px 48px -16px rgba(0,0,0,0.5)",
            }}
          >
            <div
              className="text-[13px] text-[var(--findable-primary)] uppercase tracking-[0.14em]"
              style={{ fontFamily: "var(--findable-font-mono)" }}
            >
              {equityHead}
            </div>
            <Reveal className="mt-5 space-y-3" stagger={80}>
              {rows.map((r) => (
                <div
                  className="flex items-start gap-2.5 text-[15px] text-[var(--findable-ink)] leading-[1.6]"
                  data-reveal-item
                  key={r.equity}
                  style={{
                    fontFamily: "var(--findable-font-sans)",
                    wordBreak: "keep-all",
                  }}
                >
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--findable-primary)]" />
                  {r.equity}
                </div>
              ))}
            </Reveal>
          </div>
        </div>

        {/* 마무리 + CTA */}
        <div className="mt-10 flex flex-col items-start gap-5 md:flex-row md:items-center md:justify-between">
          <p
            className="max-w-[640px] text-[17px] text-[var(--findable-ink)] leading-[1.6]"
            style={{
              fontFamily: "var(--findable-font-sans)",
              fontWeight: 500,
              wordBreak: "keep-all",
            }}
          >
            {closing}
          </p>
          <a
            className="findable-btn-primary flex h-11 shrink-0 items-center rounded-md bg-[var(--findable-ink)] px-5 font-medium text-[14px] text-[var(--findable-canvas)] transition hover:bg-[var(--findable-ink-muted)]"
            href={`${lp}/audit`}
            style={{ fontFamily: "var(--findable-font-sans)" }}
          >
            {cta}
          </a>
        </div>
      </div>
    </section>
  );
};
