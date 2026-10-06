import { isPaid } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { LinkIcon } from "lucide-react";
import type { Metadata } from "next";
import { env } from "@/env";
import { canShowLatestAnalysis } from "@/lib/content/analysis-publication";
import {
  scopedBrands,
  scopedLatestOrgAudit,
  scopedLatestRunTracking,
} from "@/lib/db/scoped";
import { type AppDictionary, getAppDictionary, getAppLocale } from "@/lib/i18n";
import { AnalysisBrandPicker } from "../components/analysis-brand-picker";
import { EmptyState } from "../components/empty-state";
import { Header } from "../components/header";
import { LockedSurface } from "../components/locked-surface";
import { SourcesBoard } from "../features/analysis/sources-board";
import { selectAnalysisBrandId } from "../lib/analysis-brand-selection";
import { buildSourcesAnalysis } from "../lib/analysis-data";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = (await getAppDictionary()).sourcesPage;
  return { title: t.metaTitle, description: t.metaDescription };
};

type SourcesLabels = AppDictionary["sourcesPage"];

// 🔴 2026-08-10 세션N-16 — **지어낸 숫자를 지웠다.**
//   예전엔 `blog.naver.com 47 · 내 도메인 9 · namu.wiki 4` 라는 **실재하지 않는 수치**를
//   실제 표처럼 보여줬다. "(예시)" 라고 적어도 **화면은 숫자를 사실로 읽힌다**.
//   제1 규칙(**사실 자동 생성 금지**) 위반 + 리서치의 블러/티저 기각(📕`05:109`).
//   → 실제 측정 회차 링크로 대체(compare 와 동일 방침).
const SAMPLE_AUDIT_URL = `${env.NEXT_PUBLIC_WEB_URL}/audit/d732a13a-9c3b-48ad-a9a0-7ea80f69e328?shared=1`;

const SourcesPreview = ({ t }: { t: SourcesLabels }) => (
  <div className="findable-card flex flex-col gap-3 p-6">
    <p className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
      {t.previewTitle}
    </p>
    <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
      {t.previewBody}
    </p>
  </div>
);

// S2'(2026-08-11) — 공용 `EmptyState` 로 교체 + **실제 회차 링크를 여기에도 붙였다**
//   (잠금 프리뷰에만 있고 이 화면엔 없었다 — 유료 결제자가 측정 전에 보는 화면인데
//    "무엇이 보일지"를 글로만 설명하고 있었다. 같은 `SAMPLE_AUDIT_URL` 재사용 · 원가 0).
const NeedsMeasurement = ({
  common,
  t,
}: {
  common: AppDictionary["common"];
  t: SourcesLabels;
}) => (
  <EmptyState
    description={t.noRunBody}
    icon={<LinkIcon className="size-5" />}
    sampleHref={SAMPLE_AUDIT_URL}
    t={common}
    title={t.noRunTitle}
  />
);

const SourcesPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) => {
  const plan = await getCurrentPlan();
  const dict = await getAppDictionary();
  const t = dict.sourcesPage;

  if (!isPaid(plan)) {
    return (
      <>
        <Header page={t.title} pages={["Findable"]} />
        <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
          {/* 🔴 S4(2026-08-11) — 내부 용어 제거. 예전 첫 불릿이
              「언급(Mention)과 인용(Citation)을 **분리 집계**」였다 —
              `Mention/Citation` 은 GEO 업계 용어이고 '분리 집계'는 회계 용어처럼 읽힌다.
              같은 카드의 `desc`("우리 사이트인지, 남의 블로그인지")는 쉬운 말인데
              불릿만 딱딱해서 **한 카드 안에서 말투가 갈라져 있었다**(진단 §원인④·NN/g 4).
              ⚠️ JSX 는 **속성 사이에 중괄호 주석을 넣을 수 없다**(TS1005) → 요소 위로. */}
          <LockedSurface
            bullets={[t.lockedBullet1, t.lockedBullet2, t.lockedBullet3]}
            desc={t.lockedDesc}
            preview={<SourcesPreview t={t} />}
            sampleUrl={SAMPLE_AUDIT_URL}
            t={dict.lockedSurface}
            title={t.title}
            unlockPlan="Growth"
          />
        </div>
      </>
    );
  }

  const brands = await scopedBrands();
  const requestedBrandId = (await searchParams).brand;
  const mostRecent = requestedBrandId ? null : await scopedLatestOrgAudit();
  const selectedBrandId = selectAnalysisBrandId(
    brands.map((brand) => brand.id),
    requestedBrandId,
    mostRecent?.brandId
  );
  const latest = selectedBrandId
    ? await scopedLatestOrgAudit(selectedBrandId)
    : null;
  const rows = latest?.brandId
    ? await scopedLatestRunTracking(latest.brandId)
    : [];
  const isReady = latest
    ? canShowLatestAnalysis({
        citationBased: true,
        createdAt: latest.createdAt,
        result: latest.result,
        status: latest.status,
        trackedAt: rows[0]?.trackedAt ?? null,
      })
    : false;
  const analysis = isReady ? buildSourcesAnalysis(rows) : null;
  let content = <NeedsMeasurement common={dict.common} t={t} />;
  if (analysis) {
    content = (
      <SourcesBoard
        data={analysis}
        isKo={(await getAppLocale()) === "ko"}
        kindLabels={dict.sourceKinds}
        relativeTime={dict.relativeTime}
        t={dict.sourcesBoard}
      />
    );
  }
  if (latest && !isReady) {
    content = (
      <EmptyState
        ctaHref={`/history/${latest.id}`}
        ctaLabel={t.checkRun}
        description={t.provisionalBody}
        icon={<LinkIcon className="size-5" />}
        t={dict.common}
        title={t.provisionalTitle}
      />
    );
  }

  return (
    <>
      <Header page={t.title} pages={["Findable"]} showMetric={false} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
        <AnalysisBrandPicker
          brands={brands}
          path="/sources"
          selectedBrandId={selectedBrandId}
          t={dict.brandPicker}
        />
        {content}
      </div>
    </>
  );
};

export default SourcesPage;
