import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const source = readFileSync(
  join(
    import.meta.dirname,
    "../../web/app/[locale]/audit/[jobId]/components/audit-result.tsx"
  ),
  "utf8"
);

describe("audit result forbidden polling", () => {
  test("403 stops immediately instead of entering transient-error backoff", () => {
    const forbidden = source.indexOf("response.status === 403");
    const thrown = source.indexOf("throw new Error(body?.error");
    expect(forbidden).toBeGreaterThan(-1);
    expect(forbidden).toBeLessThan(thrown);
    expect(source).toContain('setError("REPORT_FORBIDDEN")');
  });

  test("the forbidden state tells the customer to switch organizations", () => {
    expect(source).toContain('message === "REPORT_FORBIDDEN"');
    expect(source).toContain("해당 조직으로 전환");
  });
});
