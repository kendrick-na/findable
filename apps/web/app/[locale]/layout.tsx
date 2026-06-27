import "./styles.css";
import { AnalyticsProvider } from "@repo/analytics/provider";
import { Toolbar as CMSToolbar } from "@repo/cms/components/toolbar";
import { DesignSystemProvider } from "@repo/design-system";
import { fonts } from "@repo/design-system/lib/fonts";
import { cn } from "@repo/design-system/lib/utils";
import { Toolbar } from "@repo/feature-flags/components/toolbar";
import type { ReactNode } from "react";
import { Footer } from "./components/footer";

interface RootLayoutProperties {
  readonly children: ReactNode;
  readonly params: Promise<{
    locale: string;
  }>;
}

// next-forge Header 제거됨 (D-038): 홈은 자체 헤더 사용, 다른 페이지는 향후 별도 작업
const RootLayout = async ({ children, params }: RootLayoutProperties) => {
  const { locale } = await params;
  const htmlLang = locale.startsWith("ko") ? "ko" : "en";

  return (
    <html
      className={cn(fonts, "scroll-smooth")}
      lang={htmlLang}
      suppressHydrationWarning
    >
      <body>
        <AnalyticsProvider>
          <DesignSystemProvider>
            {children}
            <Footer locale={locale} />
          </DesignSystemProvider>
          <Toolbar />
          {/* BASEHUB 정식 토큰이 있을 때만 CMS toolbar 렌더. dev 더미값(bshb_pk_dummy_*)에선 비활성화. */}
          {process.env.BASEHUB_TOKEN &&
            !process.env.BASEHUB_TOKEN.includes("dummy") && <CMSToolbar />}
        </AnalyticsProvider>
      </body>
    </html>
  );
};

export default RootLayout;
