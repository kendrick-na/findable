import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isPreviewStubPublicRequest } from "../lib/preview-audit-stub-proxy";

const preview = { VERCEL_ENV: "preview" };
const REPORT = "/r/12345678901234567890123456789012";

describe("Preview public audit proxy boundary", () => {
  it("checks the narrow Preview bypass before invoking Clerk", () => {
    const proxy = readFileSync(
      fileURLToPath(new URL("../proxy.ts", import.meta.url)),
      "utf8"
    );
    expect(proxy).toContain('from "./lib/preview-audit-stub-proxy"');
    expect(proxy).toContain(
      "if (isPreviewStubPublicRequest(request.nextUrl.pathname))"
    );
  });

  it("allows only the public audit routes and capability report URL", () => {
    expect(isPreviewStubPublicRequest("/api/audit", preview)).toBe(true);
    expect(
      isPreviewStubPublicRequest(
        "/api/audit/11111111-1111-4111-8111-111111111111",
        preview
      )
    ).toBe(true);
    expect(isPreviewStubPublicRequest(REPORT, preview)).toBe(true);
    expect(isPreviewStubPublicRequest("/api/audit/not-a-job", preview)).toBe(
      false
    );
    expect(isPreviewStubPublicRequest("/api/audit/x/lead", preview)).toBe(
      false
    );
    expect(
      isPreviewStubPublicRequest(
        "/api/audit/11111111-1111-4111-8111-111111111111/crew",
        preview
      )
    ).toBe(false);
    expect(isPreviewStubPublicRequest("/api/admin/measure-one", preview)).toBe(
      false
    );
    expect(isPreviewStubPublicRequest(`${REPORT}/pdf`, preview)).toBe(false);
  });

  it("never bypasses Clerk outside Vercel Preview", () => {
    expect(
      isPreviewStubPublicRequest("/api/audit", { VERCEL_ENV: "production" })
    ).toBe(false);
    expect(
      isPreviewStubPublicRequest("/api/audit", { VERCEL_ENV: "development" })
    ).toBe(false);
    expect(isPreviewStubPublicRequest("/api/audit", {})).toBe(false);
  });
});
