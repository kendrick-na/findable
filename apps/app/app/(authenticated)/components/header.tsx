import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@repo/design-system/components/ui/breadcrumb";
import { Separator } from "@repo/design-system/components/ui/separator";
import { SidebarTrigger } from "@repo/design-system/components/ui/sidebar";
import { Fragment, type ReactNode } from "react";
import { scopedHeaderMetric } from "@/lib/db/scoped";
import { APP_ENGLISH_ENABLED, getAppDictionary } from "@/lib/i18n";
import { LocaleSwitcher } from "./locale-switcher";

interface HeaderProps {
  children?: ReactNode;
  page: string;
  pages: string[];
  showMetric?: boolean;
}

// ──────────────────────────────────────────────────
// The latest organization metric is not a universal page metric in a
// multi-brand account. Keep this lightweight read only for screens that
// explicitly opt in after checking that the displayed brand matches.
// ──────────────────────────────────────────────────
const HeaderMetric = async () => {
  const [metric, dict] = await Promise.all([
    scopedHeaderMetric(),
    getAppDictionary(),
  ]);
  if (!metric) {
    return null;
  }
  return (
    // 🔴 2026-08-17(N-37) — 예전엔 `hidden sm:flex` 라 **모바일에서 통째로 사라졌다.**
    //   실측(390px 스크린샷): 헤더에 브레드크럼만 남아 *"지금 어느 브랜드를 보는지"* 를
    //   알 수 없었다. 경쟁사 4곳은 전부 이 정보를 항상 띄운다.
    //   → 모바일에서도 **숫자는 남긴다.** 자리가 좁으니 브랜드명·라벨만 접는다
    //     (브랜드명은 본문 h1 에 이미 있어 중복이고, 숫자는 어디에도 없다).
    <div className="flex items-baseline gap-1.5 px-4">
      <span className="hidden text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs sm:inline">
        {metric.brandName}
      </span>
      <span className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-sm tabular-nums">
        {metric.sov}%
      </span>
      <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
        {dict.dashboard.headerMetricLabel}
      </span>
    </div>
  );
};

// Multi-brand organizations can view different brands on each tab. A global
// "latest" metric would silently attach another brand's 0% to this page.
// Only pages that establish a matching brand context opt in explicitly.
export const Header = ({
  pages,
  page,
  children,
  showMetric = false,
}: HeaderProps) => (
  <header className="flex h-16 shrink-0 items-center justify-between gap-2">
    <div className="flex items-center gap-2 px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator className="mr-2 h-4" orientation="vertical" />
      <Breadcrumb>
        <BreadcrumbList>
          {pages.map((page, index) => (
            <Fragment key={page}>
              {index > 0 && <BreadcrumbSeparator className="hidden md:block" />}
              {/* 🔴 2026-08-15 — `href="#"` 죽은 링크였다. 클릭하면 페이지 맨 위로
                  튈 뿐 아무 데도 안 간다(링크처럼 보이는데 동작이 없음 = 신뢰 손실).
                  `pages` 는 `string[]` 이라 **갈 곳 정보가 애초에 없다** → 잘못된 곳으로
                  보내느니 링크가 아닌 텍스트로 둔다. 실제 경로가 필요해지면
                  `pages` 를 `{label, href}[]` 로 바꾸는 게 선행돼야 한다. */}
              <BreadcrumbItem className="hidden md:block">
                <span className="text-muted-foreground">{page}</span>
              </BreadcrumbItem>
            </Fragment>
          ))}
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{page}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
    <div className="flex items-center gap-2">
      {APP_ENGLISH_ENABLED && <LocaleSwitcher />}
      {/* D11: 브레드크럼 반대쪽 끝. children 이 있는 화면에서도 자리가 겹치지 않는다. */}
      {showMetric && <HeaderMetric />}
      {children}
    </div>
  </header>
);
