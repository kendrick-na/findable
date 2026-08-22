import { authMiddleware } from "@repo/auth/proxy";
import {
  noseconeOptions,
  noseconeOptionsWithToolbar,
  securityMiddleware,
} from "@repo/security/proxy";
import type { NextProxy } from "next/server";
import { env } from "./env";

const securityHeaders = env.FLAGS_SECRET
  ? securityMiddleware(noseconeOptionsWithToolbar)
  : securityMiddleware(noseconeOptions);

// Clerk middleware wraps other middleware in its callback
// For apps using Clerk, compose middleware inside authMiddleware callback
// For apps without Clerk, use createNEMO for composition (see apps/web)
export default authMiddleware(() => securityHeaders()) as unknown as NextProxy;

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // ⚠️ 세션N-28 — 여기에 `"/__clerk/(.*)"` 를 **넣었다가 뺐다.**
    //   Clerk 문서가 권장 3항목으로 제시하지만, 우리 앱에서는 추가 직후 `/billing` 이
    //   로그인 상태에서 500 을 냈다(실측: 변경 전 0/10 → 추가 후 2/10).
    //   프로덕션 인증 경로라 **근거 없이 유지하지 않는다** — 문서 권장보다 실측이 우선이다.
    //   🔬 다시 넣으려면 먼저 왜 깨지는지 규명할 것(우리는 `frontendApiProxy` 를 안 쓴다 →
    //      이 경로가 존재하지 않아 매칭이 되레 라우팅을 흔들 가능성).
  ],
};
