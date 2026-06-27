import { getDictionary } from "@repo/internationalization";
import { createMetadata } from "@repo/seo/metadata";
import type { Metadata } from "next";
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

const Home = async ({ params }: HomeProps) => {
  const { locale } = await params;
  const dictionary = await getDictionary(locale);

  return (
    <div className="min-h-screen bg-[var(--findable-canvas)]">
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
