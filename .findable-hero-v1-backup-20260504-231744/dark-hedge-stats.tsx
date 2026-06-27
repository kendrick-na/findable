"use client";

// DarkHedgeStats — Number Ticker 카운트업 (Magic UI 패턴 자체 구현)
// IntersectionObserver + requestAnimationFrame으로 진입 시 1.5초 카운트업

import { useEffect, useRef, useState } from "react";

interface Stat {
  value: number;
  suffix: string;
  label: string;
  sub: string;
}

interface DarkHedgeStatsProps {
  stats: Stat[];
}

const DURATION_MS = 1500;
const EASE_OUT_QUINT = (t: number) => 1 - (1 - t) ** 5;

export const DarkHedgeStats = ({ stats }: DarkHedgeStatsProps) => {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[color:var(--findable-mist-50)]/8">
      {stats.map((s) => (
        <Tile key={s.label} stat={s} />
      ))}
    </div>
  );
};

const Tile = ({ stat }: { stat: Stat }) => {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && !startedRef.current) {
          startedRef.current = true;
          const start = performance.now();
          const target = stat.value;
          const tick = (now: number) => {
            const elapsed = now - start;
            const t = Math.min(elapsed / DURATION_MS, 1);
            const eased = EASE_OUT_QUINT(t);
            setDisplay(Math.round(target * eased));
            if (t < 1) {
              requestAnimationFrame(tick);
            }
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [stat.value]);

  return (
    <div
      ref={ref}
      className="flex flex-col gap-2 bg-[color:var(--findable-sumi-950)] p-6 transition-colors hover:bg-[color:var(--findable-sumi-900)] md:p-8"
    >
      <div
        className="font-medium text-5xl tracking-tight md:text-6xl"
        style={{
          fontFamily:
            '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {display.toLocaleString()}
        <span className="ml-1 text-2xl text-[color:var(--findable-gold-500)] md:text-3xl">
          {stat.suffix}
        </span>
      </div>
      <div className="mt-1 font-medium text-sm">{stat.label}</div>
      <div className="text-[color:var(--findable-mist-50)]/45 text-xs">
        {stat.sub}
      </div>
    </div>
  );
};
