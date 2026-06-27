import { showBetaFeature } from "@repo/feature-flags";
import { getDictionary } from "@repo/internationalization";
import { createMetadata } from "@repo/seo/metadata";
import type { Metadata } from "next";
import { DarkHedge } from "./components/dark-hedge";
import { FooterCTA } from "./components/footer-cta";
import { Hero } from "./components/hero";
import { Steps } from "./components/steps";

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

// Findable v1.0 홈페이지 (D-033 자연 일러스트 헤지 + D-037 시네마틱 모션)
// 1) Hero — 정선 「금강전도」 시간대 동적 톤 + Serif 헤드라인
// 2) Steps — Adaline 4단계 sticky 진행 인디케이터
// 3) DarkHedge — 75% 시점 다크 전환 + Number Ticker 카운트업
// 4) FooterCTA — 정선 「인왕제색도」 Hero 페어 + 최종 진단 CTA

const Home = async ({ params }: HomeProps) => {
  const { locale } = await params;
  const dictionary = await getDictionary(locale);
  const betaFeature = await showBetaFeature();

  return (
    <>
      {betaFeature && (
        <div className="w-full bg-[color:var(--findable-sumi-950)] py-2 text-center text-[color:var(--findable-mist-50)] text-sm">
          Findable v1.0 베타 — 무료 Audit 진행 중
        </div>
      )}
      <Hero dictionary={dictionary} />
      <Steps dictionary={dictionary} />
      <DarkHedge />
      <FooterCTA />
    </>
  );
};

export default Home;
