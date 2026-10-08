import { isPaid } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { SwordsIcon } from "lucide-react";
import type { Metadata } from "next";
import { env } from "@/env";
import { canShowLatestAnalysis } from "@/lib/content/analysis-publication";
import {
  scopedBrands,
  scopedLatestOrgAudit,
  scopedLatestRunTracking,
} from "@/lib/db/scoped";
import { type AppDictionary, getAppDictionary } from "@/lib/i18n";
import { AnalysisBrandPicker } from "../components/analysis-brand-picker";
import { EmptyState } from "../components/empty-state";
import { Header } from "../components/header";
import { LockedSurface } from "../components/locked-surface";
import { CompetitorBoard } from "../features/analysis/competitor-board";
import { selectAnalysisBrandId } from "../lib/analysis-brand-selection";
import { buildCompetitorAnalysis } from "../lib/analysis-data";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = (await getAppDictionary()).comparePage;
  return { title: t.metaTitle, description: t.metaDescription };
};

type CompareLabels = AppDictionary["comparePage"];

// 🔴 2026-08-10 세션N-16 — **지어낸 숫자를 지웠다.**
//   예전엔 `42%·31%·18%` 라는 **실재하지 않는 수치**를 막대까지 그려 보여줬다.
//   "(예시)"라고 적혀 있어도 **화면은 숫자를 사실처럼 읽힌다**. 이 프로젝트 제1 규칙
//   (**사실 자동 생성 금지**)과 충돌하고, 리서치도 **블러/티저를 직접 기각**했다
//   (📕`05:109` — *"직접 조사한 연구 없다"* = 자기모순).
//   → 대신 **실제로 측정한 진단**(A2 와 같은 회차)을 링크한다. 숫자를 지어내지 않고도
//     "이게 뭔지"를 보여주는 유일한 정직한 방법이다.
const SAMPLE_AUDIT_URL = `${env.NEXT_PUBLIC_WEB_URL}/audit/d732a13a-9c3b-48ad-a9a0-7ea80f69e328?shared=1`;

const ComparePreview = ({ t }: { t: CompareLabels }) => (
  <div className="findable-card flex flex-col gap-3 p-6">
    <p className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
      {t.previewTitle}
    </p>
    <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
      {t.previewBody}
    </p>
  </div>
);

// 유료인데 아직 측정이 없는 경우. "준비 중"이 아니라 **다음 행동**을 준다.
// S2'(2026-08-11) — 공용 `EmptyState` 로 교체. ⚠️**2분기(no-run/no-ranking)는 유지**한다:
//   "측정을 안 했다"와 "측정했지만 순위 질문이 없었다"는 **다음 행동이 서로 다르다**
//   (등록하러 가기 vs 질문 추가하고 재측정). 하나로 합치면 틀린 안내가 된다.
//   `no-ranking` 은 이미 측정을 해본 사람이라 샘플 링크가 불필요하다 → `no-run` 에만 붙인다.
const NeedsMeasurement = ({
  common,
  reason,
  t,
}: {
  common: AppDictionary["common"];
  reason: "no-run" | "no-ranking";
  t: CompareLabels;
}) => (
  <EmptyState
    // 🐛 스크린샷 눈확인에서 잡은 것(2026-08-11): `no-ranking` 은 **이미 측정을 해본**
    //   사람인데 버튼이 "측정 시작하기"였다 — 설명문("질문을 추가하고 다시 측정")과
    //   어긋나고 **버튼 이름 = 실제 동작** 규칙(설계 v3 원인②)에 걸린다.
    //   → 두 분기의 다음 행동을 각자 정확한 말로 바꿨다.
    //   ⚠️ 목적지는 **둘 다 `/brand`** 다. 질문 추가 UI(`PromptWizard`)가 그 화면 안에 있다
    //     (`brand/page.tsx:138`). 처음엔 `/search` 로 보냈다가 실측으로 정정 —
    //     `/search` 는 범용 검색결과 화면이고 프롬프트와 무관하다.
    ctaHref="/brand"
    ctaLabel={reason === "no-run" ? common.startMeasuring : t.addQuestions}
    description={reason === "no-run" ? t.noRunBody : t.noRankingBody}
    icon={<SwordsIcon className="size-5" />}
    sampleHref={reason === "no-run" ? SAMPLE_AUDIT_URL : undefined}
    t={common}
    title={reason === "no-run" ? t.noRunTitle : t.noRankingTitle}
  />
);

const ComparePage = async ({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) => {
  const plan = await getCurrentPlan();
  const dict = await getAppDictionary();
  const t = dict.comparePage;

  // 잠금 유저에겐 DB 조회 자체를 하지 않는다(불필요한 쿼리 회피).
  if (!isPaid(plan)) {
    return (
      <>
        <Header page={t.title} pages={["Findable"]} />
        <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
          <LockedSurface
            bullets={[t.lockedBullet1, t.lockedBullet2, t.lockedBullet3]}
            desc={t.lockedDesc}
            preview={<ComparePreview t={t} />}
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
        createdAt: latest.createdAt,
        result: latest.result,
        status: latest.status,
        trackedAt: rows[0]?.trackedAt ?? null,
      })
    : false;
  const analysis = isReady ? buildCompetitorAnalysis(rows) : null;
  let content = (
    <NeedsMeasurement
      common={dict.common}
      reason={rows.length === 0 ? "no-run" : "no-ranking"}
      t={t}
    />
  );
  if (analysis) {
    content = (
      <CompetitorBoard
        data={analysis}
        relativeTime={dict.relativeTime}
        t={dict.competitorBoard}
      />
    );
  }
  if (latest && !isReady) {
    content = (
      <EmptyState
        ctaHref={`/history/${latest.id}`}
        ctaLabel={t.checkRun}
        description={t.provisionalBody}
        icon={<SwordsIcon className="size-5" />}
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
          path="/compare"
          selectedBrandId={selectedBrandId}
          t={dict.brandPicker}
        />
        {content}
      </div>
    </>
  );
};

export default ComparePage;
