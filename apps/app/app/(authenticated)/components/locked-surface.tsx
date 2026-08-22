import { listPriceForPlan, type PayablePlan } from "@repo/payments/catalog";
import { ArrowUpRight, LockIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * 잠금 버튼에 붙일 가격 문구 (S4 원인③ · 2026-08-11 세션N-19).
 *
 * 🔴 예전 버튼은 「**Growth에서 해제하기**」였다 — 진단 §원인③(*"파는 자리에서
 *   이름·가격·값을 숨긴다"*): 고객이 **얼마인지 모른 채** 눌러야 했고,
 *   `Growth`·`해제`는 내부 용어다. → **"월 39만원 Growth로 열기"**.
 *
 * 🔒 **가격을 하드코딩하지 않는다** — `@repo/payments/catalog` 가 단일 진실이다.
 *   화면 숫자와 실제 청구액이 갈리면 그대로 표시광고 문제가 된다(요금제 표와 같은 방침).
 *   ⚠️ 표시가는 `listKrw`(세전 390,000)를 쓴다. 요금제 표의 `price` 와 같은 축이라야
 *   고객이 두 화면을 비교했을 때 어긋나 보이지 않는다(청구액 429,000 은 결제 단계 표기).
 */
function unlockLabel(unlockPlan: string): string {
  const krw = listPriceForPlan(unlockPlan.toLowerCase() as PayablePlan);
  if (krw === null) {
    // 카탈로그에 없는 플랜명이 오면 가격 없이 폴백(없는 숫자를 만들지 않는다).
    return `${unlockPlan}로 열기`;
  }
  return `월 ${Math.round(krw / 10_000)}만원 ${unlockPlan}로 열기`;
}

interface LockedSurfaceProps {
  bullets: string[];
  desc: string;
  // 뒤에 흐리게 깔릴 예시 프리뷰(블러 처리·`aria-hidden`·클릭 불가). 없으면 생략.
  preview?: ReactNode;
  /**
   * "실제 진단 결과 예시" 링크(선택). 🔴 **잠금 화면에서 유일하게 진짜인 것**이라
   * 블러 뒤가 아니라 **카드 안**에 둔다 — `preview` 는 `pointer-events-none` 이라
   * 거기 링크를 넣으면 **눌리지 않는다**(실측으로 잡음).
   */
  sampleUrl?: string;
  title: string;
  // 어떤 플랜에서 열리는지 표기(예: "Pro").
  unlockPlan: string;
}

/**
 * Pro 잠금 기능의 "예고" 표면. 실기능 없이 가치만 노출하고 /billing 으로 유도.
 * ⚠️ 게이팅은 이 컴포넌트를 렌더하는 서버 페이지가 plan 확인 후 결정. 여기선 표시만.
 */
export const LockedSurface = ({
  title,
  desc,
  unlockPlan,
  bullets,
  preview,
  sampleUrl,
}: LockedSurfaceProps) => (
  <div className="relative overflow-hidden">
    {/* 🔴 S6-c#1(2026-08-11) — `opacity-30 blur-[5px]` 는 **대비 1.74:1**(WCAG AA 4.5 미달)로
        글자가 뭉개져 "가려둔 미리보기"가 아니라 **렌더링이 깨진 화면**처럼 읽혔다.
        → `opacity-60 blur-[3px]` 로 완화한다. 여전히 읽어서 쓸 수는 없지만(=유료 가치 보존)
          "내용이 있는데 가려져 있다"가 전달된다.
        ⚠️ `aria-hidden` + `pointer-events-none` 은 **유지**한다 — 스크린리더가 가짜 예시를
          읽거나 눌리면 안 된다. 접근성 경로는 카드 안 본문이 담당한다. */}
    {preview && (
      <div
        aria-hidden="true"
        className="pointer-events-none select-none opacity-60 blur-[3px] [mask-image:linear-gradient(to_bottom,black,transparent)]"
      >
        {preview}
      </div>
    )}

    {/* 🔴 2026-08-10 세션N-16 — `absolute inset-0` 를 걷어냈다.
        예전 프리뷰(가짜 숫자 막대 3줄)는 높이가 충분해 겹쳐도 카드가 다 보였는데,
        프리뷰를 **정직한 설명문**으로 바꾸자 높이가 줄어 **카드 상단이 잘리고
        본문이 화면 밖으로 밀렸다**(라이브 스크린샷에서 발견).
        → 겹치기를 버리고 **프리뷰 위에 카드를 쌓는다**. 높이가 내용에 따라 늘어난다. */}
    {/* ⚠️ S7-2차(2026-08-11) 검토 결과 **손대지 않는다.**
        진단서는 "카드 아래 빈 공백 → `min-h-[60vh]` 로 세로 중앙 정렬"을 제안하지만
        🔬실측: 잠금 3화면(`alerts`·`sources`·`compare`)이 **전부 `preview` 를 넘긴다**
        → 아래 삼항의 `preview` 분기만 타므로 그 수정은 **닿지도 않는 죽은 코드**가 된다.
        그리고 `preview` 쪽은 위 N-16 주석대로 높이를 만지면 **카드 상단이 잘린 전력**이
        있다(`-mt-16` 과 맞물려 있다). 공백은 프리뷰 높이의 결과라 여기서 풀 문제가 아니다. */}
    <div
      className={
        preview
          ? "relative -mt-16 flex items-center justify-center px-4 pb-2"
          : "flex items-center justify-center"
      }
    >
      <div className="findable-card-accent flex max-w-lg flex-col items-center gap-4 p-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-[color:var(--findable-primary,#ff7a4d)]/12 text-[color:var(--findable-primary,#ff7a4d)]">
          <LockIcon className="size-6" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-xl">
            {title}
          </h2>
          <p className="text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm">
            {desc}
          </p>
        </div>

        <ul className="flex flex-col gap-1.5 text-left">
          {bullets.map((bullet) => (
            <li
              className="flex items-start gap-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm"
              key={bullet}
            >
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[color:var(--findable-primary,#ff7a4d)]" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>

        <div className="mt-1 flex flex-col items-center gap-2 sm:flex-row">
          <Link
            className="findable-btn-primary inline-flex items-center rounded-md px-5 py-2.5 font-medium text-sm"
            href="/billing"
          >
            {unlockLabel(unlockPlan)}
          </Link>
          {sampleUrl && (
            <a
              className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--findable-hairline,#23252a)] px-4 py-2.5 font-medium text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm transition-colors hover:border-[color:var(--findable-ink-subtle,#8a8f98)] hover:text-[color:var(--findable-ink,#f7f8f8)]"
              href={sampleUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              실제 결과 예시 보기
              <ArrowUpRight className="size-4" />
            </a>
          )}
        </div>
      </div>
    </div>
  </div>
);
