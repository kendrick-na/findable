// /legal/[slug] — Findable 정적 법적 고지 페이지 (BASEHUB 우회)
// privacy / terms 두 슬러그만 지원 (베타 단계)
// D-061 (2026-05-12): locale 분기 추가

import { createMetadata } from "@repo/seo/metadata";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

interface LegalPageProps {
  readonly params: Promise<{
    slug: string;
    locale: string;
  }>;
}

interface LegalDoc {
  sections: { h: string; p: string }[];
  title: string;
  updated: string;
}

const PAGES_KO: Record<string, LegalDoc> = {
  privacy: {
    title: "개인정보 처리방침",
    updated: "2026년 8월 12일",
    sections: [
      {
        h: "1. 수집하는 개인정보 항목",
        p: "Findable은 무료 진단 신청 시 이메일 주소와 도메인 URL을 수집합니다. 서비스 운영 과정에서 접속 IP 주소와 접속 기록이 자동으로 수집·저장됩니다(부정 이용 방지 목적). 유료 플랜 이용 시 결제 정보(결제대행사 포트원(PortOne)을 통해 처리), 결제 내역, 사용 로그를 수집합니다.",
      },
      {
        h: "2. 개인정보 수집·이용 목적",
        p: "수집한 정보는 (1) 진단 결과 PDF 발송, (2) 서비스 운영 및 고객 지원, (3) 결제 및 환불 처리, (4) 접속 IP·기록은 부정 이용 및 어뷰즈 방지, 서비스 안정성 확보 목적으로만 이용됩니다.",
      },
      {
        h: "3. AI 모델 학습에 이용하지 않습니다",
        p: "Findable은 이용자의 개인정보(이메일 주소, 이름, 연락처, 결제 정보)를 AI 모델의 학습에 이용하지 않습니다. 진단 과정에서 외부 AI 엔진에 전달되는 것은 진단 대상 브랜드명과 도메인 주소이며, 이용자의 개인정보는 전달되지 않습니다. 진단 결과로 수집되는 AI 답변 텍스트는 공개된 브랜드 정보에 대한 응답으로 개인정보에 해당하지 않으며, 서비스 품질 개선에 활용될 수 있습니다.",
      },
      {
        h: "4. 보유·이용 기간",
        p: "이메일·도메인 정보: 회원 탈퇴 시 또는 마지막 이용 후 3년. 결제 정보: 전자상거래법에 따라 5년. 접속 IP·접속 기록: 부정 이용 방지 목적으로 보관하며 목적 달성 시 파기합니다. 진단 결과: 본인 요청 시 즉시 삭제.",
      },
      {
        h: "5. 개인정보 처리 위탁",
        p: "Findable은 서비스 제공을 위해 다음과 같이 개인정보 처리 업무를 위탁하고 있습니다. 수탁자와 위탁 업무 내용은 다음과 같습니다: (1) Vercel Inc. — 서비스 호스팅 및 배포, (2) Neon Inc. — 데이터베이스 운영, (3) Clerk Inc. — 회원 인증 및 계정 관리, (4) 주식회사 코리아포트원(PortOne) — 결제 처리, (5) Resend Inc. — 진단 결과 및 안내 이메일 발송, (6) PostHog Inc. — 서비스 이용 분석. 위탁 계약 시 개인정보보호법에 따라 목적 외 처리 금지, 안전성 확보조치, 재위탁 제한, 수탁자 관리·감독, 손해배상 등의 사항을 계약에 반영하고 있으며, 수탁자가 변경되는 경우 지체 없이 본 방침을 통해 공개합니다.",
      },
      {
        h: "6. 제3자 제공",
        p: "다음 경우를 제외하고 제3자에게 제공하지 않습니다: (1) 이용자 동의, (2) 법령에 의한 요구. 진단 과정에서 외부 AI 엔진(OpenAI·Anthropic·Google·Perplexity·Naver·Kakao·NCloud HyperCLOVA·LETSUR 및 Vercel AI Gateway 경유 호출)과 웹 수집 서비스(Firecrawl·Browserbase)에 진단 대상 브랜드명과 도메인 주소가 전달되며, 이용자의 개인정보는 전달되지 않습니다.",
      },
      {
        h: "7. 이용자 권리",
        p: "개인정보 열람·정정·삭제·처리 정지를 요청할 수 있습니다. 문의: kendrick@indigochild.kr",
      },
      {
        h: "8. 개인정보 보호 책임자",
        p: "나현덕 (대표) · kendrick@indigochild.kr",
      },
    ],
  },
  terms: {
    title: "이용약관",
    updated: "2026년 7월 29일",
    sections: [
      {
        h: "제1조 (목적)",
        p: "본 약관은 Findable(이하 '회사')이 제공하는 AI 가시성 진단 및 GEO 최적화 서비스(이하 '서비스')의 이용 조건을 정합니다.",
      },
      {
        h: "제2조 (서비스 내용)",
        p: "회사는 (1) 무료 1회 진단(Free Audit), (2) 유료 플랜(Starter·Growth·Scale·Enterprise), (3) GEO 추천 액션 제공 서비스를 운영합니다. 베타 기간 일부 기능은 변경될 수 있습니다.",
      },
      {
        h: "제3조 (이용계약 성립)",
        p: "이용자는 이메일로 회원가입을 신청하고, 회사가 승낙함으로써 이용계약이 성립됩니다. 만 14세 미만은 가입할 수 없습니다.",
      },
      {
        h: "제4조 (요금 및 결제)",
        p: "유료 플랜은 월/연 단위로 결제됩니다. 결제는 결제대행사 포트원(PortOne)을 통해 처리되며, 실제 카드 결제·정산은 포트원과 제휴한 카드사·PG사가 담당합니다. 결제 즉시 효력이 발생하며, 환불은 결제일로부터 7일 이내 미사용분에 한해 가능합니다.",
      },
      {
        h: "제5조 (회사의 의무)",
        p: "회사는 안정적인 서비스 운영, 개인정보 보호, 신속한 고객 지원을 제공할 의무가 있습니다. 다만 외부 AI 엔진(OpenAI·Anthropic 등)의 장애로 인한 서비스 중단은 책임지지 않습니다.",
      },
      {
        h: "제6조 (이용자의 의무)",
        p: "이용자는 (1) 타인의 정보 도용 금지, (2) 서비스 무단 복제·재배포 금지, (3) 결제 정보 정확 입력의 의무가 있습니다.",
      },
      {
        h: "제7조 (분쟁 해결)",
        p: "본 약관과 관련된 분쟁은 대한민국 법률을 따르며, 청주지방법원을 관할 법원으로 합니다.",
      },
      {
        h: "부칙",
        p: "본 약관은 2026년 5월 5일부터 시행됩니다.",
      },
    ],
  },
};

const PAGES_EN: Record<string, LegalDoc> = {
  privacy: {
    title: "Privacy Policy",
    updated: "August 12, 2026",
    sections: [
      {
        h: "1. Information we collect",
        p: "When you request a free audit, Findable collects your email address and domain URL. During service operation, your access IP address and access logs are automatically collected and stored (for abuse prevention). On paid plans we also collect payment details (processed through the payment provider PortOne), billing history, and usage logs.",
      },
      {
        h: "2. How we use it",
        p: "Collected information is used only to (1) send your audit PDF, (2) operate the service and provide support, (3) process payments and refunds, and (4) use access IP and logs solely to prevent fraud and abuse and to ensure service stability.",
      },
      {
        h: "3. We do not train AI models on your personal data",
        p: "Findable does not use your personal data (email address, name, contact details, payment information) to train AI models. What we send to external AI engines during an audit is the brand name and domain being audited; your personal data is not transmitted. The AI response text collected as audit results consists of answers about publicly available brand information, does not constitute personal data, and may be used to improve service quality.",
      },
      {
        h: "4. Retention",
        p: "Email and domain data: until account deletion or 3 years after last use. Payment data: 5 years, per Korea's e-commerce law. Access IP and access logs: retained for abuse prevention and deleted once that purpose is fulfilled. Audit results: deleted immediately on request.",
      },
      {
        h: "5. Processing entrusted to third parties",
        p: "Findable entrusts personal data processing to the following providers in order to operate the service: (1) Vercel Inc. — service hosting and deployment, (2) Neon Inc. — database operation, (3) Clerk Inc. — account authentication and management, (4) PortOne Co., Ltd. — payment processing, (5) Resend Inc. — audit result and notification email delivery, (6) PostHog Inc. — service usage analytics. Our agreements with these processors reflect the requirements of Korea's Personal Information Protection Act, including prohibition of processing beyond the entrusted purpose, security measures, restrictions on sub-processing, supervision of the processor, and liability for damages. If a processor changes, we will update this policy without delay.",
      },
      {
        h: "6. Third-party disclosure",
        p: "We do not share data with third parties except: (1) with your consent, or (2) when required by law. During an audit, the brand name and domain being audited are sent to external AI engines (OpenAI · Anthropic · Google · Perplexity · Naver · Kakao · NCloud HyperCLOVA · LETSUR, including calls routed through Vercel AI Gateway) and web retrieval services (Firecrawl · Browserbase). Your personal data is not transmitted to them.",
      },
      {
        h: "7. Your rights",
        p: "You may request access, correction, deletion, or restriction of processing of your personal data. Contact: kendrick@indigochild.kr",
      },
      {
        h: "8. Data protection officer",
        p: "Hyundeok Na (CEO) · kendrick@indigochild.kr",
      },
    ],
  },
  terms: {
    title: "Terms of Service",
    updated: "July 29, 2026",
    sections: [
      {
        h: "Article 1 (Purpose)",
        p: 'These terms govern the use of the AI visibility audit and GEO optimization service (the "Service") provided by Findable (the "Company").',
      },
      {
        h: "Article 2 (Scope of the Service)",
        p: "The Company operates (1) a one-time Free Audit, (2) paid plans (Starter · Growth · Scale · Enterprise), and (3) GEO recommended-action services. Some features may change during the beta period.",
      },
      {
        h: "Article 3 (Formation of the agreement)",
        p: "You apply for an account by email, and the agreement is formed when the Company accepts. Users under 14 may not register.",
      },
      {
        h: "Article 4 (Fees and payment)",
        p: "Paid plans are billed monthly or annually. Payments are processed through the payment provider PortOne, with actual card processing and settlement handled by PortOne's partnered card issuers and PG companies. Payments take effect immediately, and refunds are available within 7 days of payment, limited to the unused portion.",
      },
      {
        h: "Article 5 (Company obligations)",
        p: "The Company is obligated to operate the Service reliably, protect personal data, and provide prompt support. It is not liable for outages caused by external AI engines (OpenAI, Anthropic, etc.).",
      },
      {
        h: "Article 6 (User obligations)",
        p: "You must (1) not misappropriate others' information, (2) not copy or redistribute the Service without authorization, and (3) enter accurate payment information.",
      },
      {
        h: "Article 7 (Dispute resolution)",
        p: "Disputes related to these terms are governed by the laws of the Republic of Korea, with the Cheongju District Court as the court of jurisdiction.",
      },
      {
        h: "Addendum",
        p: "These terms take effect on May 5, 2026.",
      },
    ],
  },
};

export const generateMetadata = async ({
  params,
}: LegalPageProps): Promise<Metadata> => {
  const { slug, locale } = await params;
  const isKo = locale.startsWith("ko");
  const page = (isKo ? PAGES_KO : PAGES_EN)[slug];
  if (!page) {
    return {};
  }
  return createMetadata({
    title: page.title,
    description: page.title,
  });
};

const LegalPage = async ({ params }: LegalPageProps) => {
  const { slug, locale } = await params;
  const isKo = locale.startsWith("ko");
  const lp = isKo ? "/ko" : "";
  const page = (isKo ? PAGES_KO : PAGES_EN)[slug];
  if (!page) {
    notFound();
  }

  const backLabel = isKo ? "홈으로 돌아가기" : "Back to home";
  const updatedLabel = isKo ? "최종 업데이트 · " : "Last updated · ";

  return (
    <div className="min-h-screen w-full bg-[var(--findable-canvas)] text-[var(--findable-ink)]">
      <div className="mx-auto max-w-3xl px-6 py-24">
        <Link
          className="inline-flex items-center gap-1.5 text-[13px] text-[var(--findable-ink-muted)] transition hover:text-[var(--findable-ink)]"
          href={lp || "/"}
          style={{ fontFamily: "var(--findable-font-sans)" }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel}
        </Link>

        <h1
          className="mt-8"
          style={{
            fontFamily: isKo
              ? "var(--findable-font-display-kr)"
              : "var(--findable-font-display)",
            fontSize: "clamp(32px, 4vw, 48px)",
            lineHeight: 1.15,
            letterSpacing: "-0.025em",
            fontWeight: 500,
          }}
        >
          {page.title}
        </h1>
        <p
          className="mt-3 text-[13px] text-[var(--findable-ink-tertiary)]"
          style={{ fontFamily: "var(--findable-font-mono)" }}
        >
          {updatedLabel}
          {page.updated}
        </p>

        <div className="mt-12 space-y-8">
          {page.sections.map((s) => (
            <section key={s.h}>
              <h2
                className="text-[16px] text-[var(--findable-ink)]"
                style={{
                  fontFamily: "var(--findable-font-sans)",
                  fontWeight: 600,
                }}
              >
                {s.h}
              </h2>
              <p
                className="mt-2 text-[14px] text-[var(--findable-ink-muted)] leading-[1.7]"
                style={{ fontFamily: "var(--findable-font-sans)" }}
              >
                {s.p}
              </p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LegalPage;
