import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./"),
      "@repo": path.resolve(import.meta.dirname, "../../packages"),
      // 🔴 서버 전용 모듈을 테스트하려면 필수 (2026-08-08).
      //   `packages/payments/webhook.ts` 등은 `import "server-only"` 로 시작한다. 그 패키지는
      //   exports 조건이 `react-server` 일 때만 빈 모듈이고 **기본 경로는 최상단에서 throw** 하므로,
      //   조건 없이 import 하면 스위트가 통째로 죽는다(테스트 0개).
      //   ⚠️ 대안으로 `resolve.conditions: ["react-server", ...]` 를 전역에 주면 **React 가 깨진다**
      //     ("react-server condition must be enabled..." → sign-in·sign-up 동반 실패, 실측).
      //     그래서 조건을 건드리지 않고 이 마커 패키지만 빈 모듈로 바꾼다(Next 서버 번들과 동일 효과).
      "server-only": path.resolve(
        import.meta.dirname,
        "./__tests__/stubs/empty.ts"
      ),
      /*
       * 🔴 `@sentry/nextjs` 를 **한 복사본으로 고정** (2026-08-16).
       *   pnpm 은 peer 조합마다 물리 경로를 따로 만든다. `apps/app` 에
       *   `@playwright/test` 를 설치했더니 sentry 의 peer 키가 바뀌어
       *   (`next@...(@playwright/test@1.62.1)...`) `apps/app` 과
       *   `packages/observability` 가 **서로 다른 복사본**을 보게 됐다.
       *   그러면 `ops-alert.test.ts` 의 `vi.mock("@sentry/nextjs")` 가 대상 코드가
       *   실제로 로드하는 복사본을 못 가로채 **스파이가 0번 불린다**(테스트 4개 실패).
       *   ⚠️ 내 코드 변경 없이 **의존성 설치만으로** 깨졌다 — 이름 기반 mock 은
       *     워크스페이스에 패키지 하나만 추가돼도 무너지는 구조다.
       *   → 대상 코드(`packages/observability`)가 보는 경로로 단일화한다.
       */
      "@sentry/nextjs": path.resolve(
        import.meta.dirname,
        "../../packages/observability/node_modules/@sentry/nextjs"
      ),
    },
  },
});
