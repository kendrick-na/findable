import { withToolbar } from "@repo/feature-flags/lib/toolbar";
import { config, withAnalyzer } from "@repo/next-config";
import { withLogging, withSentry } from "@repo/observability/next-config";
import type { NextConfig } from "next";
import { env } from "@/env";

let nextConfig: NextConfig = withToolbar(withLogging(config));

// PDF 리포트 복구(2026-08-10) — 상세 근거는 `apps/web/next.config.ts` 의 같은 블록 참조.
// app 도 러너를 직접 실행한다(`app/actions/brand/start-tracking.ts` → `runAuditJob`)
// → 여기도 chromium 바이너리가 없으면 PDF 가 실패한다.
// 🔬실측: app 27개 함수 중 `chromium.br` 포함 = **0개**.
// ⚠️ web 과 달리 라우트 글롭을 좁힐 수 없다 — 서버 액션은 **그 액션을 호출하는 페이지의
//    함수 안에서** 실행되고, 그 버튼은 여러 화면에 놓일 수 있어 특정 라우트에 매어두면
//    다른 화면에서 조용히 다시 깨진다. 그래서 전역 키(`/*`)를 쓴다.
nextConfig.outputFileTracingIncludes = {
  ...nextConfig.outputFileTracingIncludes,
  "/*": [
    "../../node_modules/.pnpm/@sparticuz+chromium*/node_modules/@sparticuz/chromium/bin/**/*",
  ],
};

if (env.VERCEL) {
  nextConfig = withSentry(nextConfig);
}

if (env.ANALYZE === "true") {
  nextConfig = withAnalyzer(nextConfig);
}

export default nextConfig;
