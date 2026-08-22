"use client";

import { cn } from "@repo/design-system/lib/utils";
import {
  HistoryIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  type LucideIcon,
  MenuIcon,
  SparklesIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 모바일 하단 탭 — 2026-08-17 세션N-37 (v4 P0-4 확정안 구현).
 *
 * 🔴 **왜 필요했나** (실측 2026-08-17, 390px 스크린샷):
 *   대시보드 한 장이 **5,892px** = 스크롤 15번. 「Growth 업그레이드」 카드가
 *   맨 아래 5,000px 지점이라 **아무도 못 본다.** Peec 은 하단 탭 4개로 끊어
 *   각 화면을 짧게 유지한다.
 *
 * ⛔ **햄버거 서랍 채택 안 함**(v4 P0-4) — 쓴 2곳(Otterly·Scrunch)이 **둘 다 실패**했고
 *   Scrunch 는 햄버거가 화면 밖으로 사라졌다. 하단 바는 뷰포트에 고정돼 잃을 수 없다.
 * ⛔ **가로스크롤 탭에 8개 안 넣음** — 한글 라벨은 영문보다 넓어 **8개면 2.5개만 보인다.**
 *   Peec 은 4개에서 작동한다.
 *
 * 🔴 **측정 0건이면 렌더하지 않는다**(v4 P0-5) — 첫 사용자에겐 탭이 전부 비어 있다.
 *   `page.tsx:167` 의 *"빈 상태에서는 영업을 걷어낸다"* 규칙과 같은 뜻이다.
 *   → 이 컴포넌트는 `hasMeasurement` 가 참일 때만 호출부에서 렌더된다.
 *
 * ℹ️ 「더보기」는 **사이드바를 연다** — 나머지 화면(분석·인사이트·계정)이 거기 다 있다.
 *   새 시트를 또 만들면 같은 내비가 두 벌이 되고, 하나를 고칠 때 다른 하나가 낡는다.
 */

interface Tab {
  icon: LucideIcon;
  labelKey: keyof MobileTabBarLabels;
  url: string;
}

/**
 * 탭 라벨 — **서버에서 주입**받는다(v4 P0-3 · 세션N-39).
 *
 * 🔴 **왜 prop 인가**: 이 컴포넌트는 `usePathname` 을 쓰는 **클라이언트 컴포넌트**라
 *   서버 전용 사전 접근자(`getAppDictionary`, `cookies()` 의존)를 직접 못 부른다.
 *   → 서버(사이드바)가 사전을 읽어 **문자열만** 내려준다.
 *   ⚠️ 사전 전체를 넘기지 않는다 — 클라이언트 번들에 안 쓰는 문자열이 실린다.
 */
export interface MobileTabBarLabels {
  actions: string;
  history: string;
  measure: string;
  more: string;
  overview: string;
  primaryScreens: string;
}

/**
 * 자주 쓰는 4개. v4 원안(한눈에·지금 할 일·질문별·순위)에서 **실재하는 화면**으로 맞췄다 —
 * 「질문별」은 아직 독립 라우트가 없고(대시보드 안 섹션), 「순위/경쟁사」는 growth 유료라
 * 무료 사용자에게 하단 바 자리를 잠긴 화면으로 쓰는 건 낭비다.
 */
const TABS: Tab[] = [
  { icon: LayoutDashboardIcon, labelKey: "overview", url: "/" },
  { icon: ListChecksIcon, labelKey: "actions", url: "/actions" },
  { icon: SparklesIcon, labelKey: "measure", url: "/brand" },
  { icon: HistoryIcon, labelKey: "history", url: "/history" },
];

export const MobileTabBar = ({
  labels,
  onMore,
}: {
  labels: MobileTabBarLabels;
  onMore: () => void;
}) => {
  const pathname = usePathname();

  return (
    // `md:hidden` — 데스크톱엔 사이드바가 있다. 두 내비를 동시에 띄우지 않는다.
    // `pb-[env(safe-area-inset-bottom)]` — 아이폰 홈 인디케이터에 가리지 않게.
    <nav
      aria-label={labels.primaryScreens}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 md:hidden",
        "border-[color:var(--findable-hairline,#23252a)] border-t",
        "bg-[color:var(--findable-surface-1,#0e0f11)]/95 backdrop-blur",
        "pb-[env(safe-area-inset-bottom)]"
      )}
    >
      <ul className="grid grid-cols-5">
        {TABS.map((tab) => {
          // `/` 는 완전일치라야 한다 — 아니면 모든 경로에서 활성으로 보인다.
          const active =
            tab.url === "/" ? pathname === "/" : pathname.startsWith(tab.url);
          const Icon = tab.icon;
          return (
            <li key={tab.url}>
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  // 44px = 최소 터치 타깃(Apple HIG). 아이콘+라벨 세로 배치.
                  "flex min-h-[56px] flex-col items-center justify-center gap-1 text-xs",
                  active
                    ? "text-[color:var(--findable-primary,#ff7a4d)]"
                    : "text-[color:var(--findable-ink-subtle,#8a8f98)]"
                )}
                href={tab.url}
              >
                <Icon aria-hidden className="size-5" />
                {labels[tab.labelKey]}
              </Link>
            </li>
          );
        })}
        <li>
          <button
            className="flex min-h-[56px] w-full flex-col items-center justify-center gap-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs"
            onClick={onMore}
            type="button"
          >
            <MenuIcon aria-hidden className="size-5" />
            {labels.more}
          </button>
        </li>
      </ul>
    </nav>
  );
};
