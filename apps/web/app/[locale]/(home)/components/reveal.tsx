"use client";

// Reveal — IntersectionObserver 기반 fade-up stagger (Linear 시그니처, D-040)
// 사용: <Reveal stagger={80}><div /><div /></Reveal>

import { type ReactNode, useEffect, useRef } from "react";

interface RevealProps {
  children: ReactNode;
  stagger?: number; // 자식 간 delay (ms)
  delay?: number; // 첫 자식 시작 delay (ms)
  threshold?: number;
  className?: string;
  once?: boolean;
}

export const Reveal = ({
  children,
  stagger = 80,
  delay = 0,
  threshold = 0.15,
  className,
  once = true,
}: RevealProps) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal-item]"));
    items.forEach((el, i) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(16px)";
      el.style.transition = `opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${delay + i * stagger}ms, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${delay + i * stagger}ms`;
    });

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            for (const el of items) {
              el.style.opacity = "1";
              el.style.transform = "translateY(0)";
            }
            if (once) observer.disconnect();
          } else if (!once) {
            for (const el of items) {
              el.style.opacity = "0";
              el.style.transform = "translateY(16px)";
            }
          }
        }
      },
      { threshold, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(root);

    return () => observer.disconnect();
  }, [stagger, delay, threshold, once]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
};
