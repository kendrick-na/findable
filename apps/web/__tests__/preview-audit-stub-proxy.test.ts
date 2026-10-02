import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isPreviewStubPublicRequest } from "../lib/preview-audit-stub-proxy";

const previewStub = {
  VERCEL_ENV: "preview",
  FINDABLE_AUDIT_STUB_MODE: "1",
};

describe("Preview stub public audit proxy boundary", () => {
  it("checks the narrow Preview bypass before invoking Clerk", () => {
    const proxy = readFileSync(
      fileURLToPath(new URL("../proxy.ts", import.meta.url)),
      "utf8"
    );
    expect(proxy).toContain('from "./lib/preview-audit-stub-proxy"');
    expect(proxy).toContain("if (isPreviewStubPublicRequest(request.nextUrl.pathname))");
  });

  it("allows only the public audit routes and capability report URL", () => {
    expect(isPreviewStubPublicRequest("/api/audit", previewStub)).toBe(true);
    expect(
      isPreviewStubPublicRequest(
        "/api/audit/11111111-1111-4111-8111-111111111111",
        previewStub
      )
    ).toBe(true);
    expect(
      isPreviewStubPublicRequest(
        "/r/12345678901234567890123456789012",
        previewStub
      )
    ).toBe(true);
    expect(isPreviewStubPublicRequest("/api/audit/not-a-job", previewStub)).toBe(
      false
    );
    expect(isPreviewStubPublicRequest("/api/audit/x/lead", previewStub)).toBe(
      false
    );
    expect(isPreviewStubPublicRequest("/api/admin/measure-one", previewStub)).toBe(
      false
    );
    expect(
      isPreviewStubPublicRequest(
        "/r/12345678901234567890123456789012/pdf",
        previewStub
      )
    ).toBe(false);
  });

  it("never bypasses Clerk outside Preview stub mode", () => {
    expect(
      isPreviewStubPublicRequest("/api/audit", {
        VERCEL_ENV: "production",
        FINDABLE_AUDIT_STUB_MODE: "1",
      })
    ).toBe(false);
    expect(
      isPreviewStubPublicRequest("/api/audit", {
        VERCEL_ENV: "preview",
        FINDABLE_AUDIT_STUB_MODE: "0",
      })
    ).toBe(false);
  });
});
