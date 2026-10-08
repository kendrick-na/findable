import "@/components/client-report/client-report.css";
import "@/components/client-report-v12/report-v12.css";
import "@/components/client-report-v12/report-v12-revise.css";
import "@/components/client-report-v12/report-v12-screen.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

// 고객 웹 리포트 전용 **루트 레이아웃**(2026-09-28).
//
// 왜 `[locale]` 밖인가: `[locale]/layout.tsx` 는 사이트 푸터·다크 테마·분석 스크립트를 붙인다.
// 이 페이지는 A4 문서를 그대로 인쇄(PDF)해야 해서 **아무것도 덧붙지 않은 빈 HTML** 이 필요하다.
// (app/ 루트에 layout 이 없어 폴더마다 자기 루트 레이아웃을 가질 수 있다.)

export const metadata: Metadata = {
  title: "AI 검색 진단 리포트 · Findable",
  // 고객 전용 문서 — 검색 노출 금지. 링크를 아는 사람만 연다.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const PRETENDARD =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css";

export default function ClientReportRootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    // suppressHydrationWarning: 모바일 축소 스크립트(page.tsx)가 hydration 전에 <html> 에
    // `--fr-scale` 스타일을 넣는다. 이 한 단계만 불일치를 허용한다(자식은 그대로 검사).
    <html lang="ko" suppressHydrationWarning>
      <head>
        <link crossOrigin="anonymous" href={PRETENDARD} rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
