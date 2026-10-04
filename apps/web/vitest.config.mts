import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./"),
      "@repo": path.resolve(import.meta.dirname, "../../packages"),
      "server-only": path.resolve(
        import.meta.dirname,
        "../app/__tests__/stubs/empty.ts"
      ),
    },
  },
});
