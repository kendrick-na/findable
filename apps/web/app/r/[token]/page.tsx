import {
  clientReportPdfFilename,
  isClientReportSendApproved,
} from "@repo/audit/client-report/report-data";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { ClientReport } from "@/components/client-report/client-report";
import { ClientReportV12 } from "@/components/client-report-v12/report-v12";
import {
  loadClientReport,
  recordClientReportView,
} from "@/lib/client-report/load";

// 고객 웹 리포트 — `/r/<공유토큰>`.
//   화면: A4 11쪽을 회색 바탕에 쌓아 보여준다(모바일은 폭에 맞춰 축소).
//   `?print=1`: 여백·그림자 없는 A4 — PDF 생성기(Puppeteer)가 이 주소를 인쇄한다.
// 🔴 링크를 아는 사람만 연다(로그인 없음). 토큰은 256비트라 추측 불가, noindex.
// 🔴 매 요청 DB 를 읽는다(토큰 폐기가 즉시 반영돼야 하므로 캐시하지 않는다).

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ token: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;

const SITE_URL = (
  process.env.NEXT_PUBLIC_WEB_URL || "https://www.findable.co.kr"
).replace(/\/$/, "");

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { token } = await params;
  const loaded = await loadClientReport(
    token,
    first((await searchParams).fixture)
  );
  if (!loaded) {
    return { title: "리포트를 찾을 수 없습니다 · Findable" };
  }
  return {
    title: `${loaded.data.config.brand} AI 검색 진단 리포트 v${loaded.data.version} · Findable`,
  };
}

// 모바일: A4(794px)를 화면 폭에 맞춰 줄인다. 첫 그림 전에 돌아야 가로 스크롤이 번쩍이지 않아
// 인라인 스크립트로 둔다(외부 값 없음 — 고정 문자열).
const SCALE_SCRIPT =
  "(function(){var r=document.documentElement;function f(){var w=r.clientWidth;r.style.setProperty('--fr-scale',String(Math.min(1,(w-24)/794)))}f();addEventListener('resize',f)})();";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: v1(기존)·v2(v12) 두 템플릿 분기 + 화면/인쇄 분기를 한곳에 둔다
export default async function ClientReportPage({
  params,
  searchParams,
}: PageProps) {
  const { token } = await params;
  const sp = await searchParams;
  const print = first(sp.print) === "1";
  const loaded = await loadClientReport(token, first(sp.fixture));
  if (!loaded) {
    notFound();
  }

  const { reportId, data, pdfUrl } = loaded;
  if (reportId && !print) {
    const userAgent = (await headers()).get("user-agent");
    after(() => recordClientReportView(reportId, userAgent));
  }
  const webUrl = reportId ? `${SITE_URL}/r/${token}` : `${SITE_URL}/r/…`;

  // v2(측정 원본 + 사람 판별 승인) = v12 11쪽 템플릿. v1(9/28 import) = 기존 템플릿 그대로.
  if (data.schemaVersion === 2) {
    const sendApproved = isClientReportSendApproved(data);
    const fixture = first(sp.fixture);
    const pdfHref = `/r/${token}/pdf${reportId || !fixture ? "" : `?fixture=${encodeURIComponent(fixture)}`}`;
    return (
      <div className={`fr12-root ${print ? "fr12-print" : "fr12-screen"}`}>
        {print ? null : (
          <script
            // biome-ignore lint/security/noDangerouslySetInnerHtml: 고정 문자열(사용자 값 없음)
            dangerouslySetInnerHTML={{ __html: SCALE_SCRIPT }}
          />
        )}
        {print ? null : (
          <div className="fr12-bar">
            {sendApproved ? null : (
              <div className="internal" role="alert">
                내부 시안 — 대표 고객 발송 최종 승인 전입니다. 이 링크·PDF 를
                고객에게 보내지 마세요. (판별 검토: {data.review.reviewer}{" "}
                {data.review.reviewedAt?.slice(0, 10)})
              </div>
            )}
            <a download={clientReportPdfFilename(data)} href={pdfHref}>
              PDF 내려받기
            </a>
          </div>
        )}
        <main className="fr12">
          <ClientReportV12 data={data} sendApproved={sendApproved} />
        </main>
      </div>
    );
  }

  return (
    <div className={`fr-root ${print ? "fr-print" : "fr-screen"}`}>
      {print ? null : (
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: 고정 문자열(사용자 값 없음)
          dangerouslySetInnerHTML={{ __html: SCALE_SCRIPT }}
        />
      )}
      {!print && pdfUrl ? (
        <div className="fr-toolbar">
          <a download={clientReportPdfFilename(data)} href={pdfUrl}>
            PDF 내려받기
          </a>
        </div>
      ) : null}
      <main className="fr fr-stack">
        <ClientReport data={data} webUrl={webUrl} />
      </main>
    </div>
  );
}
