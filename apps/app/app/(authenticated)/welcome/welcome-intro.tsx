import type { ReactNode } from "react";

/**
 * 온보딩 1단계 **틀** — 기존 `AssignBrandForm` 을 감싸기만 한다.
 *
 * 🔴 폼을 다시 만들지 않는다(§7-D-3). 이 파일은 **제목·설명·2단 배치**만 담당하고,
 *   입력·검증·측정 시작은 전부 기존 폼 것이다.
 *
 * ⚠️ 완성 기준(§7-C-7): **첫 화면 입력칸 1개**(도메인). 그래서 여기에 다른 입력을
 *   더 붙이지 않는다 — 6개 관문을 만들지 않는 것이 이 화면의 목적이다.
 *
 * ⚠️ 우측은 「왜 도메인만 받나」를 말한다. 프로파운드 f048 처럼 **움직이는 데모**를 두지
 *   않는다 — 📕설계 v2 §3-2(장식 금지·화면당 큰 그래픽 1개)와 충돌하고, 이 단계의
 *   목적은 **입력을 끝내는 것**이라 모션이 그걸 늦춘다.
 */
export const WelcomeIntro = ({
  children,
  t,
}: {
  children: ReactNode;
  /** 문구 사전 — 서버가 읽어 내려준다(뷰는 `server-only` 를 모른다). */
  t: Record<string, string>;
}) => (
  <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
    <div className="flex flex-col gap-2">
      <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
        {(t.stepOf ?? "").replace("{current}", "1").replace("{total}", "5")}
      </span>
      <div
        aria-hidden="true"
        className="h-1 w-full overflow-hidden rounded-full bg-[color:var(--findable-hairline,#23252a)]"
      >
        <div className="h-full w-1/5 rounded-full bg-[color:var(--findable-primary,#ff7a4d)]" />
      </div>
    </div>

    {/* 🔴 한국어 줄바꿈 절대규칙(설계 v3 §5-1). */}
    <div className="flex flex-col gap-2 [word-break:keep-all]">
      <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
        {t.introTitle}
      </h1>
      <p className="max-w-2xl text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
        {t.introLede}
      </p>
    </div>

    <div className="grid flex-1 items-start gap-6 md:grid-cols-2">
      {/* 입력이 먼저 — 모바일(390)에서 세로로 쌓일 때도 위에 온다. */}
      <div>{children}</div>
      <div className="order-last flex flex-col gap-3 [word-break:keep-all]">
        <p className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
          {t.introWhyTitle}
        </p>
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
          {t.introWhyBody}
        </p>
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
          {t.introEngines}
        </p>
      </div>
    </div>
  </div>
);
