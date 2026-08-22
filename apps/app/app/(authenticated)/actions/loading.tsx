// 「지금 할 일」 로딩 상태 (2026-08-16 세션N-34 · v4 P0-2).
//
// 🔴 **대시보드에서 가장 무거운 화면이다** — `await` **10개**(`/` 는 7개).
//   `scopedLatestRunTracking` → `prompt.findMany` → `actionCompletion.findMany` …
//   게다가 org 추적이 없으면 **무료진단 폴백**(`findEmailAuditActions`)까지 한 번 더 탄다.
//
// ⚠️ 실제 구성과 맞춘다: 헤더 → 제목+설명 → 처방 목록 → **감성 섹션**(G-2 신설).

import { Skeleton } from "@repo/design-system/components/ui/skeleton";

/** 처방 카드 한 장. 실제 `ActionList` 항목의 세로 구성과 같은 순서. */
const ActionSkeleton = () => (
  <div className="findable-card flex flex-col gap-3 p-5">
    <div className="flex items-start justify-between gap-3">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-5 w-12 shrink-0" />
    </div>
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-4/5" />
  </div>
);

const Loading = () => (
  <>
    <div className="flex h-16 shrink-0 items-center gap-2 px-4">
      <Skeleton className="h-4 w-28" />
    </div>
    <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="flex flex-col gap-4">
        <ActionSkeleton />
        <ActionSkeleton />
        <ActionSkeleton />
      </div>
      {/* 감성 섹션(G-2) — 처방 아래 자리. */}
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  </>
);

export default Loading;
