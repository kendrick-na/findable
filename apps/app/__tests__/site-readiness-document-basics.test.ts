import { describe, expect, test } from "vitest";

import { evaluateSiteReadiness } from "@/lib/site-readiness/evaluate";

function report(html: string) {
  return evaluateSiteReadiness({
    aiBotsEvidence: "allowed",
    aiBotsStatus: "pass",
    finalUrl: "https://example.com/",
    html,
    llmsTxtEvidence: "not verified · informational only",
    robotsEvidence: "HTTP 200",
    robotsStatus: "pass",
    sitemapEvidence: "https://example.com/sitemap.xml · 1 URLs",
    sitemapStatus: "pass",
    statusCode: 200,
    targetUrl: "https://example.com/",
  });
}

describe("document foundation checks", () => {
  test("passes language, viewport and complete share metadata", () => {
    const checks = report(`
      <html lang="ko"><head>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta property="og:title" content="Findable" />
      <meta property="og:description" content="AI search readiness" />
      <meta property="og:image" content="https://example.com/og.png" />
      </head><body><main><h1>Findable</h1></main></body></html>
    `).checks;

    expect(checks.find((check) => check.id === "language")?.status).toBe(
      "pass"
    );
    expect(checks.find((check) => check.id === "viewport")?.status).toBe(
      "pass"
    );
    expect(checks.find((check) => check.id === "openGraph")?.status).toBe(
      "pass"
    );
  });

  test("warns when document foundation metadata is absent", () => {
    const checks = report(
      "<html><head></head><body><main></main></body></html>"
    ).checks;

    for (const id of ["language", "viewport", "openGraph"] as const) {
      expect(checks.find((check) => check.id === id)?.status).toBe("warning");
    }
  });
});
