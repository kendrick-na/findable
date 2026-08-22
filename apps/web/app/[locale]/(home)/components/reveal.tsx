"use client";

// Reveal — IntersectionObserver 기반 fade-up stagger (Linear 시그니처, D-040)
// 사용: <Reveal stagger={60}><div /><div /></Reveal>

import { type ReactNode, useEffect, useRef } from "react";

interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number; // 첫 자식 시작 delay (ms)
  once?: boolean;
  stagger?: number; // 자식 간 delay (ms)
  threshold?: number;
}

export const Reveal = ({
  children,
  // stagger 80 → 60ms: 한 묶음에 자식이 5개면 80ms 는 마지막 항목이 320ms 늦게 시작한다
  // (0.4s 전환과 합쳐 0.72s). 60ms 면 240ms + 0.4s = 0.64s 로 medium 범위에 머문다.
  stagger = 60,
  delay = 0,
  threshold = 0.15,
  className,
  once = true,
}: RevealProps) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) {
      return;
    }

    const items = Array.from(
      root.querySelectorAll<HTMLElement>("[data-reveal-item]")
    );
    items.forEach((el, i) => {
      // 🔴 2026-08-15 모션 실측 — 0.6s + stagger 80ms 였다.
      //   스크롤할 때마다 반복되는 모션이라 **가장 자주 체감되는 지연**이다.
      //   MD3: 화면 안 요소가 자리를 옮기는 정도는 medium(250~400ms).
      //   이징도 MD3 표준 감속 cubic-bezier(0,0,0,1) 로 맞춘다("나타날 땐 감속").
      el.style.opacity = "0";
      el.style.transform = "translateY(16px)";
      el.style.transition = `opacity 0.4s cubic-bezier(0, 0, 0, 1) ${delay + i * stagger}ms, transform 0.4s cubic-bezier(0, 0, 0, 1) ${delay + i * stagger}ms`;
    });

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            for (const el of items) {
              el.style.opacity = "1";
              el.style.transform = "translateY(0)";
            }
            if (once) {
              observer.disconnect();
            }
          } else if (!once) {
            for (const el of items) {
              el.style.opacity = "0";
              el.style.transform = "translateY(16px)";
            }
          }
        }
      },
      { threshold, rootMargin: "0px 0px -10% 0px" }
    );
    observer.observe(root);

    return () => observer.disconnect();
  }, [stagger, delay, threshold, once]);

  return (
    <div className={className} ref={ref}>
      {children}
    </div>
  );
};
