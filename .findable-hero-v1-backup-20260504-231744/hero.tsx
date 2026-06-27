// Findable Hero — D-033 자연 일러스트 헤지 + D-037 시네마틱 모션
// Server Component: 정적 헤드라인·CTA 렌더 (next-forge 컨벤션)
// Client interactivity는 leaf 파일(hero-tone.tsx)로 분리

import { Button } from "@repo/design-system/components/ui/button";
import type { Dictionary } from "@repo/internationalization";
import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { env } from "@/env";
import { HeroTone } from "./hero-tone";

const ENGINES = [
  "ChatGPT",
  "HyperCLOVA",
  "Perplexity",
  "네이버",
  "Claude",
  "다음",
  "Gemini",
];

interface HeroProps {
  dictionary: Dictionary;
}

export const Hero = ({ dictionary }: HeroProps) => {
  return (
    <HeroTone>
      {/* Multiply blend overlay — 산수화 위 콘텐츠 가독성 향상 */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--findable-hero-bg)]/40 pointer-events-none z-[1]"
      />

      {/* 컨텐츠 */}
      <div className="relative z-10 mx-auto flex min-h-[90vh] max-w-6xl flex-col items-center justify-center px-6 py-20 text-center">
        {/* Series A 칩 — 페이드업 200ms */}
        <div
          className="opacity-0"
          style={{
            animation:
              "findable-fade-up-sm 0.6s var(--findable-ease-out-quint) 0.2s forwards",
          }}
        >
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 rounded-full border border-[color:var(--findable-hero-fg)]/15 bg-[color:var(--findable-hero-bg)]/60 px-4 py-1.5 text-sm font-medium text-[color:var(--findable-hero-fg)] backdrop-blur-md transition-all hover:scale-[1.02] hover:bg-[color:var(--findable-hero-bg)]/80"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>한국 최초 Agentic GEO Platform</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* 헤드라인 — 페이드업 400ms */}
        <h1
          className="mt-10 max-w-4xl font-serif text-[clamp(2.5rem,6vw,5.5rem)] font-medium leading-[1.05] tracking-tight text-[color:var(--findable-hero-fg)] opacity-0"
          style={{
            animation:
              "findable-fade-up 0.8s var(--findable-ease-cinema) 0.4s forwards",
            fontFamily:
              '"Pretendard Variable", Pretendard, "Noto Serif KR", serif',
          }}
        >
          AI는 우리 브랜드를
          <br />
          추천하고 있나요?
        </h1>

        {/* 영문 sub */}
        <p
          className="mt-4 max-w-2xl text-lg text-[color:var(--findable-hero-fg)]/70 opacity-0"
          style={{
            animation:
              "findable-fade-up-sm 0.6s var(--findable-ease-out-soft) 0.7s forwards",
          }}
        >
          Is AI recommending your brand?
        </p>

        {/* 7 AI 엔진 — stagger 80ms */}
        <div className="mt-8 flex flex-wrap justify-center gap-x-3 gap-y-2 text-sm text-[color:var(--findable-hero-fg)]/80 md:text-base">
          {ENGINES.map((engine, i) => (
            <span
              key={engine}
              className="opacity-0"
              style={{
                animation: `findable-fade-up-sm 0.4s var(--findable-ease-out-soft) ${1.0 + i * 0.08}s forwards`,
              }}
            >
              {engine}
              {i < ENGINES.length - 1 && (
                <span className="ml-3 opacity-40">·</span>
              )}
            </span>
          ))}
        </div>

        {/* CTA — 1.5s */}
        <div
          className="mt-12 flex flex-col items-center gap-3 opacity-0 sm:flex-row"
          style={{
            animation:
              "findable-pop-in 0.5s var(--findable-ease-out-quint) 1.5s forwards",
          }}
        >
          <Button asChild size="lg" className="gap-2 rounded-full px-7">
            <Link href="/audit">
              {dictionary?.web?.home?.hero?.primaryCta ?? "무료 진단 받기 (3분)"}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="gap-2 rounded-full px-7 backdrop-blur-md">
            <Link href={env.NEXT_PUBLIC_APP_URL}>
              {dictionary?.web?.home?.hero?.secondaryCta ?? "전문가 상담"}
            </Link>
          </Button>
        </div>

        {/* TRUSTED BY — 1.8s */}
        <div
          className="mt-16 opacity-0"
          style={{
            animation: "findable-fade-up-sm 0.4s linear 1.8s forwards",
          }}
        >
          <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--findable-hero-fg)]/50">
            Trusted by leading K-Beauty Brands
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-[color:var(--findable-hero-fg)]/40">
            <span>메디큐브</span>
            <span>아누아</span>
            <span>조선미녀</span>
            <span>라운드랩</span>
            <span>토니모리</span>
          </div>
        </div>
      </div>
    </HeroTone>
  );
};
