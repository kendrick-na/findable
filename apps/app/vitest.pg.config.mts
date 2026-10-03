import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/tracking-prisma-replay.test.ts", "__tests__/audit-revalidation-postgres.test.ts"],
  },
  resolve: {
    alias: {
      "@repo": path.resolve(import.meta.dirname, "../../packages"),
      "server-only": path.resolve(import.meta.dirname, "./__tests__/stubs/empty.ts"),
    },
  },
});
