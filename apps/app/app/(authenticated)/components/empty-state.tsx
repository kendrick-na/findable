import Link from "next/link";
import type { ReactNode } from "react";

/**
 * 빈 상태 공용 컴포넌트 (S2' · 2026-08-11 세션N-19).
 *
 * 🔬 **승격 근거 = 중복 실측.** `actions`·`sources`·`compare` 가 각자
 *   `findable-card flex flex-col items-center gap-3 p-12 text-center` +
 *   제목 + 설명 + `/brand` CTA 를 **글자 하나까지 같은 마크업으로** 복제하고 있었다.
 *   같은 것을 3벌 두면 한 곳을 고칠 때 나머지가 조용히 뒤처진다
 *   (실제로 `/history` 는 아예 빠져 **완전 공백**이었다).
 *
 * 📕 설계 규격 = `UIUX_대개선_설계_v3` §4-1 「빈 상태 필수 4요소」:
 *   ①이 화면이 무엇인지 ②여기 무엇이 보일지 ③다음 행동 1개 ④데이터 생기면 자동 소멸
 *
 * ⚠️ **④ 자기소멸은 이 컴포넌트의 책임이 아니다** — 호출부가 데이터 유무로
 *   분기해 렌더하지 않는 방식으로 이미 달성된다(Metabase 패턴). 여기서
 *   `if (hasData) return null` 을 하면 **분기가 두 곳으로 갈라져** 더 위험하다.
 *
 * 🔴 **지어낸 숫자·가짜 예시 금지**(프로젝트 제1 규칙). 값을 보여줘야 하면
 *   `sampleHref` 로 **실제 측정 회차**를 링크한다(`dashboard-empty-state` 와 동일 방침).
 */
interface EmptyStateProps {
  /** ③ 다음 행동 1개. 기본 = 브랜드 등록→측정. */
  ctaHref?: string;
  ctaLabel?: string;
  /** ② 여기 무엇이 보일지. 한 문장으로. */
  description: string;
  /** 제목 위 아이콘(선택). */
  icon?: ReactNode;
  /** 실제 측정 회차 링크(선택) — 가짜 예시 대신 진짜를 보여줄 때만. */
  sampleHref?: string;
  sampleLabel?: string;
  /** ① 이 화면이 무엇인지. */
  title: string;
}

export const EmptyState = ({
  ctaHref = "/brand",
  ctaLabel = "측정 시작하기",
  description,
  icon,
  sampleHref,
  sampleLabel = "결과 예시 먼저 보기",
  title,
}: EmptyStateProps) => (
  // 🔴 S7-2차(2026-08-11) — 카드가 **가로 전폭**(1130px)을 잡아 글이 중앙에 외롭게
  //   떠 보였고, 아래로 700px 가까이 빈 검정이 남아 **"만들다 만 화면"** 으로 읽혔다
  //   (고객사 시연에서 신뢰가 먼저 깎이는 자리 · Apple Craft · NN/g 8).
  //   → 읽기 좋은 폭으로 제한하고 가운데 정렬한다. `/actions`·`/history`·`compare`·
  //     `sources` **4화면이 이 컴포넌트를 공유**하므로 한 줄로 전부 개선된다.
  <div className="findable-card mx-auto flex w-full max-w-2xl flex-col items-center gap-3 p-12 text-center">
    {icon ? (
      <span className="flex size-10 items-center justify-center rounded-lg bg-[color:var(--findable-primary,#ff7a4d)]/12 text-[color:var(--findable-primary,#ff7a4d)]">
        {icon}
      </span>
    ) : null}
    <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-xl">
      {title}
    </h2>
    <p className="max-w-md text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
      {description}
    </p>
    <div className="mt-1 flex flex-col items-center gap-3 sm:flex-row">
      <Link
        className="rounded-md bg-[color:var(--findable-primary,#ff7a4d)] px-4 py-2 font-medium text-black text-sm transition-opacity hover:opacity-90"
        href={ctaHref}
      >
        {ctaLabel}
      </Link>
      {sampleHref ? (
        <a
          className="rounded-md border border-[color:var(--findable-hairline,#23252a)] px-4 py-2 font-medium text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm transition-colors hover:border-[color:var(--findable-ink-subtle,#8a8f98)] hover:text-[color:var(--findable-ink,#f7f8f8)]"
          href={sampleHref}
          rel="noopener noreferrer"
          target="_blank"
        >
          {sampleLabel}
        </a>
      ) : null}
    </div>
  </div>
);
