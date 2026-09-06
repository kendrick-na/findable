import { getDictionary } from "@repo/internationalization";
import { JsonLd } from "@repo/seo/json-ld";
import { createMetadata } from "@repo/seo/metadata";
import type { Metadata } from "next";
import { env } from "@/env";
import { Credibility } from "./components/credibility";
import { Faq } from "./components/faq";
import { FooterCTA } from "./components/footer-cta";
import { Hero } from "./components/hero";
import { HomeInsights } from "./components/home-insights";
import { LiveCounter } from "./components/live-counter";
import { RentVsEquity } from "./components/rent-vs-equity";
import { Showcase } from "./components/showcase";
import { StepSections } from "./components/step-sections";
import { ThreePillars } from "./components/three-pillars";

interface HomeProps {
  params: Promise<{
    locale: string;
  }>;
}

// ⚡ ISR (2026-07-30 성능): [locale] 동적 파라미터라 www 전 페이지가 매 요청 SSR로 돌고 있었다
//   (cache-control: no-store, x-vercel-cache: MISS 고정 → 콜드 TTFB ~1.5s).
//   홈은 dynamic API(headers/cookies/searchParams) 사용 0 → 30분 ISR로 CDN 캐시.
//   LiveCounter의 DB 카운트도 이 주기로 갱신(컴포넌트 파일의 revalidate export는 무효였음).
export const revalidate = 1800;
// 홈은 로그인·개인화가 없는 공개 경로다. DB 기반 보조 지표도 아래 캐시 경계로
// 감싸므로, 매 방문 SSR 대신 정적/ISR 응답을 사용한다.
export const dynamic = "force-static";

export const generateMetadata = async ({
  params,
}: HomeProps): Promise<Metadata> => {
  const { locale } = await params;
  const dictionary = await getDictionary(locale);

  // locale·pathname 을 주면 hreflang(ko·en)+canonical+OG locale 이 생성된다(2026-08-08).
  // 검색어 나열용 meta keywords는 사용하지 않고, 실제 H1·본문·FAQ가 검색 의도를 설명하게 한다.
  return createMetadata({ ...dictionary.web.home.meta, locale, pathname: "/" });
};

// Findable v4 홈 (D-040 Linear 풀 시그니처, 2026-05-05 / D-044 LiveCounter 추가, 2026-05-07)
// 1) Hero — Linear canvas + Resend Serif H1 + 보조라인 + 라벤더 CTA
// 2) LiveCounter — D2SF용 라이브 운영 증거 (D+X일 / Audit / 추적 브랜드)
// 3) ThreePillars — Linear "Built for purpose" 3카드 + 아이소메트릭 와이어 SVG
// 4) StepSections — Linear feature-card 4단계 (측정/분석/추천/발행)
// 5) Showcase — Linear 시그니처 mock 3종 (Audit Tracker · SoV Chart · Code Diff)
// 6) FooterCTA — Linear cta-banner

// 홈 구조화 데이터(JSON-LD) — GEO/AEO 도그푸딩: AI 답변 엔진이 Findable을
// "네이버까지 진단하는 Agentic GEO 플랫폼"으로 인용·이해하도록 SoftwareApplication + Organization 명시.
// 근거: KAIST OverEdge Day06(기술 SEO·JSON-LD) → docs/_적용/실행백로그. 문구는 dictionary와 동일.
const siteOrigin = env.VERCEL_PROJECT_PRODUCTION_URL
  ? new URL(`https://${env.VERCEL_PROJECT_PRODUCTION_URL}`).origin
  : "https://www.findable.co.kr";

const Home = async ({ params }: HomeProps) => {
  const { locale } = await params;
  const dictionary = await getDictionary(locale);
  // JSON-LD의 대표 URL을 실제 canonical(`/ko` 또는 `/`)과 일치시킨다.
  // 루트 URL만 사용하면 한국어 홈과 브랜드 엔티티 신호가 분리될 수 있다.
  const siteUrl = `${siteOrigin}${locale.startsWith("ko") ? "/ko" : ""}`;

  return (
    <div className="min-h-screen bg-[var(--findable-canvas)]">
      <JsonLd
        code={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Findable",
          alternateName: ["파인더블", "Findable Korea"],
          applicationCategory: "BusinessApplication",
          applicationSubCategory:
            "Generative Engine Optimization (GEO) Platform",
          operatingSystem: "Web",
          url: siteUrl,
          description: dictionary.web.home.meta.description,
          inLanguage: locale.startsWith("ko") ? "ko-KR" : "en-US",
          offers: {
            "@type": "Offer",
            price: "0",
            priceCurrency: "KRW",
            description: "무료 도메인 진단 (3분, 1페이지 PDF 리포트)",
          },
          featureList: [
            "7개 AI 엔진 동시 추적 (ChatGPT · Claude · Perplexity · Gemini · HyperCLOVA X · 네이버 · 다음)",
            "Korean Entity Grounding (한글·영문·혼용 표기 통합 추적)",
            "무료 도메인 진단 및 Share of Voice 리포트",
            "4명의 자율 에이전트 기반 GEO 측정·최적화",
          ],
          provider: {
            "@type": "Organization",
            name: "Findable",
            alternateName: ["파인더블", "Findable Korea"],
            url: siteUrl,
            slogan:
              "네이버까지 진단하고 고칠 곳까지 알려주는 Agentic GEO 플랫폼",
          },
        }}
      />
      <JsonLd
        code={{
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "Findable",
          legalName: "인디고차일드",
          alternateName: ["파인더블", "Findable Korea"],
          url: siteUrl,
          email: "kendrick@indigochild.kr",
          description:
            "파인더블(Findable)은 ChatGPT·Claude·Perplexity·Gemini와 네이버·다음·하이퍼클로바 AI 검색에서 브랜드 언급·인용·가시성을 진단하고, SEO·GEO·AEO 개선 액션부터 브랜드별 AI 검색 전략 컨설팅까지 제공합니다.",
          founder: {
            "@type": "Person",
            name: "나현덕",
          },
        }}
      />
      <JsonLd
        code={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Findable",
          alternateName: ["파인더블", "Findable Korea"],
          url: siteUrl,
          description: dictionary.web.home.meta.description,
          inLanguage: locale.startsWith("ko") ? "ko-KR" : "en-US",
          publisher: {
            "@type": "Organization",
            name: "Findable",
            alternateName: ["파인더블", "Findable Korea"],
            url: siteUrl,
          },
        }}
      />
      <Hero dictionary={dictionary} locale={locale} />
      <LiveCounter locale={locale} />
      {/* 🔴 경쟁사가 **고객 로고 벽**을 두는 자리(Profound 18개·Scrunch 500개사).
          우리는 고객 0명이라 그대로 흉내내면 날조가 된다 →
          선정·수상 + "만든 팀이 해온 일" 로 대체. 상세 규율은 컴포넌트 주석. */}
      <Credibility locale={locale} />
      <HomeInsights locale={locale} />
      <ThreePillars locale={locale} />
      <StepSections locale={locale} />
      <Faq locale={locale} />
      <RentVsEquity locale={locale} />
      <Showcase locale={locale} />
      <FooterCTA locale={locale} />
    </div>
  );
};

export default Home;
