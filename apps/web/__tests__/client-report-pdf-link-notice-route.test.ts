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
  "저장된 PDF는 발행 당시 파일입니다. 현재 웹 화면의 고지·표시 보정이 반영됐는지 확인되지 않았으며, PDF 내용의 현재 유효성을 보증하지 않습니다.";

async function renderPage(
  pdf: string | null,
  print = false,
  reportData = data
): Promise<string> {
  vi.mocked(loadClientReport).mockResolvedValue({
    data: reportData,
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

it("warns beside any offered PDF link without requiring that link to remain offered", async () => {
  const html = await renderPage(pdfUrl);
  const toolbar = html.match(/<div class="fr-toolbar">([\s\S]*?)<\/div>/)?.[1];

  if (html.includes(pdfUrl)) {
    expect(toolbar).toContain(notice);
    expect(toolbar).toContain(
      "현재 웹 리포트의 저장 측정에는 네이버 Cue 재현(Findable 합성) 결과가 포함됩니다."
    );
    expect(toolbar).toContain(
      "현재 웹 리포트의 저장 측정에는 종료된 엔진 결과가 포함됩니다."
    );
    expect(toolbar).toContain(
      "현재 웹 리포트의 저장 측정에는 AI 답변과 검색 노출이 함께 포함됩니다."
    );
  } else {
    expect(html).not.toContain("PDF 내려받기");
  }
  expect(html).toContain("발행본 안내");
});

it("does not invent legacy or retired-engine reasons for a current-only snapshot", async () => {
  const currentOnly = {
    ...data,
    config: { ...data.config, measured_at: "2026.09.29" },
    computed: {
      ...data.computed,
      answers: data.computed.answers.filter(
        (answer) => answer.engine !== "hyperclova"
      ),
      engines: data.computed.engines.filter(
        (engine) => engine.id !== "hyperclova"
      ),
    },
  };
  const html = await renderPage(pdfUrl, false, currentOnly);

  expect(html).not.toContain(
    "네이버 Cue 재현(Findable 합성) 결과가 포함됩니다."
  );
  expect(html).not.toContain("종료된 엔진 결과가 포함됩니다.");
  if (html.includes(pdfUrl)) {
    expect(html).toContain(notice);
    expect(html).toContain("AI 답변과 검색 노출이 함께 포함됩니다.");
  }
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
