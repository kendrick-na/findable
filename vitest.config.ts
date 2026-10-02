import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // apps/web tsconfig 는 Next 용 `jsx: "preserve"` 라 루트에서 .tsx 테스트를 돌리면 JSX 가 남는다.
  // 테스트 변환에서만 자동 JSX 런타임으로 바꾼다(앱 빌드와 무관).
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@repo/observability/log": `${root}packages/observability/log.ts`,
    },
  },
});
