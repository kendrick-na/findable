// /blog — 베타 단계 Coming Soon (BASEHUB feed 미설정)
// 출시 후 BASEHUB 콘텐츠 채우면 정상 활성화
// D-061 (2026-05-12): locale 분기 추가

import { createMetadata } from "@repo/seo/metadata";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

interface BlogProps {
  params: Promise<{ locale: string }>;
}

export const generateMetadata = async ({
  params,
}: BlogProps): Promise<Metadata> => {
  const { locale } = await params;
  const isKo = locale.startsWith("ko");
  return createMetadata({
    title: isKo ? "리소스" : "Resources",
    description: isKo
      ? "GEO 가이드, 사례 연구, 학술 인사이트. 곧 첫 번째 콘텐츠가 발행됩니다."
      : "GEO guides, case studies, and academic insights. First content publishing soon.",
  });
};

const BlogIndex = async ({ params }: BlogProps) => {
  const { locale } = await params;
  const isKo = locale.startsWith("ko");
  const lp = isKo ? "/ko" : "";
  const copy = isKo
    ? {
        eyebrow: "리소스",
        h1: "첫 번째 GEO 가이드, 곧 만나요.",
        sub: "한국어 AI 답변 최적화 가이드, 사례 연구, Princeton GEO 학술 인사이트를 준비하고 있어요. 출시되면 가장 먼저 알려드릴게요.",
        cta: "무료 진단부터 시작하기",
      }
    : {
        eyebrow: "Resources",
        h1: "Our first GEO guide is coming soon.",
        sub: "We're preparing AI-answer optimization guides, case studies, and Princeton GEO academic insights. You'll be the first to know when they ship.",
        cta: "Start with a free audit",
      };

  return (
    <div className="min-h-screen w-full bg-[var(--findable-canvas)] text-[var(--findable-ink)]">
      <div className="mx-auto flex min-h-[80vh] max-w-3xl flex-col items-center justify-center px-6 py-24 text-center">
        <p
          className="text-[12px] uppercase tracking-[0.18em] text-[var(--findable-primary)]"
          style={{ fontFamily: "var(--findable-font-sans)" }}
        >
          {copy.eyebrow}
        </p>
        <h1
          className="mt-4"
          style={{
            fontFamily: isKo
              ? "var(--findable-font-display-kr)"
              : "var(--findable-font-display)",
            fontSize: "clamp(36px, 4.5vw, 56px)",
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            fontWeight: 500,
            wordBreak: "keep-all",
          }}
        >
          {copy.h1}
        </h1>
        <p
          className="mt-5 max-w-[520px] text-[16px] leading-[1.6] text-[var(--findable-ink-muted)]"
          style={{ fontFamily: "var(--findable-font-sans)" }}
        >
          {copy.sub}
        </p>
        <Link
          href={`${lp}/audit`}
          className="mt-10 flex h-11 items-center gap-2 rounded-md bg-[var(--findable-ink)] px-5 font-medium text-[14px] text-[var(--findable-canvas)] transition hover:bg-[var(--findable-ink-muted)]"
          style={{ fontFamily: "var(--findable-font-sans)" }}
        >
          {copy.cta}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
};

export default BlogIndex;
