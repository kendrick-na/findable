// /audit/[jobId] — Audit 결과 페이지 (PRD §13.1)

import { createMetadata } from "@repo/seo/metadata";
import type { Metadata } from "next";
import { AuditResultView } from "./components/audit-result";

interface AuditResultPageProps {
  params: Promise<{ locale: string; jobId: string }>;
}

export const generateMetadata = async ({
  params,
}: AuditResultPageProps): Promise<Metadata> => {
  const { locale, jobId } = await params;
  const isKo = locale.startsWith("ko");
  const ogUrl = `/api/og/audit/${jobId}`;
  return createMetadata({
    title: isKo ? "AI 가시성 진단 결과 — Findable" : "AI Visibility Audit Result — Findable",
    description: isKo
      ? "Findable이 7개 AI 엔진에서 측정한 우리 브랜드의 Share of Voice·인용 순위·sentiment 결과입니다."
      : "Your brand's Share of Voice, citation rank, and sentiment across 7 AI engines.",
    image: ogUrl,
  });
};

const AuditResultPage = async ({ params }: AuditResultPageProps) => {
  const { locale, jobId } = await params;

  return (
    <div className="dark relative min-h-screen w-full overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Mesh gradient BG */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-grad-mesh-dark"
      />
      <div className="relative mx-auto max-w-7xl px-6 py-8 pb-24 lg:py-12 lg:pb-28">
        <AuditResultView jobId={jobId} locale={locale} />
      </div>
    </div>
  );
};

export default AuditResultPage;
