"use client";

import { SignUp as ClerkSignUp } from "@clerk/nextjs";

/**
 * 회원가입 — Clerk 표준 <SignUp/> 컴포넌트.
 *
 * ⚠️ 2026-07-29 전면 표준화: 기존 커스텀 흐름(signUp.password/verifications/
 *   finalize = 실험/Future API)은 clerk-js(6.x) 미지원이라 오류를 유발했다.
 *   Clerk 공식 컴포넌트로 교체(로그인과 동일 방침 → sign-in.tsx 참조).
 *
 * - 소셜 가입 버튼·이메일 인증은 Clerk 대시보드 설정대로 위젯이 자동 처리.
 * - 브랜드 외관은 provider.tsx 의 appearance 주입.
 * - 라우트가 [[...sign-up]] catch-all 이라 routing="path".
 */
export const SignUp = () => (
  <ClerkSignUp
    fallbackRedirectUrl="/welcome"
    path="/sign-up"
    routing="path"
    signInUrl="/sign-in"
  />
);
