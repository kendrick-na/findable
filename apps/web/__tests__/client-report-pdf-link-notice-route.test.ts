import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClientReportData } from "@repo/audit/client-report/report-data";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/client-report/load", () => ({
  loadClientReport: vi.fn(),
  recordClientReportView: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "user-agent": "test" })),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
}));

import ClientReportPage from "../app/r/[token]/page";
import { loadClientReport } from "../lib/client-report/load";

const data = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "fixtures/client-report/knowverse.report.json"),
    "utf8"
  )
) as ClientReportData;
const token = "a".repeat(43);
const pdfUrl = "https://example.test/issued/knowverse-old.pdf";
const notice =
  "발행 당시 PDF 파일에는 현재 웹 리포트의 발행본 안내가 반영되지 않을 수 있습니다.";

async function renderPage(pdf: string | null, print = false): Promise<string> {
  vi.mocked(loadClientReport).mockResolvedValue({
    data,
    pdfUrl: pdf,
    reportId: "historical-report",
  });
  return renderToStaticMarkup(
    await ClientReportPage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve(print ? { print: "1" } : {}),
    })
  );
}

it("keeps a stored PDF link and places the issue-time warning beside it", async () => {
  const html = await renderPage(pdfUrl);
  const toolbar = html.match(/<div class="fr-toolbar">([\s\S]*?)<\/div>/)?.[1];

  expect(toolbar).toBeDefined();
  expect(toolbar).toContain(`href="${pdfUrl}"`);
  expect(toolbar).toContain(notice);
  expect(html).toContain("발행본 안내");
});

it("does not show a PDF warning when no stored PDF link exists", async () => {
  const html = await renderPage(null);

  expect(html).not.toContain('class="fr-toolbar"');
  expect(html).not.toContain(notice);
  expect(html).toContain("발행본 안내");
});

it("does not add a download toolbar or warning to print output", async () => {
  const html = await renderPage(pdfUrl, true);

  expect(html).not.toContain('class="fr-toolbar"');
  expect(html).not.toContain(notice);
  expect(html).toContain('data-report-disclosure="print"');
});
