"use client";

// HeroTone — 시간대 동적 배경 (D-037 GIC 카피)
// 사용자 KST 시각 → 4종 산수화 자동 전환 (dawn/day/dusk/night)

import Image from "next/image";
import { type ReactNode, useEffect, useState } from "react";

type Tone = "dawn" | "day" | "dusk" | "night";

const TONE_BY_HOUR = (h: number): Tone => {
  if (h < 7) return "dawn";
  if (h < 17) return "day";
  if (h < 20) return "dusk";
  return "night";
};

interface HeroToneProps {
  children: ReactNode;
}

export const HeroTone = ({ children }: HeroToneProps) => {
  // SSR 안전: 초기엔 'day' (가장 중성)로 렌더 → 클라이언트에서 시각 감지 후 갱신
  const [tone, setTone] = useState<Tone>("day");

  useEffect(() => {
    const update = () => setTone(TONE_BY_HOUR(new Date().getHours()));
    update();
    // 1시간마다 자동 갱신 (긴 세션 대응)
    const id = setInterval(update, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // night 톤은 산수가 검은 배경에 묻히므로 blend mode를 screen으로 (밝은 부분 살림)
  // 그 외는 multiply (원본 톤 유지하면서 배경에 블렌딩)
  const isDark = tone === "night";

  return (
    <section
      data-tone={tone}
      className="relative w-full overflow-hidden bg-[color:var(--findable-hero-bg)] transition-colors duration-1000"
      style={{ transitionTimingFunction: "var(--findable-ease-cinema)" }}
    >
      {/* 산수화 배경 — scale-in 2s */}
      <div
        className={`pointer-events-none absolute inset-0 opacity-0 ${
          isDark ? "mix-blend-screen" : "mix-blend-multiply"
        }`}
        style={{
          animation:
            "findable-scale-in 2s var(--findable-ease-cinema) 0s forwards",
        }}
      >
        <Image
          src={`/illustrations/jeong-seon-${tone}.webp`}
          alt="정선 「금강전도」 — 한국 산수화"
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      </div>

      {/* night 톤: 산수 위에 어두운 그라디언트 추가 (텍스트 가독성) */}
      {isDark && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[color:var(--findable-sumi-950)]/50 via-transparent to-[color:var(--findable-sumi-950)]/70"
        />
      )}

      {children}
    </section>
  );
};
