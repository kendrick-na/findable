// Audit PDF 생성기 — Puppeteer + @sparticuz/chromium
//
// Vercel Functions: @sparticuz/chromium의 사전 컴파일된 Chromium 사용.
// 로컬 개발: puppeteer-core가 시스템 Chrome을 찾도록 fallback.
//
// ⚠️ 이전 주석의 "50MB 한도" 는 **틀린 수치였다**(2026-08-10 공식 문서 실측:
//    Vercel Functions 비압축 한도 **250MB**). 그 오기재 때문에 PDF 실패 원인이
//    "바이너리 66MB 가 한도 초과" 로 3개월간 오진됐다.
// 🔴 진짜 원인 = **배포본에 바이너리가 아예 안 들어간 것**. 이 패키지는 바이너리를
//    `../bin/chromium.br` 처럼 런타임에 문자열로 조립해 찾는데, Next 의 추적기(@vercel/nft)는
//    정적 분석이라 그 경로를 못 본다 → 실측상 web 37개·app 27개 함수 중 포함 **0개**.
//    → 해결은 각 앱 `next.config.ts` 의 `outputFileTracingIncludes` 다(거기 주석 참조).
//    이 파일에서 경로를 바꿀 때는 **그 설정도 함께** 확인할 것.
//
// HTML → PDF 변환 후 Vercel Blob에 public 업로드 → URL 반환.

import { put } from "@repo/storage";
import { type AuditPdfData, renderAuditPdfHtml } from "./pdf-template";

async function getBrowser() {
  const isProduction = Boolean(
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
  );

  if (isProduction) {
    // 동적 import로 콜드 스타트 가속 (개발 환경에선 로드 안 됨)
    const [{ default: chromium }, puppeteer] = await Promise.all([
      import("@sparticuz/chromium"),
      import("puppeteer-core"),
    ]);

    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1240, height: 1754, deviceScaleFactor: 1 }, // A4 @ 150dpi
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  // 로컬 개발: 시스템 Chrome 사용. puppeteer-core는 chrome 자동 다운로드 안 함.
  // CHROME_PATH 환경변수 또는 일반 위치 시도.
  const puppeteer = await import("puppeteer-core");
  const executablePath =
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

  return puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

export interface GeneratePdfResult {
  generatedAt: Date;
  pdfSize: number;
  pdfUrl: string;
}

/**
 * Audit 결과 → 1페이지 한국어 PDF → Vercel Blob 업로드.
 * 실패 시 throw. 호출자가 try/catch.
 */
export async function generateAuditPdf(
  jobId: string,
  data: AuditPdfData
): Promise<GeneratePdfResult> {
  const html = renderAuditPdfHtml(data);
  const browser = await getBrowser();

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    // Pretendard CDN 폰트 로드 대기 (document.fonts.ready)
    await page.evaluate(() =>
      document.fonts ? document.fonts.ready : Promise.resolve()
    );

    const buffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: true,
    });

    // Vercel Blob 업로드. Public access — Audit 결과는 비밀 아님 (jobId secret).
    const filename = `audit-${jobId}-${Date.now()}.pdf`;
    const uploaded = await put(`audits/${filename}`, buffer as Buffer, {
      access: "public",
      contentType: "application/pdf",
      addRandomSuffix: false,
    });

    return {
      pdfUrl: uploaded.url,
      pdfSize: buffer.byteLength,
      generatedAt: new Date(),
    };
  } finally {
    await browser.close();
  }
}
