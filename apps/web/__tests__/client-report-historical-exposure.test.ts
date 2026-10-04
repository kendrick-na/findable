import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ClientReportData,
  clientReportDisclosure,
} from "@repo/audit/client-report/report-data";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

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
const oldPdfUrl = "https://example.test/issued/knowverse-old.pdf";
const token = "a".repeat(43);

beforeEach(() => {
  vi.mocked(loadClientReport).mockResolvedValue({
    data: knowverse,
    pdfUrl: oldPdfUrl,
    reportId: "historical-report",
  });
});

it("does not expose an unattested historical PDF URL in the public web render", async () => {
  const html = renderToStaticMarkup(
    await ClientReportPage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve({}),
    })
  );

  expect(html).not.toContain(oldPdfUrl);
  expect(html).toContain("발행본 안내");
});

it("does not present knowverse's causal claim as established fact in print", async () => {
  const html = renderToStaticMarkup(
    await ClientReportPage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve({ print: "1" }),
    })
  );

  expect(html).not.toContain("AI가 공식 사이트에 도달하지 못하면");
  expect(html).not.toContain("20일 뒤, AI의 대답이");
  expect(html).not.toContain("수정 문구까지 함께 만들어 드립니다");
  expect(html).not.toContain(knowverse.config.site_checks[0]?.item);
  expect(html).not.toContain(knowverse.config.site_checks[0]?.note);
  expect(html).not.toContain(
    "같은 질문에도 엔진마다 전혀 다른 회사를 설명합니다"
  );
  expect(html).not.toContain("AI가 근거로 삼은 출처 중 공식 사이트는");
  expect(html).toContain("발행본 안내");
});

it("does not trust a self-attested review embedded in public report JSON", async () => {
  const reviewed = {
    ...knowverse,
    publicationReview: {
      narrativeApproved: true,
      pdfUrl: oldPdfUrl,
      pdfSha256: "a".repeat(64),
      reviewedAt: "2026-10-04T10:00:00.000Z",
      reviewerUserId: "admin-1",
      snapshotAuditId: knowverse.source.auditId,
      snapshotImportedAt: knowverse.source.importedAt,
      snapshotVersion: knowverse.version,
      templateVersion: knowverse.templateVersion,
    },
  };
  vi.mocked(loadClientReport).mockResolvedValue({
    data: reviewed,
    pdfUrl: oldPdfUrl,
    reportId: "historical-report",
  });

  const html = renderToStaticMarkup(
    await ClientReportPage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve({}),
    })
  );

  expect(html).not.toContain(oldPdfUrl);
  expect(html).not.toContain("AI가 공식 사이트에 도달하지 못하면");
  expect(html).toContain("발행 당시 해석과 개선 제안은");
});

it("requires a separately trusted review and verified PDF digest to unlock", () => {
  const publicationReview = {
    narrativeApproved: true,
    pdfUrl: oldPdfUrl,
    pdfSha256: "a".repeat(64),
    reviewedAt: "2026-10-04T10:00:00.000Z",
    reviewerUserId: "admin-1",
    snapshotAuditId: knowverse.source.auditId,
    snapshotImportedAt: knowverse.source.importedAt,
    snapshotVersion: knowverse.version,
    templateVersion: knowverse.templateVersion,
  };
  const reviewed = { ...knowverse, publicationReview };

  expect(
    clientReportDisclosure(reviewed, oldPdfUrl, publicationReview)
      .pdfDownloadAttested
  ).toBe(false);
  expect(
    clientReportDisclosure(
      reviewed,
      oldPdfUrl,
      publicationReview,
      "a".repeat(64)
    )
  ).toMatchObject({ narrativeAttested: true, pdfDownloadAttested: true });
});

it("does not accept an attestation for another template snapshot", async () => {
  vi.mocked(loadClientReport).mockResolvedValue({
    data: {
      ...knowverse,
      publicationReview: {
        narrativeApproved: true,
        pdfUrl: oldPdfUrl,
        pdfSha256: "a".repeat(64),
        reviewedAt: "2026-10-04T10:00:00.000Z",
        reviewerUserId: "admin-1",
        snapshotAuditId: knowverse.source.auditId,
        snapshotImportedAt: knowverse.source.importedAt,
        snapshotVersion: knowverse.version,
        templateVersion: "another-template",
      },
    },
    pdfUrl: oldPdfUrl,
    reportId: "historical-report",
  });

  const html = renderToStaticMarkup(
    await ClientReportPage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve({}),
    })
  );

  expect(html).not.toContain(oldPdfUrl);
  expect(html).not.toContain("AI가 공식 사이트에 도달하지 못하면");
});

it("does not expose a PDF URL different from the reviewed artifact", async () => {
  vi.mocked(loadClientReport).mockResolvedValue({
    data: {
      ...knowverse,
      publicationReview: {
        narrativeApproved: true,
        pdfUrl: "https://example.test/issued/reviewed.pdf",
        pdfSha256: "a".repeat(64),
        reviewedAt: "2026-10-04T10:00:00.000Z",
        reviewerUserId: "admin-1",
        snapshotAuditId: knowverse.source.auditId,
        snapshotImportedAt: knowverse.source.importedAt,
        snapshotVersion: knowverse.version,
        templateVersion: knowverse.templateVersion,
      },
    },
    pdfUrl: oldPdfUrl,
    reportId: "historical-report",
  });

  const html = renderToStaticMarkup(
    await ClientReportPage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve({}),
    })
  );

  expect(html).not.toContain(oldPdfUrl);
  expect(html).not.toContain("AI가 공식 사이트에 도달하지 못하면");
});

it.each([
  false,
  true,
])("separates AI answers from search exposure on the %s back cover", async (print) => {
  const html = renderToStaticMarkup(
    await ClientReportPage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve(print ? { print: "1" } : {}),
    })
  );

  expect(html).not.toContain("네이버 등 AI가 우리 브랜드를 어떻게");
  expect(html).toContain("AI 답변과 검색 노출을 구분해");
});
