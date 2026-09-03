import { getDictionary } from "@repo/internationalization";
import { createMetadata } from "@repo/seo/metadata";
import type { Metadata } from "next";
import { FooterCTA } from "../(home)/components/footer-cta";
import { Footer } from "../components/footer";
import { PublicLandingHeader } from "../components/public-landing-header";
import { ContactForm } from "./components/contact-form";

// ⚡ ISR (2026-07-30 성능): dynamic API 사용 0 → 1시간 캐시(CDN). [locale] 전 페이지
//   매 요청 SSR이던 문제의 페이지 단위 해소. 카피 변경은 재배포로 반영.
export const revalidate = 3600;

interface ContactProps {
  params: Promise<{
    locale: string;
  }>;
}

export const generateMetadata = async ({
  params,
}: ContactProps): Promise<Metadata> => {
  const { locale } = await params;
  const dictionary = await getDictionary(locale);

  return createMetadata({
    ...dictionary.web.contact.meta,
    locale,
    pathname: "/contact",
  });
};

const Contact = async ({ params }: ContactProps) => {
  const { locale } = await params;
  const dictionary = await getDictionary(locale);

  return (
    <>
      <PublicLandingHeader locale={locale} />
      <ContactForm dictionary={dictionary} locale={locale} />
      <FooterCTA locale={locale} />
      <Footer locale={locale} />
    </>
  );
};

export default Contact;
