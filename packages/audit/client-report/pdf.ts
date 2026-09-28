// 고객 웹 리포트 → PDF. **웹 페이지를 그대로 인쇄**한다(`/r/<토큰>?print=1`).
//
// 🔴 PDF 용 HTML 을 따로 만들지 않는 이유: 두 벌이면 언젠가 내용이 갈라진다(웹=정본, PDF=인쇄본).
//   브라우저 실행 경로는 무료 진단 PDF 와 같은 `getBrowser()` 를 쓴다
//   (Vercel 에선 @sparticuz/chromium — 이 함수를 부르는 라우트는 next.config 의
//   outputFileTracingIncludes 에 chromium 바이너리를 넣어야 한다. pdf-generator.ts 주석 참조).

import { getBrowser } from "../pdf-generator";

export interface PrintClientReportResult {
  buffer: Uint8Array;
  pageCount: number;
}

/** `reportUrl` = `/r/<토큰>` 전체 주소(쿼리 없이). `?print=1` 은 여기서 붙인다. */
export async function printClientReportPdf(
  reportUrl: string
): Promise<PrintClientReportResult> {
  const url = new URL(reportUrl);
  url.searchParams.set("print", "1");
  const browser = await getBrowser();
  try {
    const page = await browser.newPage();
    const res = await page.goto(url.toString(), {
      waitUntil: "networkidle0",
      timeout: 60_000,
    });
    if (!res?.ok()) {
      throw new Error(`리포트 페이지 응답 ${res?.status() ?? "없음"}`);
    }
    await page.evaluate(() =>
      document.fonts ? document.fonts.ready.then(() => undefined) : undefined
    );
    const pageCount = await page.evaluate(
      () => document.querySelectorAll("section.page").length
    );
    const buffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: true,
    });
    return { buffer, pageCount };
  } finally {
    await browser.close();
  }
}
