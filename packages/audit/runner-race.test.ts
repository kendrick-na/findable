import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");

describe("runner post-commit race contract", () => {
  it("does not replace the committed result after Tracking", () => {
    const trackingBlock = source.slice(source.indexOf("persistAuditTracking"));
    expect(trackingBlock).not.toMatch(
      /data:\s*\{\s*result:\s*\{[\s\S]*postProcessing/
    );
  });
});
