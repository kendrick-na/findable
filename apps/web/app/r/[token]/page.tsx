import {
  clientReportDisclosure,
  clientReportPdfFilename,
} from "@repo/audit/client-report/report-data";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { ClientReport } from "@/components/client-report/client-report";
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
  const disclosure = clientReportDisclosure(data);
  if (reportId && !print) {
    const userAgent = (await headers()).get("user-agent");
    after(() => recordClientReportView(reportId, userAgent));
  }
  const webUrl = reportId ? `${SITE_URL}/r/${token}` : `${SITE_URL}/r/…`;

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
            PDF 내려받기 (발행 당시 파일)
          </a>
        </div>
      ) : null}
      {!print && disclosure.isFrozenSnapshot ? (
        <aside
          style={{
            margin: "0 auto 16px",
            maxWidth: 794,
            border: "1px solid #d6d3d1",
            borderRadius: 8,
            background: "#fafaf9",
            color: "#57534e",
            padding: "12px 14px",
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: "#292524" }}>발행본 안내</strong>
          <div>
            이 리포트는 발행 시점에 저장된 동결 스냅숏입니다. 현재 측정값이나 현재
            엔진 상태를 보증하지 않습니다.
          </div>
          {disclosure.retiredEngineIds.length > 0 ? (
            <div>
              일부 과거 엔진 결과가 포함되어 있으며, 현재 측정 근거로 해석하지
              마세요.
            </div>
          ) : null}
        </aside>
      ) : null}
      <main className="fr fr-stack">
        <ClientReport data={data} webUrl={webUrl} />
      </main>
    </div>
  );
}
