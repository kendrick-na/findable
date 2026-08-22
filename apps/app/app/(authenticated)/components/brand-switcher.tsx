import { cn } from "@repo/design-system/lib/utils";
import Link from "next/link";
import type { BrandOption } from "../lib/dashboard-data";

interface BrandSwitcherProps {
  options: BrandOption[];
  selectedId: string | null;
}

/**
 * D10 (2026-08-07 세션N-9) — 어떤 브랜드를 보고 있는지 **말하고, 바꿀 수 있게** 한다.
 *
 * 고치는 것: 대시보드가 "가장 최근 측정된 브랜드"를 **조용히** 골랐다. 다른 브랜드에
 *   측정 데이터가 있어도 화면에 닿을 방법이 없었다.
 *   실측: 한 org 가 브랜드 7종 보유 · 그중 2종만 측정됨(나이키 34행 · 엔비디아 20행)
 *   → **엔비디아는 볼 수가 없었다.** 감사 D10 = 브랜드 필터 버그(`b30ca60`)의 UI 쪽 잔여물.
 *
 * 왜 `<Link>` 인가(드롭다운·셀렉트가 아니라):
 *   ① 페이지가 서버 컴포넌트다 — 링크면 `'use client'` 없이 끝난다.
 *   ② 브랜드별 화면이 **URL 로 공유·북마크**된다(대시보드는 팀이 같이 본다).
 *   ③ 실측 선택지가 2개다. 2개를 드롭다운에 넣으면 클릭이 한 번 더 늘 뿐이다.
 *   ⚠️ 선택지가 많아지면(대략 5개 초과) 그때 드롭다운으로 바꾸는 게 맞다.
 *
 * 호출부가 `options.length < 2` 이면 렌더하지 않는다 — 고를 게 없는데 고르는 UI 를
 *   두면 화면만 복잡해진다.
 */
export const BrandSwitcher = ({ options, selectedId }: BrandSwitcherProps) => (
  <nav
    aria-label="브랜드 선택"
    className="flex min-w-0 flex-wrap items-center gap-2"
  >
    {options.map((option) => {
      const active = option.id === selectedId;
      return (
        <Link
          aria-current={active ? "page" : undefined}
          className={cn(
            "rounded-full border px-3 py-1 text-sm transition-colors",
            active
              ? "border-[color:var(--findable-primary,#ff7a4d)] bg-[color:var(--findable-primary,#ff7a4d)]/12 text-[color:var(--findable-ink,#f7f8f8)]"
              : "border-[color:var(--findable-hairline,#23252a)] text-[color:var(--findable-ink-subtle,#8a8f98)] hover:border-[color:var(--findable-hairline-strong,#34343a)] hover:text-[color:var(--findable-ink,#f7f8f8)]"
          )}
          href={`/?brand=${option.id}`}
          key={option.id}
        >
          {option.name}
        </Link>
      );
    })}
  </nav>
);
