// CLI 전용 — bun으로 스크립트를 돌릴 때 `server-only` 마커를 빈 모듈로 바꾼다.
// 앱 코드는 그대로 두고 --preload 로만 쓴다(vitest의 alias와 같은 역할).
// 사용: bun --preload ./scripts/bun-server-only-shim.mjs scripts/expo-revenue-run.ts <인자...>
import { plugin } from "bun";

plugin({
  name: "server-only-empty",
  setup(build) {
    build.module("server-only", () => ({ exports: {}, loader: "object" }));
  },
});
