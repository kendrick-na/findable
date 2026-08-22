// /audit/[jobId] — Audit 결과 페이지 (PRD §13.1)

import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { createMetadata } from "@repo/seo/metadata";
import type { Metadata } from "next";
import { AuditResultView } from "./components/audit-result";
import { AuditSummarySsr } from "./components/audit-summary-ssr";

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
    title: isKo
      ? "AI 가시성 진단 결과 · Findable"
      : "AI Visibility Audit Result · Findable",
    description: isKo
      ? "Findable이 7개 AI 엔진에서 측정한 우리 브랜드의 Share of Voice·인용 순위·sentiment 결과입니다."
      : "Your brand's Share of Voice, citation rank, and sentiment across 7 AI engines.",
    image: ogUrl,
  });
};

/**
 * 요약부 서버 렌더용 조회 (S5 · 2026-08-11 세션N-19).
 *
 * 🔴 **왜 DB 를 직접 읽는가**: 자기 자신의 `/api/audit/[jobId]` 를 서버에서 fetch 하면
 *   요청이 한 번 더 왕복하고 캐시·인증 경계가 꼬인다. 같은 앱의 서버 컴포넌트가
 *   DB 를 직접 읽는 선례가 이미 있다(`(home)/components/live-counter.tsx`).
 *
 * 🔒 **`email` 을 select 하지 않는다** — 요약에 쓰지 않으므로 아예 가져오지 않는다
 *   (가져오면 실수로 렌더될 여지가 생긴다. 공유 링크 뷰에서 이메일 노출은 금지 규칙).
 *
 * ⚠️ best-effort: 실패해도 **본 화면(클라이언트 렌더)을 깨지 않는다.** 요약은 크롤러용
 *   보강이고, 사람에게 보이는 결과는 아래 `AuditResultView` 가 그대로 그린다.
 */
// 모듈 최상위에 둔다 — 함수 안에 쓰면 요청마다 정규식을 다시 만든다(lint 지적).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadSummaryJob(jobId: string) {
  // UUID 가 아니면 조회 자체를 하지 않는다(폴링 라우트와 같은 방어).
  if (!UUID_RE.test(jobId)) {
    return null;
  }
  try {
    return await database.auditJob.findUnique({
      where: { id: jobId },
      select: { domain: true, result: true, status: true },
    });
  } catch (error) {
    log.error("audit.ssr_summary.failed", { error: parseError(error) });
    return null;
  }
}

const AuditResultPage = async ({ params }: AuditResultPageProps) => {
  const { locale, jobId } = await params;
  const summaryJob = await loadSummaryJob(jobId);

  return (
    <div className="dark relative min-h-screen w-full overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Mesh gradient BG */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-grad-mesh-dark"
      />
      <div className="relative mx-auto max-w-7xl px-6 py-8 pb-24 lg:py-12 lg:pb-28">
        {/* 🔴 S5 — 크롤러가 읽을 수 있는 **요약부**(서버 렌더). AI 크롤러는 JS 를
            실행하지 않으므로 아래 클라이언트 뷰의 내용을 못 본다. 사람에게도 유효한
            요약이라 숨기지 않는다(구글: 안 보이는 콘텐츠 마크업 금지). */}
        {summaryJob && <AuditSummarySsr job={summaryJob} locale={locale} />}
        <AuditResultView jobId={jobId} locale={locale} />
      </div>
    </div>
  );
};

export default AuditResultPage;
