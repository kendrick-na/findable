// Findable Showcase — Linear 시그니처 mock 3종 풀 화면 데모
// AuditTrackerMock + SoVChart + AuditDiff
// D-060 (2026-05-11): locale 분기 추가

import { ArrowRight } from "lucide-react";
import { AuditDiff } from "./audit-diff";
import { AuditTrackerMock } from "./audit-tracker-mock";
import { SoVChart } from "./sov-chart";

interface ShowcaseProps {
  locale?: string;
}

export const Showcase = ({ locale = "ko" }: ShowcaseProps) => {
  const isKo = locale.startsWith("ko");
  const lp = isKo ? "/ko" : "";
  const copy = isKo
    ? {
        s1Title: "모든 진단을 한 곳에서, 에이전트와 함께.",
        s1Sub: "진행 중인 모든 진단·인용 갭·추천 액션을 워크스페이스 한 곳에서 추적합니다.",
        s1Cta: "무료로 진단받기",
        s2Title: "우리 브랜드 답변 점유율, 한눈에.",
        s2Sub: "7개 AI가 답할 때마다 우리 브랜드와 경쟁 브랜드가 얼마나 인용되는지 시각화합니다.",
        s3Title: "적용 전과 후, 바로 비교해보세요.",
        s3Sub: "Findable이 제안한 콘텐츠 변경이 인용 점수와 점유율에 어떤 영향을 줄지 미리 봅니다.",
      }
    : {
        s1Title: "All your audits in one place — with agents.",
        s1Sub: "Track every in-progress audit, citation gap, and recommended action in a single workspace.",
        s1Cta: "Get a free audit",
        s2Title: "Your brand's share of voice, at a glance.",
        s2Sub: "Every time 7 AI engines answer, see how often your brand and competitors get cited.",
        s3Title: "Compare before and after, instantly.",
        s3Sub: "Preview how Findable's suggested content changes affect citation scores and share of voice.",
      };

  return (
    <section
      id="showcase"
      className="relative bg-[var(--findable-canvas)] px-8 pt-4 pb-12 md:pt-6 md:pb-16"
      style={{ scrollMarginTop: "72px" }}
    >
      <div className="mx-auto max-w-[1280px]">
        {/* Section 1: Audit Tracker — 작동하는 CTA */}
        <div className="mb-20">
          <SectionHeader
            num="5.0"
            label="Monitor"
            title={copy.s1Title}
            sub={copy.s1Sub}
            cta={copy.s1Cta}
            ctaHref={`${lp}/audit`}
            isKo={isKo}
          />
          <AuditTrackerMock locale={locale} />
        </div>

        {/* Section 2: SoV Chart */}
        <div className="mb-20">
          <SectionHeader
            num="6.0"
            label="Insights"
            title={copy.s2Title}
            sub={copy.s2Sub}
            isKo={isKo}
          />
          <SoVChart locale={locale} />
        </div>

        {/* Section 3: Audit Diff */}
        <div>
          <SectionHeader
            num="7.0"
            label="Diffs"
            title={copy.s3Title}
            sub={copy.s3Sub}
            isKo={isKo}
          />
          <AuditDiff />
        </div>
      </div>
    </section>
  );
};

const SectionHeader = ({
  num,
  label,
  title,
  sub,
  cta,
  ctaHref,
  isKo = true,
}: {
  num: string;
  label: string;
  title: string;
  sub: string;
  cta?: string;
  ctaHref?: string;
  isKo?: boolean;
}) => (
  <div className="mb-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
    <div className="max-w-[700px]" style={{ wordBreak: "keep-all" }}>
      <p
        className="flex items-center gap-2 text-[12px] uppercase tracking-[0.18em]"
        style={{ fontFamily: "var(--findable-font-mono)" }}
      >
        <span className="text-[var(--findable-primary)]">{num}</span>
        <span className="text-[var(--findable-ink-subtle)]">— {label}</span>
      </p>
      <h2
        className="mt-4 text-[var(--findable-ink)]"
        style={{
          fontFamily: isKo
            ? "var(--findable-font-display-kr)"
            : "var(--findable-font-display)",
          fontSize: "clamp(26px, 3.2vw, 36px)",
          lineHeight: 1.2,
          letterSpacing: "-0.02em",
          fontWeight: 500,
          wordBreak: "keep-all",
        }}
      >
        {title}
      </h2>
      <p
        className="mt-4 text-[15px] leading-[1.6] text-[var(--findable-ink-muted)]"
        style={{ fontFamily: "var(--findable-font-sans)", wordBreak: "keep-all" }}
      >
        {sub}
      </p>
    </div>
    {cta && ctaHref && (
      <a
        href={ctaHref}
        className="inline-flex items-center gap-1.5 text-[14px] text-[var(--findable-primary)] transition hover:gap-2.5"
        style={{ fontFamily: "var(--findable-font-sans)" }}
      >
        {cta}
        <ArrowRight className="h-3.5 w-3.5" />
      </a>
    )}
  </div>
);
