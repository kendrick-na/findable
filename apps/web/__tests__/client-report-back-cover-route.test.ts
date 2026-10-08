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

const knowverse = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "fixtures/client-report/knowverse.report.json"),
    "utf8"
  )
) as ClientReportData;
const token = "a".repeat(43);

it.each([
  false,
  true,
])("renders the %s /r/<token> back cover with AI and search channels separated", async (print) => {
  vi.mocked(loadClientReport).mockResolvedValue({
    data: knowverse,
    pdfUrl: null,
    reportId: "historical-report",
  });
  const html = renderToStaticMarkup(
    await ClientReportPage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve(print ? { print: "1" } : {}),
    })
  );

  expect(html).toContain("AI 답변과 검색 노출을 구분해");
  expect(html).not.toContain("네이버 등 AI가 우리 브랜드를 어떻게");
  expect(html).toContain("발행본 안내");
});
