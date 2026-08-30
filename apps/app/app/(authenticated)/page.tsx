import { isUsableRun } from "@repo/audit/run-quality";
import { hasPlan, isPaid } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { auth, currentUser } from "@repo/auth/server";
import { database } from "@repo/database";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  scopedAnnotations,
  scopedLatestRunTracking,
  scopedTracking,
} from "@/lib/db/scoped";
import { hasCompletedSetup } from "@/lib/onboarding";
import { BrandSwitcher } from "./components/brand-switcher";
import { DashboardEmptyState } from "./components/dashboard-empty-state-server";
import { DashboardKpis } from "./components/dashboard-kpis";
import { DashboardImpactEstimate } from "./components/dashboard-impact-estimate";
import { DashboardDeepAnalysis } from "./components/dashboard-deep-analysis";
import { DashboardRunContext } from "./components/dashboard-run-context";
import { Header } from "./components/header";
import { auditJobScope } from "./lib/audit-job-scope";
import { NextActionsCard } from "./components/next-actions-card";
import { OnboardingTour } from "./components/onboarding-tour";
import { PartnerCTA } from "./components/partner-cta";
import { PromptScoreboard } from "./components/prompt-scoreboard";
import { SovTrendChart } from "./components/sov-trend-chart";
import { TrendAnnotations } from "./components/trend-annotations";
import { UpgradeLadder } from "./components/upgrade-ladder";
import { TruthMirrorSection } from "./features/analysis/truth-mirror-section";
import { StartTrackingButton } from "./features/brand/start-tracking-button";
import {
  buildDashboardData,
  buildTrackingDashboardData,
} from "./lib/dashboard-data";
import { buildTruthMirrorData } from "./lib/truth-mirror-data";
import { getPrimaryEmail } from "./lib/user";

const title = "Findable Dashboard";
const description = "Your AI brand visibility hub.";

export const metadata: Metadata = {
  title,
  description,
};

interface AppProperties {
  // D10: 어떤 브랜드를 볼지. Next.js 16 이라 Promise 로 받는다(search/page.tsx 관례와 동일).
  searchParams: Promise<{ brand?: string }>;
}

const DashboardNoResultState = ({
  activeJobId,
  failedJobId,
  unavailableJobId,
  signedInEmail,
}: {
  activeJobId?: string;
  failedJobId?: string;
  unavailableJobId?: string;
  signedInEmail: string | null;
}) => {
  if (activeJobId) {
    return (
      <section className="findable-card flex min-h-[360px] flex-col items-center justify-center gap-4 p-8 text-center">
        <div
          aria-hidden="true"
          className="size-3 animate-pulse rounded-full bg-[color:var(--findable-primary,#ff7a4d)] motion-reduce:animate-none"
        />
        <div>
          <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
            첫 측정을 진행하고 있어요
          </h1>
          <p className="mt-2 max-w-md text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
            브랜드 설정은 완료됐어요. AI 답변을 수집한 뒤 이 대시보드와 측정
            이력에 결과가 쌓입니다.
          </p>
        </div>
        <Link
          className="findable-btn-primary inline-flex items-center rounded-md px-4 py-2 font-medium text-sm"
          href={`/brand/measuring?job=${activeJobId}`}
        >
          실시간 상태 보기
        </Link>
      </section>
    );
  }

  if (failedJobId) {
    return (
      <section className="findable-card flex min-h-[360px] flex-col items-center justify-center gap-4 p-8 text-center">
        <div>
          <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
            브랜드 설정은 완료됐지만 첫 측정에 실패했어요
          </h1>
          <p className="mt-2 max-w-md text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
            브랜드를 다시 입력할 필요는 없어요. 실패 사유를 확인한 뒤 기존
            브랜드에서 측정만 다시 시작하세요.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            className="findable-btn-primary inline-flex items-center rounded-md px-4 py-2 font-medium text-sm"
            href={`/history/${failedJobId}`}
          >
            실패 사유 보기
          </Link>
          <Link
            className="findable-btn-secondary inline-flex items-center rounded-md px-4 py-2 font-medium text-sm"
            href="/brand"
          >
            브랜드에서 다시 측정
          </Link>
        </div>
      </section>
    );
  }

  if (unavailableJobId) {
    return (
      <section className="findable-card flex min-h-[360px] flex-col items-center justify-center gap-4 p-8 text-center">
        <div>
          <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
            측정 요청은 끝났지만 AI 응답을 받지 못했어요
          </h1>
          <p className="mt-2 max-w-md text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
            0점이나 미노출이라는 뜻이 아니에요. 연결된 AI 응답이 없어 이번
            회차의 점수와 할 일을 만들 수 없습니다.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            className="findable-btn-primary inline-flex items-center rounded-md px-4 py-2 font-medium text-sm"
            href={`/history/${unavailableJobId}`}
          >
            측정 상세 보기
          </Link>
          <Link
            className="findable-btn-secondary inline-flex items-center rounded-md px-4 py-2 font-medium text-sm"
            href="/brand"
          >
            브랜드에서 다시 측정
          </Link>
        </div>
      </section>
    );
  }

  return <DashboardEmptyState signedInEmail={signedInEmail} />;
};

const App = async ({ searchParams }: AppProperties) => {
  const { brand: selectedBrandId } = await searchParams;
  const user = await currentUser();
  const email = user ? getPrimaryEmail(user) : null;
  const { orgId } = await auth();
  if (orgId && !(await hasCompletedSetup())) {
    redirect("/welcome");
  }
  const plan = await getCurrentPlan();

  // 조직 선택 중에는 조직 측정만 읽는다. 이메일 무료진단은 조직이 없을 때만 폴백한다.
  // 🔴🔴 **무거운 `result`(Json)를 조건부로만 읽는다** (2026-08-17 세션N-39 실측).
  //   [실측] 이 쿼리 하나가 **6,293ms** — 대시보드 서버 대기의 **83%** 였다.
  //     20행에 `result` Json 이 **837KB**(행당 42KB) 붙어 나온다.
  //     같은 쿼리에서 Json 만 빼면 **196ms** — **32배** 차이다.
  //   🔴 그런데 이 `result` 는 **Tracking 이 비었을 때만** 쓰는 폴백 입력이다
  //     (`buildDashboardData`). Tracking 이 있으면 읽고 **그대로 버린다.**
  //   [실측] org 4개 중 데이터가 있는 2개는 **둘 다 Tracking 보유**(197행·42행)
  //     → 실사용 경로에서 837KB 는 **전량 낭비**였다. 나머지 2개는 AuditJob 도 0건.
  //   ⚠️ 폴백을 없애는 게 아니다 — **필요할 때만** 무거운 컬럼을 읽는다.
  //     `hasData`·`buildDashboardData` 계약은 그대로다.
  const JOB_WHERE = auditJobScope(email, orgId);
  // 1차: 가벼운 컬럼만(= 화면이 Tracking 경로로 갈 때 필요한 전부).
  const jobsLite =
    JOB_WHERE
      ? await database.auditJob.findMany({
          where: JOB_WHERE,
          select: {
            id: true,
            domain: true,
            status: true,
            createdAt: true,
            completedAt: true,
            brandId: true,
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : [];

  // P5 8-d: KPI·추세의 1차 소스 = Tracking(org 시계열 원장, scopedTracking 으로 brand 경유
  // org 격리). Tracking 이 비면(무료 email 진단만 있는 유저 · 롤백 시) AuditJob 집계로 폴백
  // — dual-write 를 유지하는 이유가 이 백업 경로다.
  const trackingRows = orgId ? await scopedTracking() : [];
  // D10: `?brand=` 로 볼 브랜드를 고른다. 잘못된 값이면 집계 쪽이 최신으로 되돌린다
  //   (rows 는 scopedTracking 으로 이미 org 필터를 통과했으므로 여기서 못 찾는 id =
  //    내 것이 아님 → 404 대신 안전한 기본값).
  const trackingData = buildTrackingDashboardData(
    trackingRows,
    selectedBrandId
  );
  // 🔴 D10(2026-08-07): 여기 있던 `Math.max(trackingData.totalCount, jobs.length)` 를 뺐다.
  //   원래 의도는 "이력 리스트(AuditJob)보다 총 횟수가 적게 보이는 혼란 방지"였는데,
  //   totalCount 가 **보고 있는 브랜드의 측정 횟수**로 바뀐 지금은 그 보정이
  //   브랜드별 값을 다시 org 총계로 되돌려 **거짓 숫자**를 만든다
  //   (엔비디아 실측 1회인데 `측정 2회`로 표시 → 같은 화면 순위 카드의
  //    "비교는 2회차 측정부터"와 자기모순).
  //   ⚠️ 원래 혼란은 여전히 유효한 지적이다. 답은 숫자를 부풀리는 게 아니라
  //   **범위가 다르다는 걸 밝히는 것** — 하단 이력 섹션에 그 한 줄을 붙였다.
  // 2차: **Tracking 이 비어 폴백이 실제로 필요할 때만** 무거운 `result` 를 읽는다.
  //   여기 오는 경우 = 무료 email 진단만 있는 유저 · dual-write 롤백 시(주석 위 §참조).
  const jobsWithResult =
    trackingData === null && jobsLite.length > 0 && JOB_WHERE
      ? await database.auditJob.findMany({
          where: JOB_WHERE,
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : null;
  const data = trackingData ?? buildDashboardData(jobsWithResult ?? []);
  // Tracking 한 회차는 runner 가 AuditJob.completedAt 과 동일한 trackedAt 을 기록한다.
  // 이 연결을 화면에도 유지해야 리포트와 대시보드가 서로 다른 회차를 말하지 않는다.
  const currentRunJob = data.latestBrandId && data.latestMeasuredAt
    ? jobsLite.find(
        (job) =>
          job.status === "completed" &&
          job.brandId === data.latestBrandId &&
          job.completedAt?.getTime() === data.latestMeasuredAt?.getTime()
      )
    : null;
  // 생성형 분석도 반드시 현재 대시보드 회차에만 붙인다. 최신 브랜드의 다른 과거
  // 결과를 가져오면 점수와 분석 근거가 서로 다른 회차가 되는 오류가 재발한다.
  const currentRunAnalysis = currentRunJob
    ? await database.auditJob.findFirst({
        where: { id: currentRunJob.id, ...(JOB_WHERE ?? {}) },
        select: { crewResult: true, crewStatus: true },
      })
    : null;
  const latestCompletedJob = jobsWithResult?.find(
    (job) => job.status === "completed"
  );
  const hasUsableResult =
    trackingData !== null ||
    Boolean(latestCompletedJob && isUsableRun(latestCompletedJob.result));

  // 「진실의 거울」 — 답변 원문은 **최신 1회차만** 읽는다(v4 탭7 · N-37).
  //   ⚠️ 위 `scopedTracking()`(1400행)에 `rawResponse` 를 얹지 않는다 —
  //   행당 수 KB 라 시계열 조회가 무거워진다(`scoped.ts:43` 주석이 요구하는 방식).
  //   ⭐ 무료 공개다(v4 §1-d — 1회 결과는 전부 공개). `/sources` 는 growth 전용이라
  //     거기 넣으면 v4 결정과 어긋난다.
  const latestRun = orgId
    ? await scopedLatestRunTracking(data.latestBrandId ?? undefined)
    : [];
  const truthMirror = buildTruthMirrorData(latestRun);
  const activeJob = jobsLite.find(
    (job) => job.status === "queued" || job.status === "processing"
  );
  const latestFailedJob = activeJob
    ? undefined
    : jobsLite.find((job) => job.status === "failed");
  const hasData =
    trackingData !== null || jobsLite.some((job) => job.status === "completed");

  // 추세 주석(감사 D2) — 화면이 보고 있는 브랜드 것만. 브랜드가 없으면(AuditJob 폴백) 빈 배열.
  const annotations = data.latestBrandId
    ? await scopedAnnotations(data.latestBrandId)
    : [];

  return (
    <>
      <Header page="대시보드" pages={["Findable"]} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
        {activeJob && hasData && hasUsableResult ? (
          <section
            aria-live="polite"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--findable-primary,#ff7a4d)]/35 bg-[color:var(--findable-primary,#ff7a4d)]/5 p-4"
          >
            <div>
              <p className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
                새 측정을 진행하고 있어요
              </p>
              <p className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                지금 보이는 값은 이전 완료 결과예요. 새 결과가 끝나면 자동으로
                이력에 쌓여요.
              </p>
            </div>
            <Link
              className="text-[color:var(--findable-primary,#ff7a4d)] text-sm"
              href={`/brand/measuring?job=${activeJob.id}`}
            >
              실시간 상태 보기 →
            </Link>
          </section>
        ) : null}

        {hasData && hasUsableResult ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h1 className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
                  가시성 대시보드
                </h1>
                <p className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
                  {data.latestBrandName
                    ? `AI가 ‘${data.latestBrandName}’ 브랜드를 어떻게 말하는지 모았어요.`
                    : "AI가 내 브랜드를 어떻게 말하는지 모았어요."}
                </p>
              </div>
              <Link
                className="findable-btn-primary inline-flex items-center rounded-md px-4 py-2 font-medium text-sm"
                href="/brand"
              >
                측정 시작
              </Link>
            </div>

            {/* D10: 브랜드가 2개 이상 측정됐을 때만 — 고를 게 없는데 고르는 UI 를 두면
                화면만 복잡해진다. 히어로 **위**에 두는 이유: 아래 숫자들이 전부 이
                선택에 종속되므로, 무엇을 보고 있는지 먼저 알려야 한다. */}
            {data.brandOptions.length > 1 ? (
              <BrandSwitcher
                options={data.brandOptions}
                selectedId={data.latestBrandId}
              />
            ) : null}

            <DashboardRunContext
              brandName={data.latestBrandName}
              jobId={currentRunJob?.id ?? null}
              measuredAt={data.latestMeasuredAt}
            />

            {/* D6: 히어로 카드 → 목적지. paid 는 잠긴 목적지를 **클릭 전에** 알리는 용도
                (게이팅 판정 자체는 각 목적지 페이지가 서버에서 다시 한다).
                🔴 2026-08-21(11번) — `id="tour-kpis"` 는 대시보드 첫 진입 가이드
                (`OnboardingTour`)의 앵커다. 이 섹션을 옮기거나 지우면 그 단계는
                자동으로 건너뛴다(대상 없음 → 스킵, 죽지 않음) — 순서는 자유롭게 바꿔도 된다. */}
            <div id="tour-kpis">
              <DashboardKpis data={data} paid={isPaid(plan)} />
            </div>

            {data.coverage && data.latestSov !== null ? (
              <DashboardImpactEstimate
                coverage={data.coverage}
                sov={data.latestSov}
              />
            ) : null}

            {/* 기획서 §4-1 섹션순서 2번 — 처방을 1급 시민으로(리서치 "진짜 공백=처방"). */}
            <div id="tour-actions">
              <NextActionsCard brandName={data.latestBrandName} />
            </div>

            <DashboardDeepAnalysis
              crewResult={currentRunAnalysis?.crewResult as never ?? null}
              crewStatus={currentRunAnalysis?.crewStatus ?? "not_requested"}
              jobId={currentRunJob?.id ?? null}
            />

            <div id="tour-trend">
              <SovTrendChart
                annotations={annotations}
                annotationsSlot={
                  data.latestBrandId ? (
                    <TrendAnnotations
                      annotations={annotations}
                      brandId={data.latestBrandId}
                    />
                  ) : null
                }
                brandId={data.latestBrandId}
                emptyAction={
                  data.latestBrandDomain && data.latestBrandName ? (
                    <StartTrackingButton
                      brandName={data.latestBrandName}
                      domain={data.latestBrandDomain}
                    />
                  ) : null
                }
                trend={data.trend}
              />
            </div>

            {/* "밀리는 질문"(2026-08-07) — 히어로가 말한 평균이 **어디서 왔는지** 쪼갠다.
                리서치 `01:132` *"업계 1군은 이걸 메인에 둔다"* · 경쟁사 채택률 8/15.
                위치: 추세(시간) 다음, 이력(원장) 앞 — 요약 → 추세 → **분해** → 원장 순. */}
            <PromptScoreboard scores={data.promptScores} />

            {/* 「진실의 거울」(v4 탭7 · N-37) — 요약 → 추세 → 분해 → **원문** 순.
                ⭐ 경쟁사 4곳 중 Otterly 만 유사 기능을 갖고 있다(실측). 우리 무기다.
                점수가 "왜 그런지"에 답하는 자리라 분해(질문별) 바로 다음에 둔다. */}
            {truthMirror && data.latestBrandName ? (
              <div id="tour-truth-mirror">
                <TruthMirrorSection
                  brandName={data.latestBrandName}
                  data={truthMirror}
                />
              </div>
            ) : null}

            {/* 2026-08-21(11번) — 대시보드 첫 진입 가이드. haloX·Profound·Scrunch
                3곳 공통 패턴(경쟁사 실측: `경쟁사별_기능_전체_및_필요판단_2026-08-21.md`
                19번 줄) — 단 Findable은 **실제 측정 결과**(`hasData` 분기 안) 위에서만
                뜬다. 빈 상태(`DashboardEmptyState`)에는 안 뜬다 — 볼 데이터가 없는
                화면을 투어할 이유가 없다. */}
            <OnboardingTour />

            {/* 🔴 「최근 측정 이력」 섹션 제거 (세션N-34 · N-33 확정사항 7번 실행).
                같은 `AuditHistoryList` 가 여기와 `/history` **두 곳에 렌더**되고 있었다.
                같은 목록이 두 화면에 있으면 **어느 쪽이 진실인지 모른다**.

                🔴 `/history` 가 **엄격히 더 많이** 준다 → 그쪽을 남긴다:
                  · 총 건수 + `take: 50` 잘림 고지(`historyCountLabel`)
                  · 진행 중 건 자동 새로고침(`HistoryAutoRefresh`)
                여기엔 그게 없어서, 51번째부터 **말없이 잘린 목록**을 보여주고 있었다.

                ⚠️ 길은 막히지 않는다 — 사이드바 「측정 이력」(`sidebar.tsx:108`)이 그대로다.
                ⚠️ 조회 자체는 계속 쓴다(`buildDashboardData` 폴백·`hasData`).
                   🔄 N-39: 가벼운 `jobsLite` + **폴백일 때만** `result` 를 읽도록 쪼갰다.
                📕 역할 분리: `/` = 상태·큰그림(Carbon Presentation) · `/history` = 원장.

                🔴 **D10 의 「범위가 다르다」 안내도 같이 사라졌는데, 그게 맞다.**
                그 한 줄(*"위 요약은 A 기준이고, 이 목록은 브랜드 전체예요"*)은
                **히어로(브랜드 1개) 옆에 org 전체 목록이 있어서** 필요했던 것이다.
                목록이 빠진 지금 이 화면은 **전부 선택 브랜드 범위**(`data.*`)라
                경고할 불일치 자체가 없다 — 남겨두면 **없는 혼란을 설명하는 문장**이 된다.
                ⚠️ 이력을 다시 이 화면에 붙이면 **그 한 줄도 같이 되살려야 한다.** */}

            <PartnerCTA plan={plan} />
            {!isPaid(plan) && <UpgradeLadder plan={plan} />}
          </>
        ) : (
          /* 🔴 S2'(2026-08-11 세션N-19) — **빈 상태에서는 영업을 걷어낸다.**
             📕설계 v3 §4-2: 측정 0건에서 `PartnerCTA`·`UpgradeLadder` 를 렌더하지 않는다.
             근거: 아직 **제품이 무엇인지도 모르는 사람**에게 업그레이드를 파는 화면이다.
             업그레이드 유도는 **측정 결과를 본 직후**가 가장 설득력 있다(가치 경험 후 전환)
             — 그 자리(위 `hasData` 분기)에는 그대로 남아 있다.
             ⚠️ 파는 것을 **지운 게 아니라 옮긴 것**이다. 되살리지 말 것. */
          <DashboardNoResultState
            activeJobId={activeJob?.id}
            failedJobId={latestFailedJob?.id}
            signedInEmail={email}
            unavailableJobId={
              hasData && !hasUsableResult ? latestCompletedJob?.id : undefined
            }
          />
        )}
      </div>
    </>
  );
};

export default App;
