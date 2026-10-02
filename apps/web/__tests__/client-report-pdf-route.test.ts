// /r/<토큰>/pdf — 웹 링크와 같은 거부 규칙(형식·폐기·미승인·만료) + 설정된 사이트 주소만 인쇄.

import { beforeEach, describe, expect, it, vi } from "vitest";

const loader = vi.hoisted(() => ({ loadClientReport: vi.fn() }));
const printer = vi.hoisted(() => ({ printClientReportPdf: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../lib/client-report/load", () => loader);
vi.mock("@/lib/client-report/load", () => loader);
vi.mock("@repo/audit/client-report/pdf", () => printer);
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const route = await import("../app/r/[token]/pdf/route");
const TOKEN = "A".repeat(43);
const call = (token: string, host = "https://evil.example") =>
  route.GET(new Request(`${host}/r/${token}/pdf`), {
    params: Promise.resolve({ token }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  printer.printClientReportPdf.mockResolvedValue({
    buffer: new Uint8Array([37, 80, 68, 70]),
    pageCount: 11,
  });
});

describe("PDF 내려받기", () => {
  it("🔴 로더가 거부하면(형식·폐기·미승인·만료) 404, 인쇄하지 않는다", async () => {
    loader.loadClientReport.mockResolvedValue(null);
    const res = await call(TOKEN);
    expect(res.status).toBe(404);
    expect(printer.printClientReportPdf).not.toHaveBeenCalled();
  });

  it("발행본이면 PDF 첨부로 돌려주고, 캐시·색인 금지", async () => {
    loader.loadClientReport.mockResolvedValue({
      reportId: "r1",
      pdfUrl: null,
      data: {
        config: { brand: "노우버스", issued_at: "2026.09.30" },
        version: 1,
      },
    });
    const res = await call(TOKEN);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("content-disposition")).toContain(
      encodeURIComponent("노우버스_AI검색진단_v1_20260930.pdf")
    );
  });

  it("🔴 운영에서는 요청 Host 가 아니라 설정된 사이트 주소를 인쇄한다(Host 위조 방지)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    loader.loadClientReport.mockResolvedValue({
      reportId: "r1",
      pdfUrl: null,
      data: {
        config: { brand: "노우버스", issued_at: "2026.09.30" },
        version: 1,
      },
    });
    await call(TOKEN, "https://evil.example");
    const target = printer.printClientReportPdf.mock.calls[0][0] as string;
    expect(target.startsWith("https://evil.example")).toBe(false);
    expect(target).toMatch(/\/r\/A{43}$/);
    vi.unstubAllEnvs();
  });
});
