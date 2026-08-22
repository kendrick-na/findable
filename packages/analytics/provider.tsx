import { GoogleAnalytics } from "@next/third-parties/google";
import { Analytics as VercelAnalytics } from "@vercel/analytics/react";
import type { ReactNode } from "react";
import { keys } from "./keys";

interface AnalyticsProviderProps {
  readonly children: ReactNode;
}

const { NEXT_PUBLIC_GA_MEASUREMENT_ID } = keys();

/**
 * 🔴🔴 세션N-28 — `<VercelAnalytics />` 가 **앱 전체를 간헐적 500 으로 만들고 있었다.**
 *
 * 실측(로그인 상태로 대시보드 홈 8회 방문): **2~3회가 "Oops, something went wrong"**.
 * Vercel 로그: `Clerk: Unable to verify request … middleware did not run
 * (code=auth_signature_invalid)`.
 *
 * 사슬:
 *   ① Vercel Web Analytics 가 **프로젝트에서 비활성**이라 `/_vercel/insights/script.js` 가 **404**
 *      (web·app 양쪽 실측 404 — 즉 지표가 하나도 안 쌓이고 있었다)
 *   ② 그 404 는 `.js` 라서 **Clerk 미들웨어 matcher 의 정적 파일 제외에 걸려 검문을 건너뛴다**
 *   ③ 404 페이지를 그리려고 루트 레이아웃이 렌더되고, 거기서 `auth()` 가 불리는데
 *      ②에서 미들웨어를 안 탔으니 컨텍스트가 없다 → throw → **500**
 *
 * 📕 Clerk 공식 문서가 이 상황을 그대로 설명하며 **"정적 애셋 404 를 없애는 것이 root cause
 *    이자 가장 깔끔한 해결책"** 이라고 명시한다(clerk.com/docs/reference/nextjs/errors/
 *    auth-was-called · 2026-08-13 확인).
 *
 * → **끌 수 있게** 만든다. 지우지 않는 이유: 플랫폼에서 Analytics 를 켜는 날 코드를 다시
 *   고치게 만들면 안 된다. `NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS=1` 일 때만 렌더한다.
 * ⚠️ **켜기 전에 Vercel 프로젝트에서 Web Analytics 를 먼저 활성화할 것.** 순서를 뒤집으면
 *   같은 404 → 500 이 되살아난다.
 */
const vercelAnalyticsEnabled =
  process.env.NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS === "1";

export const AnalyticsProvider = ({ children }: AnalyticsProviderProps) => (
  <>
    {children}
    {vercelAnalyticsEnabled && <VercelAnalytics />}
    {NEXT_PUBLIC_GA_MEASUREMENT_ID && (
      <GoogleAnalytics gaId={NEXT_PUBLIC_GA_MEASUREMENT_ID} />
    )}
  </>
);
