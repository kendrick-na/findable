"use client";

// StepsClient — IntersectionObserver로 활성 step 추적 (D-037 Adaline 카피)

import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Step {
  num: string;
  ko: string;
  en: string;
  title: string;
  body: string;
  bullets: string[];
}

interface StepsClientProps {
  steps: Step[];
}

export const StepsClient = ({ steps }: StepsClientProps) => {
  const [active, setActive] = useState(0);
  const sectionsRef = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // threshold 통과한 가장 최근 step 활성화
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          const idx = Number(visible.target.getAttribute("data-step-idx"));
          setActive(idx);
        }
      },
      { threshold: [0.4, 0.6], rootMargin: "-10% 0px -30% 0px" },
    );
    for (const el of sectionsRef.current) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* Sticky 인디케이터 — next-forge Header(h~64px) 아래 배치 */}
      <nav className="sticky top-16 z-20 border-b border-[color:var(--findable-sumi-900)]/8 bg-[color:var(--findable-mist-50)]/95 backdrop-blur-xl">
        <ol className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-5 md:gap-6">
          {steps.map((s, i) => {
            const isActive = i === active;
            const isPast = i < active;
            return (
              <li
                key={s.num}
                className="flex flex-1 items-center gap-3 transition-all duration-700"
                style={{
                  transitionTimingFunction: "var(--findable-ease-cinema)",
                }}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-medium transition-all duration-700 ${
                    isActive
                      ? "scale-110 border-[color:var(--findable-sumi-900)] bg-[color:var(--findable-sumi-900)] text-[color:var(--findable-mist-50)] shadow-lg"
                      : isPast
                        ? "border-[color:var(--findable-dancheong-500)] bg-[color:var(--findable-dancheong-500)] text-white"
                        : "border-[color:var(--findable-sumi-900)]/20 text-[color:var(--findable-sumi-900)]/40"
                  }`}
                  style={{
                    transitionTimingFunction: "var(--findable-ease-cinema)",
                  }}
                >
                  {isPast ? <Check className="h-4 w-4" /> : s.num}
                </span>
                <div className="hidden flex-col md:flex">
                  <span
                    className={`text-sm font-medium transition-opacity duration-500 ${
                      isActive
                        ? "text-[color:var(--findable-sumi-900)]"
                        : "text-[color:var(--findable-sumi-900)]/40"
                    }`}
                  >
                    {s.ko}
                  </span>
                  <span
                    className={`font-serif text-[11px] italic transition-opacity duration-500 ${
                      isActive
                        ? "text-[color:var(--findable-sumi-900)]/60"
                        : "text-[color:var(--findable-sumi-900)]/25"
                    }`}
                  >
                    {s.en}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <span
                    className={`hidden h-px flex-1 transition-colors duration-700 md:block ${
                      isPast
                        ? "bg-[color:var(--findable-dancheong-500)]"
                        : "bg-[color:var(--findable-sumi-900)]/15"
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* 4 화면 */}
      {steps.map((s, i) => (
        <article
          key={s.num}
          ref={(el) => {
            sectionsRef.current[i] = el;
          }}
          data-step-idx={i}
          className="flex min-h-[90vh] items-center px-6 py-24"
        >
          <div className="mx-auto grid w-full max-w-6xl gap-12 md:grid-cols-2 md:gap-16">
            <div>
              <p className="text-sm font-mono uppercase tracking-[0.18em] text-[color:var(--findable-sumi-900)]/40">
                {s.num} / 04
              </p>
              <h2
                className="mt-6 font-medium text-5xl leading-[1.1] tracking-tight md:text-6xl"
                style={{
                  fontFamily:
                    '"Pretendard Variable", Pretendard, "Noto Serif KR", serif',
                }}
              >
                {s.ko}
              </h2>
              <p className="mt-2 font-serif text-2xl italic text-[color:var(--findable-sumi-900)]/45">
                {s.en}
              </p>
              <h3 className="mt-10 font-semibold text-2xl leading-snug">
                {s.title}
              </h3>
              <p className="mt-4 text-lg leading-relaxed text-[color:var(--findable-sumi-900)]/70">
                {s.body}
              </p>
              <ul className="mt-8 space-y-3">
                {s.bullets.map((bullet) => (
                  <li
                    key={bullet}
                    className="flex items-start gap-3 text-[15px] text-[color:var(--findable-sumi-900)]/80"
                  >
                    <span className="mt-2 h-1 w-1 flex-shrink-0 rounded-full bg-[color:var(--findable-dancheong-500)]" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* 시각 영역 — 단계별 아트워크 placeholder */}
            <div className="relative aspect-[4/5] overflow-hidden rounded-3xl border border-[color:var(--findable-sumi-900)]/8 bg-gradient-to-br from-[color:var(--findable-mist-50)] via-[color:var(--findable-mist-100)] to-[color:var(--findable-sunrise-300)]/15">
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="font-serif text-9xl text-[color:var(--findable-sumi-900)]/8">
                  {s.num}
                </span>
              </div>
              <div className="absolute right-6 bottom-6 left-6 rounded-xl border border-[color:var(--findable-sumi-900)]/10 bg-[color:var(--findable-mist-50)]/80 p-4 backdrop-blur-md">
                <p className="text-xs font-mono text-[color:var(--findable-sumi-900)]/60">
                  STEP {s.num}
                </p>
                <p className="mt-1 font-medium text-sm text-[color:var(--findable-sumi-900)]">
                  {s.ko} — {s.en}
                </p>
              </div>
            </div>
          </div>
        </article>
      ))}
    </>
  );
};
