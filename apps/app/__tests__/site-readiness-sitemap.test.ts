import { describe, expect, test } from "vitest";

import { sitemapStatusForUrlCount } from "@/lib/site-readiness/scanner";

describe("sitemapStatusForUrlCount", () => {
  test("marks a syntactically valid but empty sitemap as a warning", () => {
    expect(sitemapStatusForUrlCount(0)).toBe("warning");
  });

  test("passes a sitemap that exposes at least one same-origin URL", () => {
    expect(sitemapStatusForUrlCount(1)).toBe("pass");
  });
});
