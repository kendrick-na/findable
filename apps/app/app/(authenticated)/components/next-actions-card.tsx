import { ArrowRight, ListChecks } from "lucide-react";
import Link from "next/link";

// ──────────────────────────────────────────────────
// 1-4 "지금 할 일" 카드 (2026-08-06 세션N-5) — 📕기획서 §4-1 섹션순서 2번 · L-5
//
// 왜 필요한가: 리서치 최대 발견 중 하나 = **"진짜 공백 = 처방"**. 15개 툴 리뷰어가
//   독립적으로 *"측정은 잘하는데 무엇을 해야 할지는 안 알려준다"* 를 지적했다.
//   Findable 은 /actions 에 처방이 **이미 있는데**, 실측 결과 대시보드에서 거기로 가는
//   링크가 **사이드바 말고는 하나도 없었다**(page.tsx grep 0건) → 처방이 1급 시민이 아님.
//
// ⚠️ 건수를 여기서 계산하지 않는 이유(의도된 선택):
//   /actions 의 액션 목록은 scopedLatestRunTracking(rawResponse Text 포함, 행당 수 KB)
//   + buildGeoActions + Prompt 조회 + ActionCompletion 병합으로 만들어진다.
//   대시보드에 그걸 복제하면 무거운 쿼리가 두 번 돌고, 두 화면의 숫자가 어긋날 위험도 생긴다
//   (같은 값을 두 곳에서 계산하는 것이 세션N-2 sovLabel 사고의 구조였다).
//   → **없는 숫자를 지어내지 않는다.** 건수 대신 행동을 말한다.
//   기획서 목업의 "지금 할 일 N건"에서 N을 뺀 것은 이 근거에 따른 의도적 변경이다.
//
// §9-2(c): 카드 전체가 내비게이션이므로 <Link> 로 감싼다. <div onClick> 이면
//   Cmd/Ctrl+클릭·중간클릭이 죽는다(Web Interface Guidelines).
// ──────────────────────────────────────────────────

export const NextActionsCard = ({
  brandName,
}: {
  brandName: string | null;
}) => (
  <Link
    className="findable-card flex min-w-0 items-center gap-4 p-5 transition-colors hover:border-[color:var(--findable-primary,#ff7a4d)]"
    href="/actions"
  >
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--findable-primary,#ff7a4d)]/12 text-[color:var(--findable-primary,#ff7a4d)]"
    >
      <ListChecks className="size-5" />
    </span>
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="font-semibold text-[color:var(--findable-ink,#f7f8f8)]">
        개선 실행 계획 보기
      </span>
      <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
        {brandName
          ? `${brandName}의 실측 근거와 함께 효과가 큰 순서로 정리했어요`
          : "실측 근거와 함께 효과가 큰 순서로 정리했어요"}
      </span>
    </span>
    <ArrowRight
      aria-hidden="true"
      className="ml-auto size-4 shrink-0 text-[color:var(--findable-ink-subtle,#8a8f98)]"
    />
  </Link>
);
