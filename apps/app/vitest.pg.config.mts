import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "__tests__/tracking-prisma-replay.test.ts",
      "__tests__/audit-revalidation-postgres.test.ts",
      "__tests__/prompt-attempt-ledger-postgres.test.ts",
      "__tests__/payment-refund-record-postgres.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./"),
      "@repo": path.resolve(import.meta.dirname, "../../packages"),
      "server-only": path.resolve(
        import.meta.dirname,
        "./__tests__/stubs/empty.ts"
      ),
    },
  },
});
