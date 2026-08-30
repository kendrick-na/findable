import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const proxy = readFileSync(
  join(process.cwd(), "../../apps/web/proxy.ts"),
  "utf8"
);

describe("공개 랜딩 접근성", () => {
  it("봇 오탐이 공개 랜딩·언어 루트를 403으로 막지 않는다", () => {
    expect(proxy).toContain("isPublicLandingPath");
    expect(proxy).toContain("if (isPublicLandingPath(request.nextUrl.pathname))");
  });
});
