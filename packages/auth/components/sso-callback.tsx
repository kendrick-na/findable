"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

/**
 * OAuth(구글·카카오·네이버) 리다이렉트 복귀 지점 — Clerk 표준 콜백 핸들러.
 *
 * ⚠️ 2026-07-29 전면 표준화: 기존 커스텀(clerk.handleRedirectCallback 직접 호출 +
 *   모듈 전역 가드)은 state 토큰 재소비(state_token_already_used)·중복 콜백 문제를
 *   냈다. 표준 <AuthenticateWithRedirectCallback/> 는 콜백 완료·세션 활성화·이동을
 *   Clerk 이 한 번에 안전하게 처리한다(1회용 state 토큰 중복 소비 없음).
 *
 * 완료 후 이동: 로그인은 대시보드, 신규 가입은 온보딩(`/welcome`).
 * (표준 <SignIn/>/<SignUp/> 이 대부분의 소셜 흐름을 자체 완결하므로, 이 라우트는
 *  구형 링크·직접 진입에 대한 안전한 표준 폴백으로 유지한다.)
 */
export const SSOCallback = () => (
  <AuthenticateWithRedirectCallback
    signInFallbackRedirectUrl="/"
    signUpFallbackRedirectUrl="/welcome"
  />
);
