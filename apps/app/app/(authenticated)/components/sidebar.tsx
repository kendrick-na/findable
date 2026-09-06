"use client";

import { OrganizationSwitcher, UserButton } from "@repo/auth/client";
import { hasPlan, PLAN_META, type Plan } from "@repo/auth/plan";
import { ModeToggle } from "@repo/design-system/components/mode-toggle";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@repo/design-system/components/ui/sidebar";
import { cn } from "@repo/design-system/lib/utils";
import { NotificationsTrigger } from "@repo/notifications/components/trigger";
import {
  ActivityIcon,
  BarChart3Icon,
  BellIcon,
  BuildingIcon,
  CreditCardIcon,
  DownloadIcon,
  FileTextIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  LifeBuoyIcon,
  LinkIcon,
  ListChecksIcon,
  LockIcon,
  type LucideIcon,
  MessageSquareIcon,
  PenLineIcon,
  PlayIcon,
  ScanSearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TrendingUpIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { env } from "@/env";
import { ExportDialog, type ExportDialogLabels } from "./export-dialog";
import { MobileTabBar, type MobileTabBarLabels } from "./mobile-tab-bar";
import { PartnerBadge } from "./partner-badge";
import { PlanBadge } from "./plan-badge";

interface GlobalSidebarProperties {
  readonly children: ReactNode;
  /**
   * 측정이 1건이라도 있는가 — **모바일 하단 탭바를 그릴지 판정**(v4 P0-5).
   * 🔴 측정 0건이면 탭이 전부 비어 있다. 빈 화면 위에 탭바를 얹으면
   *   `page.tsx:167` 의 *"빈 상태에서는 영업을 걷어낸다"* 규칙을 어긴다.
   */
  readonly exportLabels: ExportDialogLabels;
  readonly hasMeasurement: boolean;
  readonly isAdmin: boolean;
  // 승인된 파트너 여부(진실=DB status). true 면 plan 배지 옆에 파트너 배지 병기.
  readonly isPartner: boolean;
  /**
   * 하단 탭바 라벨 — **서버가 사전에서 읽어 내려준다**(v4 P0-3 · 세션N-39).
   * 🔴 이 컴포넌트도 `"use client"` 라 사전 접근자(`cookies()` 의존)를 직접 못 부른다.
   *   그래서 서버 레이아웃 → 여기 → `MobileTabBar` 로 문자열만 흘린다.
   */
  readonly labels: SidebarLabels;
  readonly mobileTabLabels: MobileTabBarLabels;
  readonly plan: Plan;
}

// web(마케팅) 앱 URL. t3-env로 검증된 값 사용(NEXT_PUBLIC_은 client 스코프라 클라이언트에서도 접근 가능).
const WEB_URL = env.NEXT_PUBLIC_WEB_URL;

interface NavItem {
  // external=true면 web(마케팅) 앱 절대 URL이라 next/link 대신 <a>로 렌더.
  external?: boolean;
  icon: LucideIcon;
  /**
   * 있으면 링크 대신 버튼으로 렌더하고 url 로 이동하지 않는다(RICE#5 — 내보내기 확인 모달).
   * `url`은 잠금 시 `/billing` 링크를 만드는 데는 계속 쓰인다.
   */
  onSelect?: () => void;
  // 이 plan 이상이어야 잠금 해제. 없으면 전원 접근.
  requiredPlan?: Plan;
  title: string;
  url: string;
}

// 🔴 S6-b(2026-08-11) — 평평한 9항목(자물쇠 4개 산재)을 **3단 그룹**으로 재편.
//   근거(리서치 원본 `06_GEO도구_실제화면_인터랙션_2026-08-10.md`):
//     · Gauge `[VERIFIED]` 3단계 `Monitor → Analyze → Act` (:152)
//     · Scrunch AI `[VERIFIED]` 최상위 IA 2분할 `Monitoring`/`Insights` (:83)
//     · §5 결론 "조직 구조가 IA 를 결정" (:231)
//   ⚠️ **의도된 이탈**: Gauge 는 `Act` 를 **마지막**에 두는데 우리는 「실행」을 **최상단**에 올렸다.
//     확정 페인이 *"측정은 잘하는데 뭘 해야 할지 안 알려준다"* 이고 `geoActions` 가 우리의
//     유일한 구조적 우위인데 예전 배치에서는 **사이드바 4번째**로 묻혀 있었다. 실수 아님.
//   ⛔ 잠긴 4개를 「더보기」로 접지 않는다(기획서 §3-1 보류) — `compare`·`sources` 는 실제로
//     **작동하는 기능**이라(N-17 실측) 접으면 *"있는 기능을 안 파는"* 결함의 재발이다.
//     「분석」 그룹으로 묶으면 접지 않고도 "이 묶음은 상위 플랜"으로 읽힌다.
interface NavGroup {
  items: NavItem[];
  label: string;
}

/**
 * 사이드바 문구 — **서버가 읽어 내려준다**(N-45 · 남은일 #2).
 *
 * 🔴 이 파일은 `"use client"` 라 `getAppDictionary`(`server-only`)를 **직접 못 부른다**.
 *   부르면 `node:fs` 가 브라우저 번들에 딸려와 **Storybook 이 통째로 죽는다**
 *   (📕 N-43·N-44 에서 실제로 두 번 겪었다) → `layout.tsx` 가 읽어 주입한다.
 *   `mobileTabLabels` 가 이미 같은 패턴이다 — **새 메커니즘을 만들지 않는다**.
 */
export interface SidebarLabels {
  adminAudits: string;
  adminContent: string;
  adminEvidence: string;
  adminMeasure: string;
  adminOps: string;
  adminOrgs: string;
  adminPartners: string;
  alerts: string;
  billing: string;
  brandMeasure: string;
  compare: string;
  content: string;
  currentPlan: string;
  dashboard: string;
  export: string;
  groupAccount: string;
  groupAct: string;
  groupAdmin: string;
  groupAnalyze: string;
  groupInsight: string;
  groupMeasure: string;
  history: string;
  lockedHint: string;
  prompts: string;
  publicInsights: string;
  siteAudit: string;
  sources: string;
  support: string;
  todo: string;
}

const workspaceGroups = (
  t: SidebarLabels,
  onExportSelect: () => void
): NavGroup[] => [
  {
    label: t.groupAct,
    items: [
      // 액션은 게이팅하지 않는다 — "그래서 뭘 하라고?"에 답하는 게 제품의 핵심 가치이고,
      // 업계 1위 불만("진단만 하고 처방 없음")을 해소하는 자리이기 때문(2026-07-31 세션K-2).
      // 🔴 S4(2026-08-11) — "실행 액션" → "지금 할 일". 업계 관행 용어도, 일상 한국어도
      //   아니었다. 제품 안에 **이미 더 쉬운 이름이 있었다**: 대시보드 카드 제목·본문
      //   제목이 전부 "지금 할 일"(`next-actions-card.tsx:41` · `actions/page.tsx:172,354`).
      //   메뉴에만 딱딱한 이름이 남아 **같은 것을 두 이름으로 부르고 있었다**(NN/g 4 일관성).
      { title: t.todo, url: "/actions", icon: ListChecksIcon },
    ],
  },
  {
    label: t.groupMeasure,
    items: [
      { title: t.dashboard, url: "/", icon: LayoutDashboardIcon },
      // 측정의 단일 진입점 = /brand (브랜드 등록→측정 시작). 예전 "새 측정"은 www 무료진단
      // 외부링크였고 "브랜드 관리"와 용어가 갈라져 혼란의 원천이었다(2026-07-30 UX 통일).
      // 🔴 S6-a(2026-08-11) — "측정 시작"은 이 화면의 **세 번째 이름**이었다(title·h1 은
      //   "브랜드 측정", 폼은 "새 브랜드 등록"). 게다가 이 화면은 **등록**이 주 동작이고
      //   측정은 브랜드별 버튼이 한다 → 「브랜드·측정」으로 통일.
      { title: t.brandMeasure, url: "/brand", icon: SparklesIcon },
      {
        title: t.siteAudit,
        url: "/site-audit",
        icon: ScanSearchIcon,
        requiredPlan: "growth",
      },
      // 🔴 「추적 질문」(2026-08-17 세션N-41) — 경쟁사 4곳(Profound·Otterly·Peec·
      //   Scrunch)이 **전부** `Prompts` 를 최상위 탭으로 갖는다(내비 OCR 실측).
      //   GEO 는 *"어떤 질문으로 재나"* 가 결과를 정하는데, 우리는 그 자산
      //   (`PromptWizard`)을 **`/brand` 안에 묻어** 뒀다 = 가장 중요한 입력이
      //   가장 안 보이는 곳에 있었다. 위치는 `/brand`(대상 등록) **다음** —
      //   브랜드가 있어야 질문이 생기는 순서 그대로다.
      { title: t.prompts, url: "/prompts", icon: MessageSquareIcon },
      { title: t.history, url: "/history", icon: HistoryIcon },
    ],
  },
  {
    label: t.groupAnalyze,
    items: [
      {
        title: t.compare,
        url: "/compare",
        icon: BarChart3Icon,
        requiredPlan: "growth",
      },
      {
        title: t.sources,
        url: "/sources",
        icon: LinkIcon,
        requiredPlan: "growth",
      },
      {
        title: t.alerts,
        url: "/alerts",
        icon: BellIcon,
        requiredPlan: "growth",
      },
      {
        // 감사 D7 — 내 측정 데이터 CSV 내보내기(2026-08-07 세션N-8).
        // RICE#5(2026-08-22 N-52) — 클릭 즉시 다운로드 대신 확인 모달(기간·컬럼 선택)로.
        //   `onSelect` 가 있으면 NavRow 가 버튼으로 렌더한다(url 은 잠금 시 /billing 용).
        //   ⚠️ `requiredPlan` 은 API 라우트의 게이트(free → 402)와 **같은 기준**이어야 한다.
        //   화면은 열리는데 API 가 막히면 "없는 기능 판매"의 반대편 결함이 된다.
        title: t.export,
        url: "/api/export/tracking.csv",
        icon: DownloadIcon,
        onSelect: onExportSelect,
        requiredPlan: "starter",
      },
    ],
  },
];

// 마케팅 콘텐츠는 제품 동선의 잡음이라 2개(제품 신뢰 보강 데이터)만 남김(2026-07-30 메뉴 감사).
// 고객 사례·시너지·블로그는 www 헤더/푸터에서 접근 가능.
const insightsNav = (t: SidebarLabels): NavItem[] => [
  {
    title: t.content,
    url: "/insights",
    icon: PenLineIcon,
  },
  {
    // 리포트·벤치마크를 개별 마케팅 탭으로 흩뜨리지 않는다. 공개 허브가
    // 최신 글·시리즈·기존 연구 자산의 단일 진입점이다.
    title: t.publicInsights,
    url: `${WEB_URL}/ko/insights`,
    icon: FileTextIcon,
    external: true,
  },
];

const accountNav = (t: SidebarLabels): NavItem[] => [
  { title: t.billing, url: "/billing", icon: CreditCardIcon },
  {
    title: t.support,
    url: `${WEB_URL}/ko/contact`,
    icon: LifeBuoyIcon,
    external: true,
  },
];

// 플랫폼 운영자 전용 내비. admin 에게만 렌더.
const adminNav = (t: SidebarLabels): NavItem[] => [
  { title: t.adminOps, url: "/admin/ops", icon: ActivityIcon },
  { title: t.adminContent, url: "/admin/content", icon: PenLineIcon },
  // 🆕 세션N-42: 가입 조직·초대 코드. 오버엣지 참여 기업이 코드로 들어오는데
  //   **누가 가입했는지 앱에서 볼 화면이 0곳**이었다(운영자가 SQL 을 돌려야 했다).
  { title: t.adminOrgs, url: "/admin/orgs", icon: BuildingIcon },
  // 진입 링크가 없으면 화면이 있어도 없는 것과 같다(/search 가 그래서 ROT 였다).
  { title: t.adminAudits, url: "/admin/audits", icon: FileTextIcon },
  { title: t.adminPartners, url: "/admin/partners", icon: ShieldCheckIcon },
  // 🔴 세션N-34: admin 화면 4개 중 **이것만 링크가 없었다**(실측 인바운드 0건).
  //   바로 위 주석이 말한 그대로 — 링크가 없어서 **있어도 없는 것**이었다.
  //   ⚠️ 죽은 코드가 아니다: 212줄짜리 실제 기능(조치 전후 근거)이고
  //   `@repo/audit/before-after` 를 쓰는 우리 코드다. 투자·영업 자리에서 쓰라고 만들었다.
  { title: t.adminEvidence, url: "/admin/evidence", icon: TrendingUpIcon },
  // 🆕 세션N-37: 브랜드 1건 측정·수정·삭제. cron 이 한 번에 5건(435원)을 집는 탓에
  //   1건(87원)만 돌릴 방법이 없어 N-36 의 Tracking 유실 수정을 확인 못 하고 있었다.
  { title: t.adminMeasure, url: "/admin/measure", icon: PlayIcon },
];

// 한 줄 렌더. 잠긴 항목은 자물쇠 표시 + /billing 으로 유도(실기능 대신 업그레이드 표면).
const NavRow = ({
  item,
  plan,
  active,
  lockedHint,
}: {
  item: NavItem;
  plan: Plan;
  active: boolean;
  /** 잠긴 항목 툴팁 — `{plan}` 자리에 해제 플랜 이름이 들어간다. */
  lockedHint: string;
}) => {
  const locked = item.requiredPlan ? !hasPlan(plan, item.requiredPlan) : false;
  const href = locked ? "/billing" : item.url;

  const inner = (
    <>
      <item.icon />
      <span className="flex-1">{item.title}</span>
      {locked && (
        <LockIcon className="size-3 text-[color:var(--findable-ink-tertiary,#7e8289)]" />
      )}
    </>
  );

  const tooltip =
    locked && item.requiredPlan
      ? `${item.title} · ${lockedHint.replace("{plan}", PLAN_META[item.requiredPlan].label)}`
      : item.title;

  // 잠긴 상태는 항상 /billing 유도 링크(모달을 열어도 다운로드가 막혀 있으면 의미가 없다).
  if (item.onSelect && !locked) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton onClick={item.onSelect} tooltip={tooltip}>
          {inner}
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        className={cn(
          active &&
            "bg-[color:var(--findable-primary,#ff7a4d)]/10 text-[color:var(--findable-primary,#ff7a4d)] hover:bg-[color:var(--findable-primary,#ff7a4d)]/15 hover:text-[color:var(--findable-primary,#ff7a4d)]"
        )}
        tooltip={tooltip}
      >
        {item.external && !locked ? (
          <a href={href}>{inner}</a>
        ) : (
          <Link href={href}>{inner}</Link>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
};

export const GlobalSidebar = ({
  children,
  exportLabels,
  plan,
  isAdmin,
  isPartner,
  hasMeasurement,
  labels,
  mobileTabLabels,
}: GlobalSidebarProperties) => {
  const sidebar = useSidebar();
  const pathname = usePathname();
  const [exportOpen, setExportOpen] = useState(false);

  const isActive = (item: NavItem) =>
    !item.external &&
    (item.url === "/" ? pathname === "/" : pathname.startsWith(item.url));

  return (
    <>
      <ExportDialog
        labels={exportLabels}
        onOpenChange={setExportOpen}
        open={exportOpen}
      />
      <Sidebar variant="inset">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <div
                className={cn(
                  "h-[36px] overflow-hidden transition-all [&>div]:w-full",
                  sidebar.open ? "" : "-mx-1"
                )}
              >
                <OrganizationSwitcher
                  afterSelectOrganizationUrl="/"
                  hidePersonal
                />
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        {/* 검색창 제거(2026-07-30 메뉴 감사): /search가 미구현 안내뿐이라 기대 배신. 실검색 구현 시 복원. */}
        <SidebarContent>
          {workspaceGroups(labels, () => setExportOpen(true)).map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarMenu>
                {group.items.map((item) => (
                  <NavRow
                    active={isActive(item)}
                    item={item}
                    key={item.title}
                    lockedHint={labels.lockedHint}
                    plan={plan}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
          <SidebarGroup>
            <SidebarGroupLabel>{labels.groupInsight}</SidebarGroupLabel>
            <SidebarMenu>
              {insightsNav(labels).map((item) => (
                <NavRow
                  active={isActive(item)}
                  item={item}
                  key={item.title}
                  lockedHint={labels.lockedHint}
                  plan={plan}
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
          {isAdmin ? (
            <SidebarGroup>
              <SidebarGroupLabel>{labels.groupAdmin}</SidebarGroupLabel>
              <SidebarMenu>
                {adminNav(labels).map((item) => (
                  <NavRow
                    active={isActive(item)}
                    item={item}
                    key={item.title}
                    lockedHint={labels.lockedHint}
                    plan={plan}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ) : null}
          <SidebarGroup className="mt-auto">
            <SidebarGroupLabel>{labels.groupAccount}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {accountNav(labels).map((item) => (
                  <NavRow
                    active={isActive(item)}
                    item={item}
                    key={item.title}
                    lockedHint={labels.lockedHint}
                    plan={plan}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem className="flex items-center justify-between gap-2 px-1 pb-1">
              <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                {labels.currentPlan}
              </span>
              <span className="flex items-center gap-1">
                {isPartner && <PartnerBadge />}
                <PlanBadge plan={plan} />
              </span>
            </SidebarMenuItem>
            <SidebarMenuItem className="flex items-center gap-2">
              <UserButton
                appearance={{
                  elements: {
                    rootBox: "flex overflow-hidden w-full",
                    userButtonBox: "flex-row-reverse",
                    userButtonOuterIdentifier: "truncate pl-0",
                  },
                }}
                showName
              />
              <div className="flex shrink-0 items-center gap-px">
                <ModeToggle />
                <Button
                  asChild
                  className="shrink-0"
                  size="icon"
                  variant="ghost"
                >
                  <div className="h-4 w-4">
                    <NotificationsTrigger />
                  </div>
                </Button>
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        {children}
        {/* 🔴 하단 탭바가 마지막 콘텐츠를 가리지 않게 자리를 비운다(v4 P0-4).
            탭바는 `fixed` 라 문서 흐름에서 빠져 있어 이 여백이 없으면 겹친다. */}
        {hasMeasurement ? <div aria-hidden className="h-16 md:hidden" /> : null}
      </SidebarInset>
      {/* 「더보기」 = 사이드바를 연다. 나머지 화면(분석·인사이트·계정)이 거기 다 있다 —
          새 시트를 또 만들면 같은 내비가 두 벌이 되고 하나가 낡는다. */}
      {hasMeasurement ? (
        <MobileTabBar
          labels={mobileTabLabels}
          onMore={() => sidebar.setOpenMobile(true)}
        />
      ) : null}
    </>
  );
};
