"use client";

import { SignIn as ClerkSignIn } from "@clerk/nextjs";

/**
 * 로그인 — Clerk 표준 <SignIn/> 컴포넌트.
 *
 * ⚠️ 2026-07-29 전면 표준화: 기존 커스텀 흐름(signIn.sso/password/finalize =
 *   실험/Future API)은 로드되는 clerk-js(6.x)에서 미지원이라 sign_ins 400·
 *   "Oops, something went wrong"·로그인 루프를 유발했다. Clerk 공식 컴포넌트로
 *   교체해 세션·SSO 콜백·재방문·로그아웃을 전부 표준 흐름에 맡긴다.
 *
 * - 소셜 로그인(구글·카카오·네이버) 버튼은 Clerk 대시보드의 SSO Connections
 *   설정을 읽어 위젯이 자동 렌더한다(커스텀 버튼 코드 불필요).
 * - 브랜드 색·다크테마·폰트는 provider.tsx 의 appearance(baseTheme/variables/
 *   elements)로 주입된다.
 * - path 라우팅: 라우트가 [[...sign-in]] catch-all 이라 routing="path".
 * - 로그인 후 이동은 fallbackRedirectUrl="/"(대시보드). 이미 로그인된 유저가
 *   이 페이지에 오면 (unauthenticated)/layout 의 서버 가드가 먼저 / 로 보낸다.
 */
export const SignIn = () => (
  <ClerkSignIn
    fallbackRedirectUrl="/"
    path="/sign-in"
    routing="path"
    signUpUrl="/sign-up"
  />
);
