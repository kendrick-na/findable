import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");
const DATABASE_CLIENT = readFileSync(
  join(ROOT, "packages/database/index.ts"),
  "utf8"
);

describe("serverless database connection budget", () => {
  it("caps every runtime adapter pool at one connection", () => {
    // Vercel can run several app instances at once. The database's pooled
    // endpoint has a small session budget, so each instance must not inherit
    // node-postgres's default pool size of ten.
    expect(DATABASE_CLIENT).toMatch(
      /const adapter = new PrismaPg\(\{[\s\S]*?max: 1,/
    );
  });
});
