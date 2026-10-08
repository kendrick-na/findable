"use client";

import { useState } from "react";

/**
 * 「업종」 줄 끝의 「세부 분야 21개 펼치기」 — 누르면 바로 아래에 세부 분야 칩 줄이 열린다.
 * 칩(링크)은 서버가 그린 그대로 받는다(children). 고른 세부 분야가 있으면 처음부터 펼쳐 둔다.
 */
export function CollapsibleRow({
  children,
  closeLabel,
  defaultOpen,
  header,
  openLabel,
}: {
  children: React.ReactNode;
  closeLabel: string;
  defaultOpen: boolean;
  header: React.ReactNode;
  openLabel: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {header}
        <button
          aria-expanded={open}
          className="ml-1 min-h-8 rounded-md px-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs underline underline-offset-2 hover:text-[color:var(--findable-ink,#f7f8f8)]"
          data-testid="sub-toggle"
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          {open ? closeLabel : openLabel}
        </button>
      </div>
      {open ? children : null}
    </>
  );
}
