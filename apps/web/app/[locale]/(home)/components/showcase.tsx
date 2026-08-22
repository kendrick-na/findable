// Findable Showcase — 실측 데이터 2종 풀 화면 데모
// SoVChart(k-geo-bench) + CitationSources
// D-060 (2026-05-11): locale 분기 추가
//
// 🔴 2026-08-17 세션N-41 — 가짜 목업 2개를 지웠다(`AuditTrackerMock`·`AuditDiff`,
//   파일도 함께 삭제). 실측 근거:
//   ① 랜딩 모바일 11,463px 중 Showcase 가 3,637px = **32%** 로 최대 단일 섹션이었다
//   ② 그중 가짜 목업 2개가 1,609px(Monitor 703 + Diffs 906) → 지워서 **9,854px** 로 내렸다
//   ③ 남긴 2개는 `sample={false}` = **실측 데이터**다. Sources(인용출처)는
//      *"내 사이트만 고쳐선 AI 답변이 안 바뀐다"* 의 유일한 직접 증거라 지우면 안 된다.
//   ⭐ 부수 효과: 랜딩에서 「예시 화면」 배지가 **0개**가 됐다 —
//      가짜를 치우면 남은 게 진짜라는 게 배지 없이도 성립한다.
//   ⚠️ Monitor 섹션의 `/audit` CTA 1개가 같이 사라졌다. 히어로 2 · 푸터 1 ·
//      rent-vs-equity 1 = **4개가 남아** 전환 경로는 끊기지 않는다(삭제 전 실측).

import { ArrowRight } from "lucide-react";
import { CitationSources } from "./citation-sources";
import { SoVChart } from "./sov-chart";

interface ShowcaseProps {
  locale?: string;
}

export const Showcase = ({ locale = "ko" }: ShowcaseProps) => {
  const isKo = locale.startsWith("ko");
  const copy = isKo
    ? {
        s1Cta: "무료로 시작하기",
        s2Title: "우리 브랜드 답변 점유율, 한눈에.",
        s2Sub:
          "7개 AI가 답할 때마다 우리 브랜드와 경쟁 브랜드가 얼마나 인용되는지 시각화합니다.",
        s4Title: "AI는 우리 홈페이지를 잘 안 봅니다.",
        s4Sub:
          "실제로 측정해보면 AI가 브랜드를 말할 때 근거로 삼는 건 대부분 네이버 블로그와 위키입니다. 어디를 고쳐야 하는지가 여기서 갈립니다.",
      }
    : {
        s1Cta: "Start free",
        s2Title: "Your brand's share of voice, at a glance.",
        s2Sub:
          "Every time 7 AI engines answer, see how often your brand and competitors get cited.",
        s4Title: "AI barely reads your homepage.",
        s4Sub:
          "When we measure it, the sources AI leans on are mostly Naver blogs and wikis. That's where the work actually is.",
      };

  return (
    <section
      className="relative bg-[var(--findable-canvas)] px-8 pt-4 pb-12 md:pt-6 md:pb-16"
      id="showcase"
      style={{ scrollMarginTop: "72px" }}
    >
      <div className="mx-auto max-w-[1280px]">
        {/* Section 1: SoV Chart — 실측(k-geo-bench v0.1).
            CTA 는 원래 삭제된 Monitor 섹션에 있었다 → 첫 섹션인 여기로 옮겼다. */}
        <div className="mb-20">
          <SectionHeader
            cta={copy.s1Cta}
            ctaHref={`${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.findable.co.kr"}/sign-up`}
            isKo={isKo}
            label="Insights"
            sub={copy.s2Sub}
            title={copy.s2Title}
          />
          <MockFrame isKo={isKo} sample={false}>
            <SoVChart locale={locale} />
          </MockFrame>
        </div>

        {/* Section 3: 인용 출처 — 🔴 실측. 우리 차별점의 가장 직접적인 증거인데
            지금까지 랜딩 어디에도 없었다(로그인 후 화면에만 있었다).
            형식 근거 = Peec f005(실제 도메인 + 인용수 + 역할 태그). */}
        <div>
          <SectionHeader
            isKo={isKo}
            label="Sources"
            sub={copy.s4Sub}
            title={copy.s4Title}
          />
          <MockFrame isKo={isKo} sample={false}>
            <CitationSources locale={locale} />
          </MockFrame>
        </div>
      </div>
    </section>
  );
};

// 🔴 2026-08-16 — `sample` 을 옵션으로 뺐다.
//   SoV 차트가 **실측 데이터**(k-geo-bench v0.1)로 바뀌었는데 「예시 화면」 배지가 붙어 있으면
//   진짜 데이터를 스스로 가짜라고 말하는 꼴이다.
//   ⛔ v4 §6 확정사항 5: *"Peec 은 진짜 데이터에 `Sample` 이라 써서 스스로 신뢰를 깎는다"* —
//   같은 실수를 하지 않는다. 차트는 자체 헤더에 「실측 · 출처」를 단다.
const MockFrame = ({
  children,
  isKo = true,
  sample = true,
}: {
  children: React.ReactNode;
  isKo?: boolean;
  sample?: boolean;
}) => (
  <div className="relative">
    {sample ? (
      <span
        className="absolute top-3 right-3 z-10 rounded-full border border-[var(--findable-hairline-strong)] bg-[var(--findable-surface-2)] px-2.5 py-1 text-[11px] text-[var(--findable-ink-subtle)]"
        style={{ fontFamily: "var(--findable-font-sans)" }}
      >
        {isKo ? "예시 화면" : "Sample UI"}
      </span>
    ) : null}
    {children}
  </div>
);

const SectionHeader = ({
  label,
  title,
  sub,
  cta,
  ctaHref,
  isKo = true,
}: {
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
        className="text-[12px] text-[var(--findable-primary)] uppercase tracking-[0.18em]"
        style={{ fontFamily: "var(--findable-font-mono)" }}
      >
        {label}
      </p>
      <h2
        className="mt-4 text-[var(--findable-ink)]"
        style={{
          fontFamily: isKo
            ? "var(--findable-font-display-kr)"
            : "var(--findable-font-display)",
          fontSize: "clamp(26px, 3.2vw, 36px)",
          lineHeight: 1.2,
          // 한글은 정사각 격자 → 자간 0 (영문만 좁힌다)
          letterSpacing: isKo ? "0" : "-0.02em",
          fontWeight: 500,
          wordBreak: "keep-all",
        }}
      >
        {title}
      </h2>
      <p
        className="mt-4 text-[15px] text-[var(--findable-ink-muted)] leading-[1.6]"
        style={{
          fontFamily: "var(--findable-font-sans)",
          wordBreak: "keep-all",
        }}
      >
        {sub}
      </p>
    </div>
    {cta && ctaHref && (
      <a
        className="inline-flex items-center gap-1.5 text-[14px] text-[var(--findable-primary)] transition hover:gap-2.5"
        href={ctaHref}
        style={{ fontFamily: "var(--findable-font-sans)" }}
      >
        {cta}
        <ArrowRight className="h-3.5 w-3.5" />
      </a>
    )}
  </div>
);
