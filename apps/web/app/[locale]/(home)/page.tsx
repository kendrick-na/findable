import { getDictionary } from "@repo/internationalization";
import { JsonLd } from "@repo/seo/json-ld";
import { createMetadata } from "@repo/seo/metadata";
import type { Metadata } from "next";
import { env } from "@/env";
import { FooterCTA } from "./components/footer-cta";
import { Hero } from "./components/hero";
import { LiveCounter } from "./components/live-counter";
import { Showcase } from "./components/showcase";
import { StepSections } from "./components/step-sections";
import { ThreePillars } from "./components/three-pillars";

interface HomeProps {
  params: Promise<{
    locale: string;
  }>;
}

export const generateMetadata = async ({
  params,
}: HomeProps): Promise<Metadata> => {
  const { locale } = await params;
  const dictionary = await getDictionary(locale);

  return createMetadata(dictionary.web.home.meta);
};

// Findable v4 홈 (D-040 Linear 풀 시그니처, 2026-05-05 / D-044 LiveCounter 추가, 2026-05-07)
// 1) Hero — Linear canvas + Resend Serif H1 + 보조라인 + 라벤더 CTA
// 2) LiveCounter — D2SF용 라이브 운영 증거 (D+X일 / Audit / 추적 브랜드)
// 3) ThreePillars — Linear "Built for purpose" 3카드 + 아이소메트릭 와이어 SVG
// 4) StepSections — Linear feature-card 4단계 (측정/분석/추천/발행)
// 5) Showcase — Linear 시그니처 mock 3종 (Audit Tracker · SoV Chart · Code Diff)
// 6) FooterCTA — Linear cta-banner

// 홈 구조화 데이터(JSON-LD) — GEO/AEO 도그푸딩: AI 답변 엔진이 Findable을
// "한국 최초 Agentic GEO 플랫폼"으로 인용·이해하도록 SoftwareApplication + Organization 명시.
// 근거: KAIST OverEdge Day06(기술 SEO·JSON-LD) → docs/_적용/실행백로그. 문구는 dictionary와 동일.
const siteUrl = env.VERCEL_PROJECT_PRODUCTION_URL
  ? new URL(`https://${env.VERCEL_PROJECT_PRODUCTION_URL}`).toString()
  : "https://www.findable.co.kr";

const Home = async ({ params }: HomeProps) => {
  const { locale } = await params;
  const dictionary = await getDictionary(locale);

  return (
    <div className="min-h-screen bg-[var(--findable-canvas)]">
      <JsonLd
        code={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Findable",
          applicationCategory: "BusinessApplication",
          applicationSubCategory:
            "Generative Engine Optimization (GEO) Platform",
          operatingSystem: "Web",
          url: siteUrl,
          description: dictionary.web.home.meta.description,
          inLanguage: ["ko", "en"],
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
            url: siteUrl,
            slogan: "한국 최초 Agentic GEO Platform",
          },
        }}
      />
      <Hero dictionary={dictionary} locale={locale} />
      <LiveCounter locale={locale} />
      <ThreePillars locale={locale} />
      <StepSections locale={locale} />
      <Showcase locale={locale} />
      <FooterCTA locale={locale} />
    </div>
  );
};

export default Home;
