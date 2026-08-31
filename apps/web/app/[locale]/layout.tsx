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

// ⚡ (2026-07-30 성능 근본원인) [locale]에 generateStaticParams 가 없어 www 전 라우트가
//   매 요청 SSR(ƒ·no-store)이었다 — 페이지 revalidate 만으론 SSG 로 안 바뀜(blog/[slug]만 ●였던 이유).
//   실사용 locale(ko·en)만 빌드타임 프리렌더. 그 외 locale 과 동적 API(searchParams 등)
//   쓰는 페이지는 자동으로 on-demand 유지(dynamicParams 기본 true).
export const generateStaticParams = () => [{ locale: "ko" }, { locale: "en" }];

// next-forge Header 제거됨 (D-038): 홈은 자체 헤더 사용, 다른 페이지는 향후 별도 작업
const RootLayout = async ({ children, params }: RootLayoutProperties) => {
  const { locale } = await params;
  const htmlLang = locale.startsWith("ko") ? "ko" : "en";

  return (
    <html
      className={cn(fonts)}
      lang={htmlLang}
      suppressHydrationWarning
    >
      <body>
        <AnalyticsProvider>
          {/* 🔴🔴 세션N-27 — `forcedTheme="dark"`. apps/app 이 세션N-19 에 똑같은 사고를
              고쳤는데(주석 그대로 남아 있다) **web 에는 적용되지 않았다**.
              프로바이더 기본값이 `defaultTheme="system"` + `enableSystem` 이라
              **OS 가 라이트인 방문자**에게 shadcn 토큰이 라이트로 풀렸다
              → `<header>` 가 흰 배경이 되고 그 위 흰 글자 = 대비 1.06:1.
              실측(1440px): OS 라이트 **7곳 위반** vs OS 다크 **0곳**.
              「Product」·「Sign in」 버튼과 워드마크가 **안 보였다**.
              ⚠️ <html> 에 클래스만 박으면 프로바이더가 덮어쓴다 → forcedTheme 이어야 한다.
              라이트 테마를 만들지 않는 이유: 브랜드가 Linear형 다크이고 잉크4·표면4·
              헤어라인3 토큰이 전부 다크 전제다(apps/app 과 동일한 판단). */}
          <DesignSystemProvider forcedTheme="dark">
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
