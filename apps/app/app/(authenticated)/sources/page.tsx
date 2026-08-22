import { isPaid } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { LinkIcon } from "lucide-react";
import type { Metadata } from "next";
import { env } from "@/env";
import { scopedLatestRunTracking } from "@/lib/db/scoped";
import { EmptyState } from "../components/empty-state";
import { Header } from "../components/header";
import { LockedSurface } from "../components/locked-surface";
import { SourcesBoard } from "../features/analysis/sources-board";
import { buildSourcesAnalysis } from "../lib/analysis-data";

export const metadata: Metadata = {
  title: "출처 링크 · Findable",
  description: "AI가 우리를 설명할 때 어떤 문서를 근거로 거는지 알려드려요.",
};

// 🔴 2026-08-10 세션N-16 — **지어낸 숫자를 지웠다.**
//   예전엔 `blog.naver.com 47 · 내 도메인 9 · namu.wiki 4` 라는 **실재하지 않는 수치**를
//   실제 표처럼 보여줬다. "(예시)" 라고 적어도 **화면은 숫자를 사실로 읽힌다**.
//   제1 규칙(**사실 자동 생성 금지**) 위반 + 리서치의 블러/티저 기각(📕`05:109`).
//   → 실제 측정 회차 링크로 대체(compare 와 동일 방침).
const SAMPLE_AUDIT_URL = `${env.NEXT_PUBLIC_WEB_URL}/audit/d732a13a-9c3b-48ad-a9a0-7ea80f69e328?shared=1`;

const SourcesPreview = () => (
  <div className="findable-card flex flex-col gap-3 p-6">
    <p className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
      AI가 우리를 설명할 때 어떤 문서를 근거로 거는지 보여줘요
    </p>
    <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
      자사 페이지인지, 뉴스인지, 커뮤니티·위키인지까지 나눠서 정리해요. 어디를
      고쳐야 인용이 늘어나는지가 여기서 보입니다. 숫자는 측정을 해야 나와요.
    </p>
  </div>
);

// S2'(2026-08-11) — 공용 `EmptyState` 로 교체 + **실제 회차 링크를 여기에도 붙였다**
//   (잠금 프리뷰에만 있고 이 화면엔 없었다 — 유료 결제자가 측정 전에 보는 화면인데
//    "무엇이 보일지"를 글로만 설명하고 있었다. 같은 `SAMPLE_AUDIT_URL` 재사용 · 원가 0).
const NeedsMeasurement = () => (
  <EmptyState
    description="측정을 한 번 실행하면, AI가 내 브랜드를 설명할 때 근거로 삼은 문서들을 여기에 출처별로 정리해드려요."
    icon={<LinkIcon className="size-5" />}
    sampleHref={SAMPLE_AUDIT_URL}
    title="아직 측정한 적이 없어요"
  />
);

const SourcesPage = async () => {
  const plan = await getCurrentPlan();

  if (!isPaid(plan)) {
    return (
      <>
        <Header page="출처 링크" pages={["Findable"]} />
        <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
          {/* 🔴 S4(2026-08-11) — 내부 용어 제거. 예전 첫 불릿이
              「언급(Mention)과 인용(Citation)을 **분리 집계**」였다 —
              `Mention/Citation` 은 GEO 업계 용어이고 '분리 집계'는 회계 용어처럼 읽힌다.
              같은 카드의 `desc`("우리 사이트인지, 남의 블로그인지")는 쉬운 말인데
              불릿만 딱딱해서 **한 카드 안에서 말투가 갈라져 있었다**(진단 §원인④·NN/g 4).
              ⚠️ JSX 는 **속성 사이에 중괄호 주석을 넣을 수 없다**(TS1005) → 요소 위로. */}
          <LockedSurface
            bullets={[
              "이름만 나온 경우와, 우리 링크까지 걸린 경우를 따로 세요",
              "네이버 블로그·뉴스·나무위키 중 어디가 근거로 쓰였는지",
              "ChatGPT·Perplexity 별로 어떤 사이트를 걸었는지",
            ]}
            desc="AI가 우리를 설명할 때 무엇을 근거로 삼는지 — 우리 사이트인지, 남의 블로그인지 알려드려요."
            preview={<SourcesPreview />}
            sampleUrl={SAMPLE_AUDIT_URL}
            title="출처 링크"
            unlockPlan="Growth"
          />
        </div>
      </>
    );
  }

  const rows = await scopedLatestRunTracking();
  const analysis = buildSourcesAnalysis(rows);

  return (
    <>
      <Header page="출처 링크" pages={["Findable"]} />
      <div className="flex flex-1 flex-col gap-6 p-6 pt-2">
        {analysis ? <SourcesBoard data={analysis} /> : <NeedsMeasurement />}
      </div>
    </>
  );
};

export default SourcesPage;
