import { env } from "@/env";
import "./styles.css";
import { AnalyticsProvider } from "@repo/analytics/provider";
import { DesignSystemProvider } from "@repo/design-system";
import { fonts } from "@repo/design-system/lib/fonts";
import { Toolbar } from "@repo/feature-flags/components/toolbar";
import type { ReactNode } from "react";

interface RootLayoutProperties {
  readonly children: ReactNode;
}

/*
 * 🔴🔴 S4(2026-08-11 세션N-19) — **`lang="en"` → `lang="ko"`**.
 *
 * 🔬 스크린샷 눈확인에서 발견: 요금제 부연 문구가 *"정해드 / 려요"* 처럼 **단어를 쪼개고**
 *   있었다. 원인이 CSS 누락이 아니었다 — `packages/design-system/styles/globals.css:423`
 *   에 `:lang(ko) { word-break: keep-all }` 이 **이미 있는데**, 이 앱이 스스로를
 *   **영어라고 선언**해서 그 규칙이 **한 번도 적용된 적이 없었다.**
 *   (web 결과페이지는 `[locale]` 라우트라 제대로 붙는다 — app 만 빠져 있었다.)
 *
 * → 이 한 단어로 **앱 전 화면의 한국어 줄바꿈이 고쳐진다**(설계 v3 §5-1 규칙).
 * 🔊 부수 효과(의도): 스크린리더가 한국어를 **한국어 음성으로** 읽는다. `en` 이면
 *   한글을 영어 규칙으로 읽으려 해 발음이 무너진다(a11y).
 * ⚠️ app UI 는 **전부 한국어**다(i18n 라우팅 없음 · 사이드바·요금제·빈 상태 전수 확인).
 *   나중에 app 에 영어를 넣는다면 그때 `[locale]` 구조로 가야 하고, 이 값도 동적이어야 한다.
 */
const RootLayout = ({ children }: RootLayoutProperties) => (
  <html className={fonts} lang="ko" suppressHydrationWarning>
    <body>
      <AnalyticsProvider>
        {/* 🔴 대시보드는 **다크 고정**(2026-08-07 세션N-9).
            문제: next-themes 기본이 `system` 이라 OS 가 라이트면 <html class="light"> 가
            붙는데, Findable 토큰(--findable-ink 등)은 `:root` 에 **다크 값만** 있다.
            거기에 styles.css 의 라이트 폴백이 카드 배경만 #ffffff 로 바꿔서
            **흰 배경 + 흰 글씨**가 됐다 — 실측 대비율 ≈ 1.01:1(WCAG 최소 4.5:1).
            대시보드 주 숫자(86% · 1번째 · 긍정 100%)가 라이트 OS 사용자에게 안 보였다.

            왜 forcedTheme 인가: <html> 에 클래스만 박으면 프로바이더가 덮어쓴다.
            왜 라이트 테마를 만들지 않는가: Findable 브랜드가 Linear형 다크이고
            잉크4·표면4·헤어라인3 토큰이 전부 다크 전제로만 설계돼 있다.
            web 결과페이지도 이미 같은 선택을 했다(`audit/[jobId]/page.tsx` className="dark"). */}
        <DesignSystemProvider
          forcedTheme="dark"
          helpUrl={env.NEXT_PUBLIC_DOCS_URL}
          privacyUrl={new URL(
            "/legal/privacy",
            env.NEXT_PUBLIC_WEB_URL
          ).toString()}
          termsUrl={new URL("/legal/terms", env.NEXT_PUBLIC_WEB_URL).toString()}
        >
          {children}
        </DesignSystemProvider>
      </AnalyticsProvider>
      <Toolbar />
    </body>
  </html>
);

export default RootLayout;
