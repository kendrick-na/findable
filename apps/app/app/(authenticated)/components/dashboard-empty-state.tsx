import type koDictionary from "@repo/internationalization/dictionaries/ko.json";
import { ArrowUpRight, Bot, LineChart, Mail, Search } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

interface Step {
  description: string;
  icon: ReactNode;
  title: string;
}

// A2(2026-08-10 세션N-16) — **샘플 리포트는 "실제 진단 1건"이다.**
//
// 🔴 지어낸 숫자를 쓰지 않는다. 같은 저장소의 `compare`·`sources` 잠금 화면이
//   **가짜 예시(42%·31%·18%)** 를 깔고 있는데, 그건 이 프로젝트의 제1 규칙
//   ("사실을 자동 생성하지 않는다")과 충돌하고 리서치도 블러/티저를 **기각**했다
//   (`_리서치원본_UIUX_2026-08-06/05:109` — "직접 조사한 연구 없다" = 자기모순).
//   → 대신 **우리 계정으로 실제 측정한 회차**를 그대로 보여준다.
//
// 🔬 표본 선정 근거(DB 실측): SK하이닉스 회차는 **엔진 29/29 전건 측정 성공** ·
//   고유 엔진 8곳 · 언급 23/29 · **처방 5건**. "다 안다"(kia 28/28)보다
//   **아는 곳과 모르는 곳이 섞여 있어** 제품이 무엇을 보여주는지 가장 잘 가르쳐 준다.
// 🔒 `?shared=1` = 공유뷰 → **신청자 이메일을 숨긴다**(라이브 검증 완료).
//   푸터의 사업자 이메일은 전자상거래법상 표기 의무라 남는 것이 정상.
export interface Props {
  /** 지금 로그인한 계정의 이메일. 무료진단 결과는 **이 주소로** 이어진다. */
  signedInEmail?: string | null;
}

/**
 * 사전의 `app.emptyState` 모양. 키를 빼먹으면 tsc 가 잡는다.
 *
 * 🔴 **`getAppDictionary` 의 반환 타입으로 유도하지 않는다.** 그러면 `type` import 라도
 *   webpack 이 모듈을 실제로 끌어와 **`server-only` 가 브라우저에서 throw** 한다
 *   (스토리 빈 화면의 2차 원인 — 1차는 `env` 였다). → **사전 JSON 에서 직접 유도**한다.
 *   사전이 진실의 원천이므로 키 정합은 그대로 보장된다(가드 = `app-i18n-scaffold.test.ts`).
 */
export type EmptyStateDictionary = (typeof koDictionary)["app"]["emptyState"];

/**
 * 3단계 안내. **문구는 사전에서 온다**(v4 P0-3 점진 이관 · `CLAUDE.md §2` 하드코딩 금지).
 *
 * 🔴 아이콘만 코드에 남는 이유: 사전은 **문자열 전용**이다. JSX 를 사전에 넣으면
 *   번역자가 마크업을 건드려야 하고 XSS 표면이 생긴다.
 *
 * 문구에 담긴 판단은 사전 키에 **그대로** 옮겼다(내용 변경 0):
 * - `step1Body` 🔴 2026-08-14(§3-a) — 예전 문구는 "브랜드 이름과 웹사이트 주소"였다.
 *   브랜드 이름이 **선택 입력**이 된 지금 그 문장은 거짓이다(필수 입력 2개로 읽힌다).
 * - `step2Title` 🔴 2026-08-14(§3-a) — 등록이 곧 측정이다. 예전엔 등록 후 측정 버튼을
 *   또 눌러야 해서 이 단계가 사용자의 별도 행동이었다.
 * - `step3Body` §5-3 교체표: SoV → "AI가 우리를 말한 비율" · 인용 도메인 → "출처로 걸린 링크"
 */
const buildSteps = (t: EmptyStateDictionary): Step[] => [
  {
    icon: <Search className="size-5" />,
    title: t.step1Title,
    description: t.step1Body,
  },
  {
    icon: <Bot className="size-5" />,
    title: t.step2Title,
    description: t.step2Body,
  },
  {
    icon: <LineChart className="size-5" />,
    title: t.step3Title,
    description: t.step3Body,
  },
];

// 측정 이력 0건일 때의 온보딩 표면. 빈 화면이 아니라 "왜·어떻게"를 보여준다.
// CTA는 앱 내부 /brand(브랜드 등록→측정)로 수렴(예전 www 무료진단 외부링크 폐기, 2026-07-30 UX).
//
// 🔴 A1(2026-08-10 세션N-16) — **"이어붙이기" 안내를 최상단에 넣는다.**
//   🔬DB 실측: 가입자 **6명 중 5명**이 이 화면(빈 상태)을 본다. 그리고 무료진단만 하고
//   가입하지 않은 이메일이 **24명** 있다.
//   🔬코드 실측(`page.tsx:53`): 대시보드는 **로그인 이메일로 무료진단(AuditJob)을 이미 매칭**한다.
//   → 즉 **진단할 때와 다른 주소로 가입하면 결과가 조용히 사라진다.** 화면이 그 사실을
//     말해주지 않아서, 사용자는 "내 진단이 없어졌다"가 아니라 "원래 빈 서비스"로 읽는다.
//   그래서 여기서 **지금 로그인한 주소를 그대로 보여주고**, 다른 주소로 진단했다면
//   그 주소로 로그인하라고 안내한다. 새 진단·원가 0.
/**
 * 🔴 **왜 뷰와 데이터를 나누는가**(N-43 · 스크린샷으로 발견).
 *
 * 문구를 사전으로 옮기면서 이 컴포넌트를 `async` + `getAppDictionary`(**server-only**)로
 * 만들었더니 **Storybook 에서 렌더가 안 됐다**(빈 화면 가드가 6건 전부 잡았다).
 * tsc 0 · 테스트 584/584 통과였는데 **화면만 안 나왔다** — 이 저장소가 반복해서 데인 그 형태다.
 *
 * → 📕 N-37·N-41 이 세운 **주입 패턴**을 따른다: 서버 전용 의존(사전)은 **껍데기**가 먹고,
 *   실제 화면은 **순수 뷰**(`DashboardEmptyStateView`)가 그린다. 스토리는 뷰를 직접 렌더한다.
 *   ⚠️ 뷰를 `export` 해야 스토리가 잡는다. 화면 코드는 **한 벌**이라 갈라지지 않는다.
 */
export const DashboardEmptyStateView = ({
  signedInEmail,
  t,
  sampleUrl,
}: Props & { sampleUrl: string; t: EmptyStateDictionary }) => {
  const steps = buildSteps(t);

  return (
    <div className="findable-card flex flex-col items-center px-6 py-12 text-center">
      <h2 className="max-w-xl font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
        {t.heading}
      </h2>
      <p className="mt-3 max-w-xl text-[color:var(--findable-ink-muted,#d0d6e0)]">
        {t.lede}
      </p>

      {/* 이미 진단한 사람을 되찾는 길. 브랜드 등록 CTA보다 위에 둔다 —
          "없는 걸 새로 만들라"보다 "있는 걸 이어라"가 먼저다. */}
      <div className="mt-8 flex w-full max-w-3xl items-start gap-3 rounded-lg border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-2,#141516)] p-4 text-left">
        <Mail className="mt-0.5 size-4 shrink-0 text-[color:var(--findable-ink-subtle,#8a8f98)]" />
        <div>
          <p className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
            {t.reclaimTitle}
          </p>
          <p className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            {/* 🔴 문장을 **쪼개지 않는다.** 예전엔 `<strong>그때 입력한 이메일 주소</strong>`
                로 문장 중간을 강조했는데, 사전에 넣으려면 문장을 3조각으로 잘라야 한다.
                조각난 문구는 **어순이 다른 언어에서 조립이 불가능**하다(영어는 목적어가 뒤).
                → 강조를 포기하고 문장을 통째로 든다. 정보는 그대로 남는다. */}
            {t.reclaimBody}
            {signedInEmail ? (
              <>
                {" "}
                {t.reclaimSignedInPrefix}{" "}
                {/* 긴 이메일이 200% 확대(195px)에서 355px 로 삐져나가 가로 스크롤을
                    만들었다(WCAG 1.4.10). `break-all` 대신 `anywhere` — 짧은 주소는
                    그대로 두고 넘칠 때만 끊는다. */}
                <span className="text-[color:var(--findable-ink-muted,#d0d6e0)] [overflow-wrap:anywhere]">
                  {signedInEmail}
                </span>
                {t.reclaimSignedIn}
              </>
            ) : (
              ` ${t.reclaimAnonymous}`
            )}
          </p>
        </div>
      </div>

      <ol className="mt-10 grid w-full max-w-3xl grid-cols-1 gap-4 text-left sm:grid-cols-3">
        {steps.map((step, index) => (
          <li
            className="flex flex-col gap-3 rounded-lg border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-2,#141516)] p-5"
            key={step.title}
          >
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-[color:var(--findable-primary,#ff7a4d)]/12 text-[color:var(--findable-primary,#ff7a4d)]">
                {step.icon}
              </span>
              {/* 🔴 S7-2차(2026-08-11) — `STEP` 은 영어다. 로그인 후 첫 화면이고
                  한국어 화면이라 숫자 앞뒤를 한국어로 읽히게 바꾼다(NN/g 2).
                  🔴 그래서 사전 값은 `{n}단계` / `Step {n}` 처럼 **자리표시자**를 쓴다 —
                    `${n}단계` 로 이어붙이면 영어에서 `1Step` 이 된다(어순이 반대). */}
              <span className="font-medium text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm tabular-nums">
                {t.stepLabel.replace("{n}", String(index + 1))}
              </span>
            </div>
            <div>
              <p className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
                {step.title}
              </p>
              <p className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
                {step.description}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
        <Link
          className="findable-btn-primary inline-flex items-center rounded-md px-6 py-3 font-medium text-sm"
          href="/brand"
        >
          {t.cta}
        </Link>
        {/* 결과가 어떻게 생겼는지 **먼저 보여준다**. 등록은 그 다음이다 —
            안 해본 사람에게 "1~3분 걸립니다"는 근거 없는 부탁이다. */}
        <a
          className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--findable-hairline,#23252a)] px-5 py-3 font-medium text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm transition-colors hover:border-[color:var(--findable-ink-subtle,#8a8f98)] hover:text-[color:var(--findable-ink,#f7f8f8)]"
          href={sampleUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t.sampleCta}
          <ArrowUpRight className="size-4" />
        </a>
      </div>
      <p className="mt-3 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
        {t.footnote}
      </p>
    </div>
  );
};
