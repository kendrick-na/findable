"use client";

import { cn } from "@repo/design-system/lib/utils";
import type { ReactNode } from "react";

/**
 * 온보딩 **껍데기** — 단계 표시 + 2단 레이아웃(좌 입력 / 우 설명).
 * 📕 설계 = `재설계안_v4` §7-D-1-b(2단) · §7-D-2(모션) · §7-D-3(비주얼) · 👤 승인 2026-08-19.
 *
 * ⛔ **여기서 하지 않는 것**(전부 근거 있는 제외):
 *   · 장식 애니메이션·파티클·컨페티 — 📕설계 v2 §3-2
 *   · 큰 그래픽 2개 이상 — 화면당 최대 1개
 *   · ms·이징 수치 인용 — 1차 출처 0건이라 **지어내지 않는다**
 *   · 투어 툴팁 — 터치에 없다(📕N-41)
 *
 * ⚠️ **`prefers-reduced-motion`**: 전환은 `opacity`/`transform` 만 쓰고, 감소 설정이면
 *   즉시 전환된다(아래 `motion-reduce:transition-none`). 기획서 §9-2(a).
 */

export interface WelcomeShellProps {
  /** 우측 설명·데모. 없으면 좌측이 전체 폭을 쓴다(1·3단계처럼 입력이 주인공일 때). */
  aside?: ReactNode;
  children: ReactNode;
  /** 현재 단계(1부터). */
  current: number;
  description: string;
  /** 주 행동. 라벨과 동작을 단계가 정한다. */
  primary: { disabled?: boolean; label: string; onClick: () => void };
  /**
   * 건너뛰기. 🔴 **주 CTA 와 같은 위계**로 렌더된다(회색 작은 글씨 금지) —
   * 전자상거래법 「잘못된 계층구조」(v4 §7-D-4).
   */
  skip?: { label: string; onClick: () => void };
  /** "{current}단계 / {total}단계" 형식 문자열(사전). 자리표시자를 뷰가 채운다. */
  stepOfTemplate: string;
  title: string;
  /** 전체 단계 수. */
  total: number;
}

export const WelcomeShell = ({
  aside,
  children,
  current,
  description,
  primary,
  skip,
  stepOfTemplate,
  title,
  total,
}: WelcomeShellProps) => (
  <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
    {/* 진행 표시 — 📕S7-2차: `STEP` 이 아니라 한국어 「N단계」. */}
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
          {stepOfTemplate
            .replace("{current}", String(current))
            .replace("{total}", String(total))}
        </span>
      </div>
      {/* 진행 막대 — 큰 그래픽이 아니라 얇은 선(장식 아님·상태 표시). */}
      <div
        aria-hidden="true"
        className="h-1 w-full overflow-hidden rounded-full bg-[color:var(--findable-hairline,#23252a)]"
      >
        <div
          className="h-full rounded-full bg-[color:var(--findable-primary,#ff7a4d)] transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${Math.round((current / total) * 100)}%` }}
        />
      </div>
    </div>

    {/* 🔴 한국어 줄바꿈: `keep-all` 없으면 「골라보세/요」로 끊긴다(설계 v3 §5-1 절대규칙). */}
    <div className="flex flex-col gap-2 [word-break:keep-all]">
      <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
        {title}
      </h1>
      <p className="max-w-2xl text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
        {description}
      </p>
    </div>

    {/* 2단 — 모바일(390)은 세로 스택. 입력이 **위**에 온다(우측 설명보다 먼저 보여야 한다). */}
    <div
      className={cn(
        "grid flex-1 items-start gap-6",
        aside ? "md:grid-cols-2" : "md:grid-cols-1"
      )}
    >
      <div className="findable-card flex flex-col gap-4 p-6">{children}</div>
      {aside ? (
        <div className="order-last flex flex-col gap-3 [word-break:keep-all]">
          {aside}
        </div>
      ) : null}
    </div>

    {/* 🔴 건너뛰기와 주 CTA 는 **같은 크기·같은 위계**다(§7-D-4 「잘못된 계층구조」). */}
    <div className="flex flex-wrap items-center justify-between gap-3 border-[color:var(--findable-hairline,#23252a)] border-t pt-4">
      {skip ? (
        <button
          className="rounded-md border border-[color:var(--findable-hairline,#23252a)] px-4 py-2 font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm"
          onClick={skip.onClick}
          type="button"
        >
          {skip.label}
        </button>
      ) : (
        <span />
      )}
      <button
        className="rounded-md bg-[color:var(--findable-primary,#ff7a4d)] px-4 py-2 font-medium text-black text-sm disabled:opacity-50"
        disabled={primary.disabled}
        onClick={primary.onClick}
        type="button"
      >
        {primary.label}
      </button>
    </div>
  </div>
);
