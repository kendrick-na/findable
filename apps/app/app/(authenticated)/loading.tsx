// 대시보드 로딩 상태 (2026-08-16 세션N-34 · v4 P0-2).
//
// 🔴 **왜 필요한가**: `loading.tsx` 가 **repo 전체에 0개**였다.
//   ⚠️ **`<Suspense>` 는 지금도 0건이다**(2026-08-17 세션N-39 재실측 — 주석 제외 grep).
//   이 주석이 *"0건이었다"* 라고 과거형으로 적혀 있어 **해결된 것처럼 읽혔다.**
//   `loading.tsx` 는 **라우트 단위**라 화면 전체가 스켈레톤으로 바뀐다 —
//   무거운 패널만 부분 스트리밍하려면 `<Suspense>` 가 따로 필요하다. **아직 안 했다.**
//   → `apps/web` 은 `loading.tsx` 조차 **0개**다(P0-2 잔여분).
//   이 화면은 `currentUser` → `auth` → `getCurrentPlan` → `auditJob.findMany(20)`
//   → `scopedTracking()` → `scopedAnnotations` 를 **순차로 await** 한 뒤에야
//   첫 픽셀을 그린다. 그동안 사용자는 **빈 화면**을 본다.
//
// ⭐ v4 §2-d: 경쟁사 4곳 공통 실패 5개 중 **#5 = 로딩 실패 미설계**.
//   우리가 그걸 그대로 재현하고 있었다 → 우리 자리다.
//
// 🔴 v4 는 이걸 *"탭 재편(6번)의 전제"* 로 묶어놨는데 **탭 재편은 데이터 부족으로 보류**다.
//   로딩 상태는 탭이 없어도 지금 화면에 필요하므로 **분리해서 먼저 넣는다**.
//
// ⚠️ **레이아웃을 실제 화면과 맞춘다.** 스켈레톤이 실제와 다른 모양이면
//   내용이 들어오는 순간 화면이 튀어(layout shift) 안 하느니만 못하다.
//   실제 순서: 헤더 → (브랜드 전환) → 히어로 3장 → 지금 할 일 → 추세 → 질문별.
//
// ♻️ `Skeleton` 은 `@repo/design-system` 것을 쓴다(새로 만들지 않는다).

import { Skeleton } from "@repo/design-system/components/ui/skeleton";

/** 히어로 KPI 카드 한 장의 뼈대. 실제 `KpiCard` 의 세로 구성과 같은 순서. */
const KpiCardSkeleton = () => (
  <div className="findable-card flex min-w-0 flex-col gap-3 p-5">
    <Skeleton className="h-4 w-24" />
    {/* 숫자(3xl)가 이 카드의 주인공이라 가장 크게 잡는다 */}
    <Skeleton className="h-9 w-20" />
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-10 w-full" />
  </div>
);

const Loading = () => (
  <>
    {/* 헤더는 페이지마다 그린다(레이아웃에 없다) → 여기서도 자리를 잡아야
        내용이 들어올 때 위로 밀리지 않는다. */}
    <div className="flex h-16 shrink-0 items-center gap-2 px-4">
      <Skeleton className="h-4 w-32" />
    </div>
    <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
      {/* 히어로 3장 */}
      {/* ⚠️ 실제 `DashboardKpis:342` 와 **같은 브레이크포인트**를 쓴다.
          다르면 태블릿 폭에서 3장→2장으로 튄다(스켈레톤이 만드는 layout shift). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCardSkeleton />
        <KpiCardSkeleton />
        <KpiCardSkeleton />
      </div>
      {/* 지금 할 일 카드 */}
      <Skeleton className="h-32 w-full rounded-xl" />
      {/* 추세 차트 */}
      <Skeleton className="h-64 w-full rounded-xl" />
      {/* 질문별 */}
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  </>
);

export default Loading;
