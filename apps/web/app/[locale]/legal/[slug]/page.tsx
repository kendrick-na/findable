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
  /**
   * 본문 위 "핵심 요약" 박스(쉬운 말 5~7줄). 본문을 대신하지 않는다 —
   * 마지막 줄에 "요약과 본문이 다르면 본문이 우선"을 반드시 둔다.
   */
  summary?: { items: string[]; title: string };
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
    updated: "2026년 10월 5일",
    // 📌 핵심 요약 — 제4조·제4조의2·제4조의3 을 쉬운 말로 줄인 것(2026-10-05). 본문을 바꾸면 같이 바꾼다.
    summary: {
      title: "핵심 요약",
      items: [
        "결제 방식: 월 단위 자동결제 또는 1개월 이용권(1회 결제) 중에서 고를 수 있어요. 1개월 이용권은 자동으로 갱신되지 않아요.",
        "해지: 월 단위 자동결제는 언제든 해지할 수 있어요. 해지하면 다음 결제는 청구되지 않고, 이미 결제한 기간이 끝날 때까지 이용할 수 있어요.",
        "갱신 결제가 실패하면 결제 예정일부터 7일 동안 유료 기능을 그대로 쓸 수 있고, 그 안에 결제되지 않으면 이용이 끝나요.",
        "결제일부터 7일 안에 청약철회할 수 있어요. 그동안 유료 기능을 쓰지 않았다면 전액 환불해요.",
        "유료 기능을 썼거나 7일이 지난 뒤 중간에 해지·환불하면, 쓴 날짜만큼만 빼고 나머지를 환불해요. 위약금이나 수수료는 받지 않아요.",
        "환불은 요금제 화면의 「환불·청약철회 요청」이나 이메일(kendrick@indigochild.kr)로 요청할 수 있고, 받은 날부터 3영업일 안에 결제를 취소해 환불해요.",
        "이 요약은 이해를 돕기 위한 것이에요. 요약과 아래 약관 본문이 다르면 본문이 우선해요.",
      ],
    },
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
      // 📅 [개정 2026-10-05 공지 · 2026-10-12 시행] 제4조~제4조의3 은 코드 실제 동작에 맞춘 개정.
      //   근거(코드): 카탈로그는 월 상품만(packages/payments/catalog.ts, 연 상품 없음) ·
      //   다음 청구일 = 1개월 뒤(billing-cycle.ts nextBillingDate) ·
      //   갱신 실패 유예 7일(RENEWAL_FAILURE_GRACE_DAYS) · 해지 시 결제 기간 종료일까지 유지
      //   (apps/app/lib/billing/period-end-expiry.ts) · 앱 내 환불 요청 버튼 있음(요금제 화면, 처리는 운영자).
      //   유료 기능 예시 = 자동 재측정(auto-refresh-tracking cron)·측정 데이터 CSV 내보내기
      //   (apps/app/app/api/export/tracking.csv) — 코드에 있는 것만 적었다.
      {
        h: "제4조 (요금 및 결제)",
        p: "유료 플랜은 월 단위 자동결제 또는 1개월 이용권(1회 결제) 방식으로 결제됩니다. 월 단위 자동결제는 최초 결제일로부터 1개월마다 등록된 결제수단으로 자동 청구되며, 1개월 이용권은 결제일로부터 1개월 동안 이용할 수 있고 자동으로 갱신되지 않습니다. 결제는 결제대행사 포트원(PortOne)을 통해 처리되며, 실제 카드 결제·정산은 포트원과 제휴한 카드사·PG사가 담당합니다. 결제 즉시 효력이 발생합니다.",
      },
      {
        h: "제4조의2 (해지 및 갱신 결제 실패)",
        p: "(1) 이용자는 언제든지 월 단위 자동결제를 해지할 수 있습니다. 해지하면 다음 결제는 청구되지 않으며, 이미 결제한 이용 기간의 종료일까지 유료 기능을 이용한 뒤 이용이 종료됩니다. (2) 갱신 결제가 실패한 경우 결제 예정일로부터 7일 동안 유료 기능 이용이 유지되며, 그 기간 안에 결제가 완료되지 않으면 유료 기능 이용이 종료됩니다.",
      },
      // ⚖️ 제4조의3 문장별 근거 (1차 출처만, 2026-10-05 law.go.kr 원문 대조).
      //   [전상법] 전자상거래 등에서의 소비자보호에 관한 법률 [시행 2026.7.21. 법률 제21312호]
      //     https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=282793
      //   [전상령] 같은 법 시행령 [시행 2026.7.21. 대통령령 제36507호]
      //     https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=288143
      //   [방판법] 방문판매 등에 관한 법률 [시행 2026.10.2. 법률 제22044호]
      //     https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=290239
      //   [보호지침] 콘텐츠이용자 보호지침 [문화체육관광부고시 제2024-16호]
      //     https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000237546
      //   [분쟁기준] 소비자분쟁해결기준 [공정거래위원회고시 제2025-14호] 별표 2 인터넷콘텐츠업
      //     https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000270136
      //   (1) 7일·기산일 = 전상법 제17조 제1항 제1호 / 미사용 시 전액 = 같은 법 제18조 제2항 제2호,
      //       분쟁기준 인터넷콘텐츠업 3). "제공 개시"가 아닌 "유료 기능 이용"을 기준으로 삼는 것은
      //       법보다 이용자에게 유리하므로 허용된다(전상법 제35조는 불리한 약정만 무효로 한다).
      //   (2) 이용일수 공제 = 전상법 제17조 제2항 제5호 단서(가분적 용역·디지털콘텐츠는 제공이
      //       개시되지 않은 부분만 철회 가능) + 분쟁기준 인터넷콘텐츠업 5) 비고 단서(7일 이내 해지 시
      //       위약금 없이 이용일수 금액만 공제) / 위약금 없음 = 전상법 제18조 제9항 /
      //       고지하지 않으면 전액 = 전상법 제17조 제2항 단서·제6항, 전상령 제21조의2.
      //   (3) 표시·광고와 다른 경우 3개월·30일 = 전상법 제17조 제3항 / 전액 = 분쟁기준 인터넷콘텐츠업 2).
      //   (4) 언제든 해지 = 방판법 제31조 / 이용일수만 공제 = 방판법 제32조 제1항·제3항(이미 공급한
      //       대가를 초과해 받은 금액은 환급), 분쟁기준 인터넷콘텐츠업 5).
      //       ✅ [확정 2026-10-05 · 대표 승인] 중도 해지 위약금·수수료 0%. 보호지침 제16조 제3항·
      //       제25조 제1항·분쟁기준이 허용하는 잔여 요금 공제(상한)는 쓰지 않는다. 법이 허용한
      //       상한보다 이용자에게 유리한 약정이므로 유효하다(방판법 제52조·전상법 제35조는 소비자에게
      //       불리한 약정만 무효로 한다 — 2026-10-05 law.go.kr 원문 대조).
      //   (5) 이메일·앱 내 요청 접수 = 전상법 제5조 제4항(전자문서로 철회 가능), 보호지침 제24조 제1항 제3호 /
      //       앱 내 요청 = apps/app/app/(authenticated)/features/billing/refund-request.tsx /
      //       발송일 효력 = 전상법 제17조 제4항.
      //   (6) 3영업일 = 전상법 제18조 제2항 제2호, 보호지침 제17조 제1항 / 카드 청구 정지·취소 요청 =
      //       전상법 제18조 제3항 / 지연배상금 = 전상법 제18조 제2항 후단, 전상령 제21조의3(연 15%),
      //       방판법 제32조 제3항 후단.
      //   (7) 전액 환불 시 권한 회수·다음 결제 취소 = 코드 동작(apps/app/app/webhooks/payments/route.ts).
      //       ⚠️ 부분 환불은 웹훅이 권한·예약을 건드리지 않는다(같은 파일 handlePartialCancelledPayment)
      //       → (2)·(4) 환불 시 운영자가 앱에서 정기결제 해지를 함께 처리해야 문장과 일치한다.
      //   ⚠️ 변호사 검토 권장(시행 2026-10-12 전). 시행일·중도 해지 공제율(0%)·관할은 2026-10-05 대표 승인.
      {
        h: "제4조의3 (청약철회 및 환불)",
        p: "(1) 이용자는 유료 플랜 결제일(유료 기능의 제공이 결제일보다 늦게 시작된 경우에는 그 시작일)부터 7일 이내에 청약철회를 할 수 있습니다. 이 기간에 유료 기능(자동 재측정, 측정 데이터 내보내기)의 이용 이력이 없는 경우 결제 금액 전액을 환불합니다. (2) 제1항의 기간에 유료 기능의 이용 이력이 있는 경우에는 결제 금액에서 결제일부터 청약철회일까지의 이용일수에 해당하는 금액(결제 금액 × 이용일수 ÷ 해당 이용 기간의 총일수)만 공제하고 나머지를 환불하며, 위약금은 청구하지 않습니다. 다만, 회사가 결제 전에 이 내용을 결제 화면 등 이용자가 쉽게 알 수 있는 곳에 명확하게 표시하지 않은 경우에는 결제 금액 전액을 환불합니다. (3) 유료 기능의 내용이 표시·광고의 내용과 다르거나 계약 내용과 다르게 이행된 경우에는 제1항 및 제2항과 관계없이 그 기능을 제공받은 날부터 3개월 이내, 그 사실을 안 날 또는 알 수 있었던 날부터 30일 이내에 청약철회를 할 수 있으며, 이 경우 결제 금액 전액을 환불합니다. (4) 결제일부터 7일이 지난 뒤에도 이용자는 이용 기간 중 언제든지 즉시 해지와 환불을 요청할 수 있습니다. 이 경우 회사는 결제 금액에서 결제일부터 해지일까지의 이용일수에 해당하는 금액(결제 금액 × 이용일수 ÷ 해당 이용 기간의 총일수)만 공제하고 나머지를 환불하며, 위약금이나 수수료는 청구하지 않습니다. 환불 없이 이미 결제한 이용 기간의 종료일까지 이용하려는 경우에는 제4조의2 제1항에 따라 월 단위 자동결제를 해지할 수 있습니다. (5) 청약철회, 환불, 즉시 해지는 요금제 화면의 「환불·청약철회 요청」 또는 이메일(kendrick@indigochild.kr)로 요청할 수 있으며, 이메일 등 서면으로 한 청약철회는 그 의사표시를 발송한 날에 효력이 생깁니다. (6) 회사는 청약철회 또는 즉시 해지 요청을 받은 날부터 3영업일 이내에 결제대행사 포트원(PortOne)을 통해 결제를 취소하는 방법으로 환불하며, 신용카드로 결제한 경우에는 카드사에 대금 청구의 정지 또는 취소를 요청합니다. 환불이 늦어지면 관련 법령에 따른 지연배상금을 함께 지급합니다. (7) 전액 환불이 처리되면 해당 결제로 부여된 유료 기능 이용이 종료되고 예정된 다음 결제도 취소됩니다. 제2항 또는 제4항에 따라 환불하는 경우에도 이용 계약은 해지되며 다음 결제는 청구되지 않습니다.",
      },
      {
        h: "제5조 (회사의 의무)",
        p: "회사는 안정적인 서비스 운영, 개인정보 보호, 신속한 고객 지원을 제공할 의무가 있습니다. 다만 외부 AI 엔진(OpenAI·Anthropic 등)의 장애로 인한 서비스 중단은 책임지지 않습니다.",
      },
      {
        h: "제6조 (이용자의 의무)",
        p: "이용자는 (1) 타인의 정보 도용 금지, (2) 서비스 무단 복제·재배포 금지, (3) 결제 정보 정확 입력의 의무가 있습니다.",
      },
      // ⚖️ 제7조 근거 (2026-10-05 law.go.kr 원문 대조).
      //   전상법 제36조(전속관할): 통신판매업자와의 거래에 관련된 소는 소 제기 당시 소비자의 주소(없으면
      //     거소)를 관할하는 지방법원의 전속관할. 주소·거소가 분명하지 않으면 적용하지 않는다.
      //   방판법 제53조(전속관할): 특수판매(계속거래 포함) 관련 소도 같다. 주소·거소가 분명하지 않으면
      //     「민사소송법」의 관계 규정을 준용한다.
      //   → 특정 법원(구 문구 "청주지방법원")을 관할로 정하면 소비자 거래에서는 위 조항에 반한다.
      {
        h: "제7조 (분쟁 해결)",
        p: "본 약관과 관련된 분쟁은 대한민국 법률을 따릅니다. 회사와 이용자 사이에 발생한 분쟁에 관한 소송은 「민사소송법」에 따른 관할 법원에 제기합니다. 다만, 이용자가 소비자인 경우에는 소 제기 당시 이용자의 주소를, 주소가 없는 경우에는 거소를 관할하는 지방법원의 전속관할로 하며, 소 제기 당시 이용자의 주소 또는 거소가 분명하지 않은 경우에는 「민사소송법」에 따른 관할 법원에 제기합니다.",
      },
      // 📅 시행일(2026-10-05 대표 승인): 공지 2026-10-05 → 시행 2026-10-12(7일 전 공지).
      {
        h: "부칙",
        p: "본 약관은 2026년 5월 5일부터 시행됩니다. 개정된 제4조, 제4조의2, 제4조의3, 제7조와 핵심 요약은 2026년 10월 5일에 공지하고 2026년 10월 12일부터 시행됩니다.",
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
    updated: "October 5, 2026",
    // Key summary — plain-language version of Articles 4 to 4-3 (2026-10-05). Keep in sync with the text.
    summary: {
      title: "Key summary",
      items: [
        "Payment: choose a monthly automatic subscription or a one-month pass (single payment). A one-month pass does not renew automatically.",
        "Cancellation: you can cancel a monthly subscription at any time. No further payment is charged, and you keep access until the end of the period you already paid for.",
        "If a renewal payment fails, paid features stay available for 7 days from the scheduled payment date; if payment is not completed by then, access ends.",
        "You can withdraw within 7 days of payment. If you have not used any paid features in that time, you get a full refund.",
        "If you used paid features, or you cancel for a refund after 7 days, we deduct only the days you used and refund the rest. There is no penalty or fee.",
        "Request a refund with the refund/withdrawal request (환불·청약철회 요청) button on the billing page or by email (kendrick@indigochild.kr). We cancel the payment within 3 business days of receiving the request.",
        "This summary is for convenience only. If it differs from the terms below, the terms prevail.",
      ],
    },
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
      // Mirrors the Korean 제4조~제4조의3 (announced 2026-10-05, effective 2026-10-12).
      //   ⚠️ Legal review recommended for Article 4-3 (refunds).
      {
        h: "Article 4 (Fees and payment)",
        p: "Paid plans are paid either as a monthly automatic subscription or as a one-month pass (single payment). A monthly subscription is charged automatically to the registered payment method every month from the first payment date; a one-month pass can be used for one month from the payment date and does not renew automatically. Payments are processed through the payment provider PortOne, with actual card processing and settlement handled by PortOne's partnered card issuers and PG companies. Payments take effect immediately.",
      },
      {
        h: "Article 4-2 (Cancellation and failed renewals)",
        p: "(1) You may cancel a monthly subscription at any time. After cancellation no further payment is charged, and you keep access to paid features until the end of the period you have already paid for, after which access ends. (2) If a renewal payment fails, access to paid features continues for 7 days from the scheduled payment date; if payment is not completed within that period, access to paid features ends.",
      },
      {
        h: "Article 4-3 (Withdrawal and refunds)",
        // Sources: see the per-sentence citations above the Korean 제4조의3 (Korean text governs).
        p: "(1) You may withdraw within 7 days of the paid-plan payment date (or, if paid features start later than the payment date, from that start date). If you have not used any paid features (automatic re-measurement, measurement data export) during this period, the full amount is refunded. (2) If you have used paid features during the period in (1), only the amount for the days used from the payment date to the withdrawal date (payment amount × days used ÷ total days in the billing period) is deducted and the rest is refunded, with no penalty. However, if the Company did not clearly show this before payment, on the checkout screen or another place you can easily see, the full amount is refunded. (3) Regardless of (1) and (2), if the paid features differ from what was displayed or advertised, or are performed differently from the agreement, you may withdraw within 3 months of receiving them or within 30 days of the date you learned or could have learned of it, and the full amount is refunded. (4) Even after 7 days from payment, you may request immediate termination and a refund at any time during the billing period. In that case the Company deducts only the amount for the days used from the payment date to the termination date (payment amount × days used ÷ total days in the billing period) and refunds the rest, with no penalty or fee. If you prefer to keep access until the end of the period you have already paid for without a refund, you may cancel the monthly subscription under Article 4-2(1). (5) Withdrawal, refunds, and immediate termination can be requested with the refund/withdrawal request (환불·청약철회 요청) button on the billing page or by email (kendrick@indigochild.kr); a withdrawal made in writing, including by email, takes effect on the date it is sent. (6) The Company refunds within 3 business days of receiving a withdrawal or immediate-termination request by cancelling the payment through the payment provider PortOne, and for credit card payments asks the card issuer to stop or cancel the charge. If the refund is delayed, the Company also pays delay compensation as provided by applicable law. (7) When a full refund is processed, access to paid features granted by that payment ends and any scheduled next payment is cancelled. When a refund is made under (2) or (4), the agreement is also terminated and no further payment is charged.",
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
        // Sources: Article 36 of the E-Commerce Consumer Protection Act and Article 53 of the Door-to-Door
        //   Sales Act (see the Korean 제7조 comment). Korean text governs.
        p: "Disputes related to these terms are governed by the laws of the Republic of Korea. Lawsuits between the Company and a user are filed with the court having jurisdiction under the Civil Procedure Act. However, if the user is a consumer, the district court with jurisdiction over the user's domicile at the time the suit is filed (or, if there is none, the user's residence) has exclusive jurisdiction; if the user's domicile or residence is unclear at that time, the suit is filed with the court having jurisdiction under the Civil Procedure Act.",
      },
      {
        h: "Addendum",
        p: "These terms take effect on May 5, 2026. The amended Articles 4, 4-2, 4-3, and 7 and the key summary were announced on October 5, 2026 and take effect on October 12, 2026.",
      },
    ],
  },
};

/**
 * 🔴 meta description 이 `page.title` 이었다 — 「이용약관」 **4자**(실측 2026-09-02).
 *   검색 결과 스니펫이 제목의 반복이라 클릭 판단에 아무 정보도 못 준다.
 *   ⚠️ 약관·개인정보처리방침 **본문은 손대지 않는다**(전자상거래법 제13조 고지 항목이자
 *     카카오페이 심사 유지 항목). 여기서 바꾸는 것은 `<head>` 의 설명문뿐이다.
 */
const LEGAL_DESCRIPTIONS: Record<string, Record<string, string>> = {
  ko: {
    privacy:
      "파인더블(Findable)이 수집하는 개인정보 항목과 이용 목적, 보유 기간, 위탁 현황, 이용자의 권리와 행사 방법을 안내합니다.",
    terms:
      "파인더블(Findable) 서비스 이용약관입니다. 서비스 범위, 이용자와 회사의 의무, 요금과 결제, 취소·환불, 책임 범위를 규정합니다.",
  },
  en: {
    privacy:
      "What personal data Findable collects, why it is used, how long it is kept, who processes it, and how to exercise your rights.",
    terms:
      "Findable's terms of service: scope of the service, obligations of both sides, fees and payment, cancellation and refunds, and limits of liability.",
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
  const normalizedLocale = isKo ? "ko" : "en";
  return createMetadata({
    title: page.title,
    description: LEGAL_DESCRIPTIONS[normalizedLocale]?.[slug] ?? page.title,
    // 🔴 `locale`·`pathname` 을 넘긴다 — 이게 없어서 이 페이지들은 canonical·hreflang·og:url 이
    //   **전부 없었다**(실측: `/ko|/en` × `privacy|terms` 4 페이지).
    locale: normalizedLocale,
    pathname: `/legal/${slug}`,
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

        {page.summary ? (
          <section
            aria-labelledby="legal-summary"
            className="mt-10 rounded-md border border-[var(--findable-hairline)] bg-[var(--findable-surface-1)] px-5 py-4"
          >
            <h2
              className="text-[15px] text-[var(--findable-ink)]"
              id="legal-summary"
              style={{
                fontFamily: "var(--findable-font-sans)",
                fontWeight: 600,
              }}
            >
              {page.summary.title}
            </h2>
            <ul
              className="mt-2 list-disc space-y-1.5 pl-5 text-[14px] text-[var(--findable-ink-muted)] leading-[1.7]"
              style={{ fontFamily: "var(--findable-font-sans)" }}
            >
              {page.summary.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

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
