import { isPaid } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { SwordsIcon } from "lucide-react";
import type { Metadata } from "next";
import { env } from "@/env";
import { scopedLatestRunTracking } from "@/lib/db/scoped";
import { EmptyState } from "../components/empty-state";
import { Header } from "../components/header";
import { LockedSurface } from "../components/locked-surface";
import { CompetitorBoard } from "../features/analysis/competitor-board";
import { buildCompetitorAnalysis } from "../lib/analysis-data";

export const metadata: Metadata = {
  title: "경쟁사 비교 · Findable",
  description: "우리와 경쟁사 중 누가 AI 답변에 더 많이 나오는지 비교해요.",
};

// 🔴 2026-08-10 세션N-16 — **지어낸 숫자를 지웠다.**
//   예전엔 `42%·31%·18%` 라는 **실재하지 않는 수치**를 막대까지 그려 보여줬다.
//   "(예시)"라고 적혀 있어도 **화면은 숫자를 사실처럼 읽힌다**. 이 프로젝트 제1 규칙
//   (**사실 자동 생성 금지**)과 충돌하고, 리서치도 **블러/티저를 직접 기각**했다
//   (📕`05:109` — *"직접 조사한 연구 없다"* = 자기모순).
//   → 대신 **실제로 측정한 진단**(A2 와 같은 회차)을 링크한다. 숫자를 지어내지 않고도
//     "이게 뭔지"를 보여주는 유일한 정직한 방법이다.
const SAMPLE_AUDIT_URL = `${env.NEXT_PUBLIC_WEB_URL}/audit/d732a13a-9c3b-48ad-a9a0-7ea80f69e328?shared=1`;

const ComparePreview = () => (
  <div className="findable-card flex flex-col gap-3 p-6">
    <p className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
      AI 답변에서 우리와 경쟁사가 각각 얼마나 나오는지 비교해요
    </p>
    <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
      같은 질문에 AI가 어떤 브랜드를 먼저, 얼마나 자주 말하는지 나란히 놓고
      봅니다. 숫자는 측정을 해야 나오기 때문에 미리 보여드리지 않아요.
    </p>
  </div>
);

// 유료인데 아직 측정이 없는 경우. "준비 중"이 아니라 **다음 행동**을 준다.
// S2'(2026-08-11) — 공용 `EmptyState` 로 교체. ⚠️**2분기(no-run/no-ranking)는 유지**한다:
//   "측정을 안 했다"와 "측정했지만 순위 질문이 없었다"는 **다음 행동이 서로 다르다**
//   (등록하러 가기 vs 질문 추가하고 재측정). 하나로 합치면 틀린 안내가 된다.
//   `no-ranking` 은 이미 측정을 해본 사람이라 샘플 링크가 불필요하다 → `no-run` 에만 붙인다.
const NeedsMeasurement = ({ reason }: { reason: "no-run" | "no-ranking" }) => (
  <EmptyState
    // 🐛 스크린샷 눈확인에서 잡은 것(2026-08-11): `no-ranking` 은 **이미 측정을 해본**
    //   사람인데 버튼이 "측정 시작하기"였다 — 설명문("질문을 추가하고 다시 측정")과
    //   어긋나고 **버튼 이름 = 실제 동작** 규칙(설계 v3 원인②)에 걸린다.
    //   → 두 분기의 다음 행동을 각자 정확한 말로 바꿨다.
    //   ⚠️ 목적지는 **둘 다 `/brand`** 다. 질문 추가 UI(`PromptWizard`)가 그 화면 안에 있다
    //     (`brand/page.tsx:138`). 처음엔 `/search` 로 보냈다가 실측으로 정정 —
    //     `/search` 는 범용 검색결과 화면이고 프롬프트와 무관하다.
    ctaHref="/brand"
    ctaLabel={reason === "no-run" ? "측정 시작하기" : "질문 추가하러 가기"}
    description={
      reason === "no-run"
        ? "브랜드를 등록하고 한 번만 측정하면, AI 답변에 같이 나오는 경쟁 브랜드를 여기에 정리해드려요."
        : "“추천”이나 “순위”를 묻는 질문을 추가하고 다시 측정하면 순위를 뽑을 수 있어요. AI가 순서대로 답할 때만 경쟁 순위가 보여요."
    }
    icon={<SwordsIcon className="size-5" />}
    sampleHref={reason === "no-run" ? SAMPLE_AUDIT_URL : undefined}
    title={
      reason === "no-run"
        ? "아직 측정한 적이 없어요"
        : "이번 측정에서는 순위를 찾지 못했어요"
    }
  />
);

const ComparePage = async () => {
  const plan = await getCurrentPlan();

  // 잠금 유저에겐 DB 조회 자체를 하지 않는다(불필요한 쿼리 회피).
  if (!isPaid(plan)) {
    return (
      <>
        <Header page="경쟁사 비교" pages={["Findable"]} />
        <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
          <LockedSurface
            bullets={[
              "우리와 경쟁사 등장률 순위 비교",
              "AI 답변에서의 평균 노출 순위",
              "순위표 진입 여부 진단",
            ]}
            desc="경쟁사가 우리보다 얼마나 더, 또는 덜 나오는지 한눈에 보여드려요."
            preview={<ComparePreview />}
            sampleUrl={SAMPLE_AUDIT_URL}
            title="경쟁사 비교"
            unlockPlan="Growth"
          />
        </div>
      </>
    );
  }

  const rows = await scopedLatestRunTracking();
  const analysis = buildCompetitorAnalysis(rows);

  return (
    <>
      <Header page="경쟁사 비교" pages={["Findable"]} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
        {analysis ? (
          <CompetitorBoard data={analysis} />
        ) : (
          <NeedsMeasurement
            reason={rows.length === 0 ? "no-run" : "no-ranking"}
          />
        )}
      </div>
    </>
  );
};

export default ComparePage;
