import { auth } from "@repo/auth/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

interface AuthLayoutProps {
  readonly children: ReactNode;
}

/**
 * 비로그인 화면(로그인·회원가입·SSO 콜백)의 레이아웃.
 *
 * ⚠️ 이미 로그인된 유저가 /sign-in 에 오면 대시보드로 즉시 리다이렉트한다.
 *   (2026-07-29 실측) 이 가드가 없으면 이미 세션이 있는 유저의 sign-in 페이지가
 *   또 signIn.sso()/create 를 호출 → Clerk 가 400 `session_exists`("이미 로그인됨")
 *   반환 → 화면이 로그인 폼에 머무는 "로그인해도 안 넘어감" 버그가 난다.
 *   서버에서 세션을 확인해 리다이렉트하므로 폼 깜빡임 없이 곧장 대시보드로 간다.
 *
 * ⚠️ sso-callback 은 이 그룹 안에 있지만, 콜백 처리 중엔 아직 세션이 없을 수 있어
 *   리다이렉트에 안 걸린다(콜백이 세션을 만든 뒤 스스로 / 로 이동). 정상.
 */
const AuthLayout = async ({ children }: AuthLayoutProps) => {
  const { userId } = await auth();
  if (userId) {
    redirect("/");
  }

  return (
    <div
      className="relative grid h-dvh grid-cols-1 lg:grid-cols-[1.05fr_1fr]"
      style={{ backgroundColor: "var(--findable-canvas, #010102)" }}
    >
      {/* 좌측 브랜드 패널 */}
      <div className="relative hidden flex-col overflow-hidden p-12 lg:flex">
        {/* 브랜드 glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(600px 400px at 20% 15%, var(--findable-glow-purple, rgba(255,122,77,0.16)), transparent 70%), radial-gradient(500px 400px at 80% 90%, var(--findable-glow-blue, rgba(0,117,255,0.14)), transparent 70%)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-px"
          style={{ background: "var(--findable-hairline, #23252a)" }}
        />

        {/* 워드마크 (Instrument Serif 유지, 브랜드 로고 전용) */}
        <div
          className="relative z-10 text-2xl text-[color:var(--findable-ink,#f7f8f8)]"
          style={{
            fontFamily: '"Instrument Serif", serif',
            letterSpacing: "-0.01em",
          }}
        >
          Findable
        </div>

        <div className="relative z-10 mt-auto max-w-md">
          {/* 🔴 2026-08-21 — 시장 통계 2개(haloX 참조, 수치는 원 리서치로 정정해 인용).
              haloX 화면 표기(SparkToro 47~60%·Gartner 39~50%)는 원 리서치와 달라
              웹 재검색으로 확인한 실제 수치로 바꿨다: SparkToro는 2024년 60.45%에서
              2026년 상반기 68.01%로 뛴 것이 최신(2026-02 SparkToro 발표),
              Gartner는 2024-02 발표한 "2026년까지 25%, 2028년까지 50%" 예측이 원문이다.
              ⚠️ Gartner 25% 예측은 2026-06 팩트체크 기사에서 "아직 실현 안 됨"으로
              나왔다 — 예측이라는 점을 문구에서 숨기지 않는다. */}
          <div className="mb-6 flex flex-col gap-3">
            <div className="rounded-lg border border-[color:var(--findable-hairline,#23252a)] p-3">
              <p className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-xl">
                68%
              </p>
              <p className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs leading-relaxed">
                구글 검색이 클릭 없이 끝나요 (2026년 상반기 기준)
              </p>
              <p className="mt-1 text-[color:var(--findable-ink-tertiary,#7e8289)] text-[10px]">
                — SparkToro
              </p>
            </div>
            <div className="rounded-lg border border-[color:var(--findable-hairline,#23252a)] p-3">
              <p className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-xl">
                25%
              </p>
              <p className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs leading-relaxed">
                기존 검색 트래픽이 2026년까지 줄어들 거라는 예측
              </p>
              <p className="mt-1 text-[color:var(--findable-ink-tertiary,#7e8289)] text-[10px]">
                — Gartner (2024년 발표한 예측치)
              </p>
            </div>
          </div>

          <p
            className="text-2xl text-[color:var(--findable-ink,#f7f8f8)] leading-snug"
            style={{ fontFamily: "var(--findable-font-display)" }}
          >
            &ldquo;AI는 지금 우리 브랜드를 추천하고 있을까요?&rdquo;
          </p>
          <p className="mt-4 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
            ChatGPT · HyperCLOVA · Perplexity · 네이버 · Claude · 다음 · Gemini.
            한국어와 영어 7개 AI 답변에서 우리 브랜드가 어디에 있는지
            추적합니다.
          </p>
          {/* 🔴 2026-08-17(N-37) — 소셜프루프. 경쟁사 4곳은 이 자리에 **고객 로고**를
              두는데(Profound 18개·Scrunch "500개사") 우리는 고객 0명이라
              **흉내내면 그 순간 날조**다. → web 랜딩(`credibility.tsx`)이 이미 검증해 둔
              **같은 사실 3개만** 재사용한다(문구가 갈리면 어느 쪽이 맞는지 알 수 없게 된다).
              ⛔ "고객사"·"도입"·"KAIST 인증 기술" 금지 — 전부 거짓이다. */}
          <ul className="mt-6 flex flex-col gap-1.5 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
            <li>KAIST OverEdge 2026 선정</li>
            <li>생성형 AI 활용 경진대회 최우수상</li>
            <li>K-GEO-Bench 공개 데이터셋 발행 (CC BY 4.0)</li>
          </ul>

          {/* AI 엔진 로고 — haloX 참조. Findable이 실제로 추적하는 엔진이라 날조가 아니다
              (위 문단의 "7개 AI"와 같은 사실, 로고로 시각화만 다르게 한 것). */}
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
            <span>ChatGPT</span>
            <span>Perplexity</span>
            <span>Claude</span>
            <span>Gemini</span>
            <span>NAVER</span>
          </div>

          <p className="mt-6 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs tracking-wide">
            Agentic GEO Platform
          </p>
        </div>
      </div>

      {/* 우측 폼 패널 */}
      <div className="flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-[380px]">
          {/* 모바일 워드마크 */}
          <div
            className="mb-8 text-center text-[color:var(--findable-ink,#f7f8f8)] text-xl lg:hidden"
            style={{ fontFamily: '"Instrument Serif", serif' }}
          >
            Findable
          </div>
          {children}
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
