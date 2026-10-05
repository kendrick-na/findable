// GET /r/<토큰>/pdf — 발행본 PDF 내려받기. **웹 링크와 같은 스냅숏**을 서버에서 인쇄한다.
//
// 🔴 권한·거부 규칙은 웹 링크와 똑같다(loadClientReport 재사용): 형식이 틀린 토큰·폐기(토큰 없음)·
//   판별 미승인 v2·만료 v2 → 404. PDF 용 HTML 을 따로 만들지 않는다 — `/r/<토큰>?print=1` 을 인쇄.
// 🔴 인쇄할 주소는 요청 Host 가 아니라 **설정된 사이트 주소**로 만든다(Host 위조로 서버가 남의 주소를
//   열게 하지 않게). 개발 서버에서만 요청 주소를 쓴다(fixture 확인용).
// ⚠️ 매 요청 Chromium 을 띄운다(수 초). 캐시하지 않는다 — 폐기·만료가 즉시 반영돼야 한다.

import { printClientReportPdf } from "@repo/audit/client-report/pdf";
import { clientReportPdfFilename } from "@repo/audit/client-report/report-data";
import { log } from "@repo/observability/log";
import { loadClientReport } from "@/lib/client-report/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SITE_URL = (
  process.env.NEXT_PUBLIC_WEB_URL || "https://www.findable.co.kr"
).replace(/\/$/, "");

const NOT_FOUND = new Response("Not found", {
  status: 404,
  headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const requestUrl = new URL(request.url);
  const fixture = requestUrl.searchParams.get("fixture") ?? undefined;
  const loaded = await loadClientReport(token, fixture);
  if (!loaded) {
    return NOT_FOUND.clone();
  }
  const base =
    process.env.NODE_ENV === "production" ? SITE_URL : requestUrl.origin;
  const target = new URL(`${base}/r/${encodeURIComponent(token)}`);
  if (process.env.NODE_ENV !== "production" && fixture) {
    target.searchParams.set("fixture", fixture);
  }
  try {
    const { buffer, pageCount } = await printClientReportPdf(target.toString());
    const filename = clientReportPdfFilename(loaded.data);
    log.info("client-report.pdf", { reportId: loaded.reportId, pageCount });
    return new Response(Buffer.from(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="report.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    log.error("client-report.pdf.failed", {
      reportId: loaded.reportId,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(
      "PDF 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
