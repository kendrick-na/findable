"use client";

import type { SuggestedPrompt } from "@repo/ai/lib/prompt-suggestions";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Checkbox } from "@repo/design-system/components/ui/checkbox";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { toast } from "@repo/design-system/components/ui/sonner";
import { cn } from "@repo/design-system/lib/utils";
import {
  BarChart3Icon,
  BellIcon,
  LinkIcon,
  type LucideIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

import type { QuestionPickerLabels } from "../features/brand/question-picker";
import { WelcomeQuestionStep } from "./welcome-question-step";
import { WelcomeShell } from "./welcome-shell";
import { ONBOARDING_TOTAL_STEPS } from "./welcome-steps";

/**
 * 5단계 우측 — **예시** 노출도 그래프(Profound f044 참조).
 *
 * 🔴 f044 는 자사(Indigochild) 데모의 65%·+5%·상승곡선을 **실제 결과처럼** 보여준다.
 *   Findable 은 신규 유저에게 아직 측정값이 없다 — 그대로 베끼면 없는 실적을
 *   있는 것처럼 보여주는 것과 같은 사고다([[feedback_no_fabricated_facts]] ·
 *   가입화면 고객로고 미채택과 같은 이유). → **"예시 화면" 라벨을 항상 함께 둔다.**
 * ⚠️ 값은 고정 상수다(실측 아님) — 절대 API·DB 에서 끌어오지 않는다.
 */
const PREVIEW_TREND = [22, 31, 38, 41, 59, 61, 65];
const PREVIEW_DATES = ["8/13", "8/14", "8/15", "8/16", "8/17", "8/18", "8/19"];

const ExposurePreviewChart = ({
  caption,
  label,
}: {
  caption: string;
  label: string;
}) => {
  const data = PREVIEW_TREND.map((value, index) => ({
    date: PREVIEW_DATES[index],
    value,
  }));
  const latest = PREVIEW_TREND.at(-1) as number;
  const delta = latest - (PREVIEW_TREND.at(-2) as number);

  return (
    <div className="findable-card flex flex-col gap-3 p-4">
      <span className="w-fit rounded-full border border-[color:var(--findable-hairline,#23252a)] px-2 py-0.5 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
          {latest}%
        </span>
        <span className="text-emerald-400 text-sm">+{delta}%</span>
      </div>
      <div aria-hidden="true" className="h-28 w-full">
        <ResponsiveContainer height="100%" width="100%">
          <LineChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
          >
            <XAxis
              axisLine={false}
              dataKey="date"
              stroke="var(--findable-ink-tertiary,#7e8289)"
              tick={{ fontSize: 10 }}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              stroke="var(--findable-ink-tertiary,#7e8289)"
              tick={{ fontSize: 10 }}
              tickLine={false}
              unit="%"
              width={34}
            />
            <Line
              dataKey="value"
              dot={false}
              isAnimationActive={false}
              stroke="var(--findable-primary,#ff7a4d)"
              strokeWidth={2}
              type="monotone"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs leading-relaxed">
        {caption}
      </p>
    </div>
  );
};

/**
 * 온보딩 4단계 — 📕 `재설계안_v4` §7-B/C · 👤 2026-08-19 승인(프로파운드식).
 *
 * ```
 * 1 도메인 → 2 지역·언어(f049) → 3 우리를 부르는 다른 이름 → 4 경쟁사 확인 → 측정
 * ```
 *
 * 🔴 **1단계는 이 파일에 없다.** 기존 `AssignBrandForm`(275줄)을 **그대로 재사용**한다
 *   (§7-D-3 *"새 컴포넌트를 만들지 않는다"*). 그 폼이 등록·측정 시작까지 이미 한다.
 *   → 이 컴포넌트는 **등록이 끝난 뒤**(brandId 확보) 2~4단계를 맡는다.
 *
 * ⛔ **기본 선택 0개**(전자상거래법 「특정옵션 사전선택」 · v4 §7-D-4):
 *   경쟁사는 AI 가 제안하되 **담기지 않은 상태**로 보여준다. 눌러야 들어간다.
 *   ⚠️ 프로파운드 f050 은 주제 5개를 **미리 체크**해뒀다 — 그건 베끼지 않는다.
 *
 * ⚠️ **모든 단계는 건너뛸 수 있다.** 값이 비면 `[]` 로 저장되고 기존 동작과 같다
 *   (별칭·경쟁사 둘 다 없어도 측정은 돈다). 완성 기준 = 건너뛸 수 있는 단계 2·3·4.
 */

const TOTAL = ONBOARDING_TOTAL_STEPS;

/** 진단은 서버의 after()에서 실행된다. 진행 중이고 화면이 상태를 보여 줄 때만 새로 읽어 갱신한다. */
const useSiteReadinessPolling = (
  status: "queued" | "processing" | "completed" | "failed" | undefined,
  active: boolean
) => {
  const router = useRouter();
  useEffect(() => {
    if (!(active && (status === "queued" || status === "processing"))) {
      return;
    }
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [active, status, router]);
};

/** 온보딩이 쓰는 서버 동작 — 뷰는 서버액션을 import 하지 않고 이 모양으로 주입받는다. */
export interface WelcomeActions {
  /** 지금 설정 상태에서 비어 있는 항목 코드(필수+권장). 읽기 실패면 null. */
  check: (brandId: string) => Promise<{ missing: string[] } | null>;
  /** 질문 미리 돌려 보기(저장·점수 반영 없음). 기능이 꺼져 있으면 undefined 라 버튼이 안 보인다. */
  prerun?: (input: { brandId: string; questions: string[] }) => Promise<
    | { error: string }
    | {
        ok: true;
        signals: Array<{
          brandsListed: number;
          error?: boolean;
          ours: boolean;
          text: string;
        }>;
      }
  >;
  /** 사람이 고른 질문만 저장한다. 한도 정보(`capped`·`limit`·`code`)를 화면까지 전달한다. */
  save: (input: { brandId: string; prompts: SuggestedPrompt[] }) => Promise<
    | { code?: "prompt_limit"; error: string; limit?: number }
    | {
        capped?: boolean;
        limit?: number;
        ok: true;
        requested?: number;
        saved: number;
      }
  >;
  /** 측정을 시작한다. `skippedSetup` = '기본값으로 진행'을 명시 선택했는지. */
  start: (input: {
    brandName: string;
    domain: string;
    skippedSetup: boolean;
  }) => Promise<{ code?: string; error: string } | { jobId: string; ok: true }>;
  /** 질문 후보 제안(저장 안 함). `remaining` = 더 담을 수 있는 개수. */
  suggest: (
    brandId: string,
    siteNote?: string
  ) => Promise<
    | { error: string }
    | {
        ok: true;
        prompts: SuggestedPrompt[];
        remaining: number;
        siteThin?: boolean;
      }
  >;
}

interface WelcomeFlowProps {
  /**
   * 서버액션 묶음 — **주입**받는다(아래 `onSave` 주석과 같은 이유로 직접 import 하지 않는다).
   * 질문 제안·저장·측정 시작·설정 상태 확인이 여기 있다.
   */
  actions: WelcomeActions;
  /** 브랜드 도메인 — 측정 시작에 쓴다. */
  brandDomain: string;
  /** 1단계에서 등록된 브랜드. 없으면 이 컴포넌트는 렌더되지 않는다. */
  brandId: string;
  brandName: string;
  /**
   * 자동 추정된 타깃 시장 — **프로파운드 f049 에 없는 우리 우위**.
   * 값만 주는 게 아니라 `reason`(왜 그렇게 잡았나)을 함께 보여준다.
   * ⚠️ 고객은 이걸 **고칠 수 있다**. 고쳐도 측정 엔진은 줄지 않는다(분모 불변).
   */
  detected: { confidence: string; reason: string; scope: string };
  /** 업종이 '기타'인가(질문 재료가 적다는 안내용). */
  industryOther: boolean;
  initialCompetitors?: string[];
  /** '경쟁사 없음'을 이미 선택해 저장한 브랜드. */
  initialNoCompetitors: boolean;
  /** 이미 저장된 추적 질문 수 — 5·6단계에 보여 준다. */
  initialQuestionCount: number;
  initialScope?: string;
  initialStep?: number;
  initialVariants?: string[];
  /**
   * 🔴 **서버액션을 import 하지 않고 주입받는다**(N-44 · 실제로 Storybook 이 죽고서 고침).
   *   `@/app/actions/...` 를 여기서 import 하면 Prisma·`server-only` 가 브라우저 번들에
   *   딸려와 **`node:fs` 등 UnhandledSchemeError 로 Storybook 이 통째로 죽는다**.
   *   📕 함정 메모리: *"서버액션 import 하면 Storybook 전멸"* · N-37·N-41 주입 패턴.
   */
  onSave: (input: {
    brandId: string;
    competitors?: string[];
    completeOnboarding?: boolean;
    noCompetitors?: boolean;
    entityVariants?: string[];
    marketScope?: string;
    onboardingStep?: number;
  }) => Promise<{ ok: true } | { error: string }>;
  /**
   * 온보딩 단계·완료를 조직(Org)에 저장할지. 첫 브랜드 온보딩은 true(기본),
   * '브랜드 추가'(`/welcome?brand=`)는 false — 이미 온보딩을 마친 조직의 단계를 건드리지 않는다.
   */
  persistStep?: boolean;
  /** 질문 고르기 화면 문구(사전 `app.questionPicker`). */
  questionLabels: QuestionPickerLabels;
  /** 플랜의 추적 질문 상한(null = 제한 없음). */
  questionLimit: number | null;
  /** 가입 시 자동 예약한 SEO·GEO 기술 진단의 실제 상태. */
  readiness?: {
    id: string;
    report: unknown;
    status: "queued" | "processing" | "completed" | "failed";
  };
  /** AI 가 제안한 경쟁사(있으면). ⛔ **담긴 상태가 아니다** — 후보일 뿐이다. */
  suggestedCompetitors?: string[];
  /**
   * 온보딩 문구 사전 — **서버가 읽어 내려준다**(뷰는 `getAppDictionary` 를 모른다).
   * 🔴 `server-only` 가 딸려오면 Storybook 이 통째로 죽는다(N-43·N-44) → 주입.
   * 📕 `CLAUDE.md §2`: 다국어 문자열은 dictionary 경유(하드코딩 금지).
   */
  t: Record<string, string>;
}

/** 자유 입력 목록 — 별칭·경쟁사가 같은 모양이라 한 컴포넌트로 쓴다. */
const ChipList = ({
  emptyHint,
  items,
  onRemove,
  removeLabel,
}: {
  emptyHint: string;
  items: string[];
  onRemove: (value: string) => void;
  removeLabel: (item: string) => string;
}) =>
  items.length > 0 ? (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Badge
          className="gap-1 border-[color:var(--findable-hairline,#23252a)] py-1 pr-1 pl-2 text-[color:var(--findable-ink,#f7f8f8)]"
          key={item}
          variant="outline"
        >
          {item}
          <button
            aria-label={removeLabel(item)}
            className="rounded-sm p-0.5"
            onClick={() => onRemove(item)}
            type="button"
          >
            <XIcon aria-hidden="true" className="size-3" />
          </button>
        </Badge>
      ))}
    </div>
  ) : (
    <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-sm">
      {emptyHint}
    </p>
  );

/** 타깃 시장 라벨 — 사전 키 매핑(문구는 사전에 있다). */
const SCOPE_KEY: Record<string, string> = {
  korea: "scopeKorea",
  global: "scopeGlobal",
  both: "scopeBoth",
};

/**
 * 5단계 하단 — **9번 온보딩 후 유료화 유도**(2026-08-21 · 👤 "온보딩에서 유도 문구만"으로
 * 범위 확정. 당시 결제 플로우·트라이얼·전환이벤트는 카카오페이 심사 동결 구역이었다 —
 * 지금은 심사 완료(2026-09-22, cf405634). 상품 구성(플랜·가격) 변경 시 PG 변경 신고 필요 여부 [확인필요]).
 *
 * 각 링크는 결제 CTA 가 아니라 **해당 기능 페이지로 이동**이다. 게이팅(무료면 잠금 화면
 * 노출)은 그 페이지가 이미 `LockedSurface`(components/locked-surface.tsx)로 하고 있어
 * 여기서 plan 을 새로 확인하지 않는다 — 중복 게이트를 만들면 두 판정이 갈릴 위험이 생긴다.
 */
const GROWTH_FEATURES: Array<{
  descKey: string;
  href: string;
  icon: LucideIcon;
  titleKey: string;
}> = [
  {
    descKey: "featureCompareDesc",
    href: "/compare",
    icon: BarChart3Icon,
    titleKey: "compare",
  },
  {
    descKey: "featureSourcesDesc",
    href: "/sources",
    icon: LinkIcon,
    titleKey: "sources",
  },
  {
    descKey: "featureAlertsDesc",
    href: "/alerts",
    icon: BellIcon,
    titleKey: "alerts",
  },
];

const GrowthFeaturePreview = ({ t }: { t: Record<string, string> }) => (
  <div className="flex flex-col gap-2">
    <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
      {t.featurePreviewTitle}
    </span>
    <div className="flex flex-col gap-1.5">
      {GROWTH_FEATURES.map(({ titleKey, descKey, href, icon: Icon }) => (
        <Link
          className="flex items-start gap-3 rounded-md border border-[color:var(--findable-hairline,#23252a)] p-3 text-sm transition-colors hover:border-[color:var(--findable-ink-subtle,#8a8f98)]"
          href={href}
          key={href}
        >
          <Icon
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-[color:var(--findable-ink-subtle,#8a8f98)]"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
              {t[titleKey]}
            </span>
            <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
              {t[descKey]}
            </span>
          </span>
        </Link>
      ))}
    </div>
  </div>
);

/** 측정 시작 결말을 사용자에게 **있는 그대로** 알린다 — 한도 초과·실패를 "시작됐어요"로 뭉뚱그리지 않는다. */
const announceStartResult = (
  result: Awaited<ReturnType<WelcomeActions["start"]>>,
  push: (href: string) => void,
  t: Record<string, string>
) => {
  if ("error" in result) {
    if (result.code === "rate_limited") {
      toast.info(result.error || t.measureRateLimited);
      push("/");
      return;
    }
    toast.error(result.error || t.measureFailed, {
      description: t.measureFailedHint,
    });
    return;
  }
  toast.success(t.measureStarted);
  push(`/brand/measuring?job=${result.jobId}`);
};

/** 사용자가 확인한 경쟁사만 저장 값으로 만든다. 확인 전이면 빈 객체 — 저장된 값을 건드리지 않는다. */
const confirmedCompetitorProfile = (
  confirmed: boolean,
  competitors: string[],
  noCompetitors: boolean
): { competitors?: string[]; noCompetitors?: boolean } =>
  confirmed
    ? { competitors, noCompetitors: noCompetitors && competitors.length === 0 }
    : {};

interface CompetitorStepProps {
  addDraft: () => void;
  competitors: string[];
  draft: string;
  noCompetitors: boolean;
  onNext: () => void;
  onSkip: () => void;
  quickStart: { disabled?: boolean; label: string; onClick: () => void };
  saving: boolean;
  setCompetitors: (update: (prev: string[]) => string[]) => void;
  setDraft: (value: string) => void;
  setNoCompetitors: (value: boolean) => void;
  suggestedCompetitors: string[];
  t: Record<string, string>;
}

/** 4단계 — 경쟁사 확인. AI 후보는 미리 채워 **보여 주기만** 하고, [다음]을 눌러야 확정 저장된다. */
const CompetitorStep = ({
  addDraft,
  competitors,
  draft,
  noCompetitors,
  onNext,
  onSkip,
  quickStart,
  saving,
  setCompetitors,
  setDraft,
  setNoCompetitors,
  suggestedCompetitors,
  t,
}: CompetitorStepProps) => (
  <WelcomeShell
    aside={
      <>
        <p className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
          {t.competitorWhyTitle}
        </p>
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
          {t.competitorWhyBody}
        </p>
      </>
    }
    current={4}
    /* 🔴 2026-08-21 — 제안을 기본으로 채우므로(위 competitors 초깃값 주석)
           "눌러서 담아주세요"가 아니라 "틀린 게 있으면 빼주세요"로 안내한다.
           제안이 0개면 채울 게 없었다는 뜻이라 여전히 빈 안내로 분기한다. */
    description={
      suggestedCompetitors.length > 0 ? t.competitorLede : t.competitorLedeEmpty
    }
    primary={{
      disabled: saving,
      label: saving ? (t.saving as string) : (t.next as string),
      onClick: onNext,
    }}
    quickStart={quickStart}
    skip={{ label: t.skip as string, onClick: onSkip }}
    stepOfTemplate={t.stepOf as string}
    title={t.competitorTitle}
    total={TOTAL}
  >
    {/* 🔴 2026-08-21 — 이제 제안은 기본으로 담겨 아래 ChipList에 있다.
            이 섹션은 사용자가 X로 뺀 항목을 다시 담는 되돌리기 자리로 남는다
            (competitors 에서 빼면 이 filter 가 다시 여기 보여준다). */}
    {suggestedCompetitors.length > 0 && (
      <div className="flex flex-col gap-2">
        <span className="flex flex-wrap items-center gap-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
          {t.competitorSuggestion}
          <button
            className="rounded-md border border-[color:var(--findable-hairline,#23252a)] px-2 py-0.5 font-medium text-[color:var(--findable-ink,#f7f8f8)] text-xs"
            onClick={() => {
              setNoCompetitors(false);
              setCompetitors((p) => [
                ...p,
                ...suggestedCompetitors.filter((name) => !p.includes(name)),
              ]);
            }}
            type="button"
          >
            {t.competitorAddAll}
          </button>
        </span>
        <div className="flex flex-wrap gap-1.5">
          {suggestedCompetitors
            .filter((name) => !competitors.includes(name))
            .map((name) => (
              <button
                className="rounded-full border border-[color:var(--findable-hairline,#23252a)] border-dashed px-3 py-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs"
                key={name}
                onClick={() => setCompetitors((p) => [...p, name])}
                type="button"
              >
                + {name}
              </button>
            ))}
        </div>
      </div>
    )}
    <label
      className="flex items-start gap-2 text-[color:var(--findable-ink,#f7f8f8)] text-sm"
      htmlFor="welcome-no-competitors"
    >
      <Checkbox
        checked={noCompetitors && competitors.length === 0}
        className="mt-0.5"
        disabled={competitors.length > 0}
        id="welcome-no-competitors"
        onCheckedChange={(value) => setNoCompetitors(value === true)}
      />
      <span className="flex flex-col gap-0.5">
        {t.competitorNone}
        <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
          {t.competitorNoneHint}
        </span>
      </span>
    </label>
    <Label className="pt-2" htmlFor="welcome-competitor">
      {t.competitorAddLabel}
    </Label>
    <div className="flex gap-2">
      <Input
        id="welcome-competitor"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addDraft();
          }
        }}
        placeholder={t.competitorPlaceholder}
        value={draft}
      />
      <button
        className="shrink-0 rounded-md border border-[color:var(--findable-hairline,#23252a)] px-3 font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm"
        onClick={() => addDraft()}
        type="button"
      >
        {t.add}
      </button>
    </div>
    <ChipList
      emptyHint={t.emptyHint as string}
      items={competitors}
      onRemove={(v) => setCompetitors((p) => p.filter((x) => x !== v))}
      removeLabel={(i) => (t.removeItem ?? "").replace("{item}", i)}
    />
  </WelcomeShell>
);

/** 경쟁사를 이미 저장해 뒀는가(이름 있는 경쟁사 또는 '없음' 표식). */
const hasStoredCompetitorSetting = (stored: string[], none: boolean): boolean =>
  stored.length > 0 || none;

/**
 * 4단계 경쟁사 칸의 처음 값. **저장된 값이 항상 먼저다**(2026-10-13):
 *  · 저장된 경쟁사가 있으면 그것, '없음'을 저장했으면 빈 목록 — AI 후보로 덮어쓰지 않는다.
 *  · 아무것도 저장 안 한 첫 설정이면 빈 목록 — AI 후보는 미리 담지 않고 칩으로만 보여 준다(2026-10-15, 2026-08-21 결정을 바꿈).
 *    담은 값은 사용자가 4단계 [다음]으로 확인하기 전에는 저장되지 않는다(`competitorsConfirmed`).
 */
const getInitialCompetitors = (initialCompetitors: string[]) =>
  // 🔴 2026-10-15(👤 결정 변경) — AI 후보는 **더 이상 미리 담지 않는다**. 후보는 아래 점선 칩으로 보여 주고
  //   사람이 눌러서(또는 [후보 모두 담기]) 담은 것만 확정한다. 점검에서 후보가 가끔 틀렸다(인접 업종·분야 빗나감).
  initialCompetitors;

export const WelcomeFlow = ({
  actions,
  brandDomain,
  brandId,
  brandName,
  detected,
  initialCompetitors = [],
  industryOther,
  initialNoCompetitors,
  initialQuestionCount,
  initialScope,
  initialStep = 2,
  initialVariants = [],
  onSave,
  persistStep = true,
  questionLabels,
  questionLimit,
  readiness,
  t,
  suggestedCompetitors = [],
}: WelcomeFlowProps) => {
  const router = useRouter();
  // 2단계에서 시작한다(1단계 = 브랜드 등록은 이미 끝났다).
  const [step, setStep] = useState(Math.min(6, Math.max(2, initialStep)));
  // 추정값에서 시작한다 — 고객이 그대로 두면 추정이 확정된다(프로파운드 f049 형태).
  const [scope, setScope] = useState(initialScope ?? detected.scope);
  const [variants, setVariants] = useState<string[]>(initialVariants);
  // 🔴 2026-08-21(👤 결정) — 제안을 **기본으로 채워둔다**(예전엔 기본 미선택).
  //   Otterly 사고(자동채움 후 오분류를 그대로 밀어붙임)와 다른 점: 화면에서
  //   하나씩 X로 빼기 쉽고(ChipList), 잘못된 제안은 그대로 두는 게 아니라
  //   지우는 게 기본 동작이 되도록 안내 문구(competitorLede)를 맞춘다.
  const [competitors, setCompetitors] = useState<string[]>(
    getInitialCompetitors(initialCompetitors)
  );
  // 경쟁사를 **사용자가 확인했는지**. 저장돼 있거나 4단계 [다음]을 눌렀을 때만 true —
  //   건너뛰기·「기본값으로 바로 측정」에서는 AI 후보를 확정 저장하지 않는다.
  const [competitorsConfirmed, setCompetitorsConfirmed] = useState(
    hasStoredCompetitorSetting(initialCompetitors, initialNoCompetitors)
  );
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  // '경쟁사 없음' 명시 선택 — 경쟁사가 비어 있을 때만 의미가 있다(저장은 목록 안 표식).
  const [noCompetitors, setNoCompetitors] = useState(initialNoCompetitors);
  // 5단계 질문 승인 — 기본 전부 미선택, 사람이 고른 것만 저장한다.
  const [savedQuestions, setSavedQuestions] = useState(initialQuestionCount);
  // 6단계: 지금 비어 있는 설정(서버가 준비도 규칙 한 곳으로 판정한다). null = 아직 모름.
  const [starting, setStarting] = useState(false);

  // 기술 진단 상태는 **6단계(진단 상태를 보여 주는 단계)에서만** 다시 읽는다 — 2~5단계에서 5초마다
  //   서버 화면을 다시 그리면 그때마다 경쟁사 후보 AI 호출이 반복된다(2026-10-13).
  useSiteReadinessPolling(readiness?.status, step === 6);

  const addDraft = (into: "variants" | "competitors") => {
    const value = draft.trim();
    if (!value) {
      return;
    }
    const setter = into === "variants" ? setVariants : setCompetitors;
    if (into === "competitors") {
      setNoCompetitors(false);
    }
    setter((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setDraft("");
  };

  const saveAndGo = async (
    nextStep: number,
    profile: Partial<{
      competitors: string[];
      entityVariants: string[];
      marketScope: string;
      noCompetitors: boolean;
    }> = {},
    onSaved?: () => void
  ) => {
    setSaving(true);
    const result = await onSave({
      brandId,
      ...(persistStep ? { onboardingStep: nextStep } : {}),
      ...profile,
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(result.error, { description: t.saveFailedHint });
      return;
    }
    setStep(nextStep);
    onSaved?.();
  };

  /**
   * 설정을 저장하고 **측정을 시작**한다(2026-10-13 — 등록 때가 아니라 질문·경쟁사를 고른 뒤).
   * `skippedSetup` = 「기본값으로 진행」을 명시 선택했는지 — 그 사실이 측정 기록에 남는다.
   */
  const startMeasurement = async (skippedSetup: boolean) => {
    setStarting(true);
    const saved = await onSave({
      brandId,
      // 경쟁사는 사용자가 확인한 값만 저장한다 — AI 후보를 몰래 확정하지 않는다.
      ...confirmedCompetitorProfile(
        competitorsConfirmed,
        competitors,
        noCompetitors
      ),
      entityVariants: variants,
      marketScope: scope,
      ...(persistStep
        ? { completeOnboarding: true, onboardingStep: ONBOARDING_TOTAL_STEPS }
        : {}),
    });
    if ("error" in saved) {
      setStarting(false);
      toast.error(saved.error, { description: t.saveFailedHint });
      return;
    }
    const result = await actions.start({
      brandName,
      domain: brandDomain,
      skippedSetup,
    });
    setStarting(false);
    announceStartResult(result, router.push, t);
  };

  /** 2~5단계 공통 — 「지금은 기본값으로 바로 측정」 지름길(명시 선택으로 기록). */
  const quickStart = {
    disabled: saving || starting,
    label: t.quickStart as string,
    onClick: () => startMeasurement(true),
  };

  if (step === 2) {
    return (
      <WelcomeShell
        aside={
          <>
            <p className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
              {t.scopeWhyTitle}
            </p>
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
              {detected.reason}
              {detected.confidence === "low" && t.scopeLowConfidence}
            </p>
            <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-sm leading-relaxed">
              {t.scopeEnginesNote}
            </p>
          </>
        }
        current={2}
        description={t.scopeLede}
        primary={{
          disabled: saving,
          label: saving ? (t.saving as string) : (t.next as string),
          onClick: () => saveAndGo(3, { marketScope: scope }),
        }}
        quickStart={quickStart}
        skip={{ label: t.skip as string, onClick: () => saveAndGo(3) }}
        stepOfTemplate={t.stepOf as string}
        title={t.scopeTitle}
        total={TOTAL}
      >
        <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
          {t.scopeLabel}
        </span>
        <div className="flex flex-col gap-2">
          {(["korea", "global", "both"] as const).map((value) => (
            <button
              className={cn(
                "flex items-center justify-between rounded-md border px-4 py-3 text-left text-sm",
                scope === value
                  ? "border-[color:var(--findable-primary,#ff7a4d)] text-[color:var(--findable-ink,#f7f8f8)]"
                  : "border-[color:var(--findable-hairline,#23252a)] text-[color:var(--findable-ink-subtle,#8a8f98)]"
              )}
              key={value}
              onClick={() => setScope(value)}
              type="button"
            >
              {t[SCOPE_KEY[value] as string]}
              {detected.scope === value && (
                <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                  {t.scopeDetected}
                </span>
              )}
            </button>
          ))}
        </div>
      </WelcomeShell>
    );
  }

  if (step === 3) {
    return (
      <WelcomeShell
        aside={
          <>
            <p className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
              {t.aliasWhyTitle}
            </p>
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
              {t.aliasWhyBody}
            </p>
          </>
        }
        current={3}
        description={(t.aliasLede ?? "").replace("{brand}", brandName)}
        primary={{
          disabled: saving,
          label: saving ? (t.saving as string) : (t.next as string),
          onClick: () => saveAndGo(4, { entityVariants: variants }),
        }}
        quickStart={quickStart}
        skip={{ label: t.skip as string, onClick: () => saveAndGo(4) }}
        stepOfTemplate={t.stepOf as string}
        title={t.aliasTitle}
        total={TOTAL}
      >
        <Label htmlFor="welcome-variant">{t.aliasLabel}</Label>
        <div className="flex gap-2">
          <Input
            id="welcome-variant"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addDraft("variants");
              }
            }}
            placeholder={t.aliasPlaceholder}
            value={draft}
          />
          <button
            className="shrink-0 rounded-md border border-[color:var(--findable-hairline,#23252a)] px-3 font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm"
            onClick={() => addDraft("variants")}
            type="button"
          >
            {t.add}
          </button>
        </div>
        <ChipList
          emptyHint={t.emptyHint as string}
          items={variants}
          onRemove={(v) => setVariants((p) => p.filter((x) => x !== v))}
          removeLabel={(i) => (t.removeItem ?? "").replace("{item}", i)}
        />
      </WelcomeShell>
    );
  }

  if (step === 4) {
    return (
      <CompetitorStep
        addDraft={() => addDraft("competitors")}
        competitors={competitors}
        draft={draft}
        noCompetitors={noCompetitors}
        onNext={() =>
          saveAndGo(
            5,
            {
              competitors,
              noCompetitors: noCompetitors && competitors.length === 0,
            },
            // 저장에 성공했을 때만 그 값을 사용자가 **확인한 값**으로 친다.
            () => setCompetitorsConfirmed(true)
          )
        }
        onSkip={() => saveAndGo(5)}
        quickStart={quickStart}
        saving={saving}
        setCompetitors={setCompetitors}
        setDraft={setDraft}
        setNoCompetitors={setNoCompetitors}
        suggestedCompetitors={suggestedCompetitors}
        t={t}
      />
    );
  }

  // 5단계 — 질문 승인. 자동 제안 → **사람이 고른 것만** 저장 → 측정은 그 뒤에 시작한다.
  if (step === 5) {
    return (
      <WelcomeQuestionStep
        actions={actions}
        brandId={brandId}
        busy={saving || starting}
        industryOther={industryOther}
        labels={questionLabels}
        onNext={async (saved) => {
          setSavedQuestions((n) => n + saved);
          await saveAndGo(6);
        }}
        onSkip={() => saveAndGo(6)}
        questionLimit={questionLimit}
        quickStart={quickStart}
        savedCount={savedQuestions}
        t={t}
        total={TOTAL}
      />
    );
  }

  // 6단계 — 확인하고 **측정을 시작**한다.
  return (
    <ReadyStep
      actions={actions}
      brandId={brandId}
      brandName={brandName}
      competitors={competitorsConfirmed ? competitors : []}
      noCompetitors={competitorsConfirmed && noCompetitors}
      onRemoveCompetitor={(v) =>
        setCompetitors((p) => p.filter((x) => x !== v))
      }
      onRemoveVariant={(v) => setVariants((p) => p.filter((x) => x !== v))}
      onStart={startMeasurement}
      readiness={readiness}
      savedQuestions={savedQuestions}
      saving={saving}
      scope={scope}
      starting={starting}
      t={t}
      variants={variants}
    />
  );
};

interface ReadyStepProps {
  actions: WelcomeActions;
  brandId: string;
  brandName: string;
  competitors: string[];
  noCompetitors: boolean;
  onRemoveCompetitor: (value: string) => void;
  onRemoveVariant: (value: string) => void;
  onStart: (skippedSetup: boolean) => Promise<void>;
  readiness: WelcomeFlowProps["readiness"];
  savedQuestions: number;
  saving: boolean;
  scope: string;
  starting: boolean;
  t: Record<string, string>;
  variants: string[];
}

/** 6단계 — 확인하고 측정 시작. 비어 있는 설정은 서버 규칙(준비도 한 곳)으로 확인한다. */
const ReadyStep = ({
  actions,
  brandId,
  brandName,
  competitors,
  noCompetitors,
  onRemoveCompetitor,
  onRemoveVariant,
  onStart,
  readiness,
  savedQuestions,
  saving,
  scope,
  starting,
  t,
  variants,
}: ReadyStepProps) => {
  // 지금 비어 있는 설정 코드(필수+권장). null = 아직 모름.
  const [missing, setMissing] = useState<string[] | null>(null);
  // 6단계에 들어오면 비어 있는 설정을 서버 규칙으로 확인한다(화면이 규칙을 다시 만들지 않는다).
  useEffect(() => {
    let cancelled = false;
    actions
      .check(brandId)
      .then((r) => {
        if (!cancelled) {
          setMissing(r?.missing ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMissing([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, actions]);

  // 비어 있는 설정이 있으면 「기본값으로 진행」을 **명시 선택**해야 한다(그 사실이 측정 기록에 남는다).
  const hasMissing = (missing?.length ?? 0) > 0;
  const setupGap = (missing ?? []).some(
    (code) => code === "competitors" || code === "discovery_prompt"
  );
  let startLabel = t.startMeasure as string;
  if (starting) {
    startLabel = t.measureStarting as string;
  } else if (setupGap) {
    startLabel = t.startDefault as string;
  }

  return (
    <WelcomeShell
      aside={
        <>
          <p className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
            {t.doneAsideTitle}
          </p>
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
            {t.doneAsideBody}
          </p>
          <ExposurePreviewChart
            caption={t.donePreviewCaption as string}
            label={t.donePreviewLabel as string}
          />
        </>
      }
      current={6}
      description={t.readyLede as string}
      primary={{
        disabled: saving || starting || missing === null,
        label: startLabel,
        onClick: () => onStart(hasMissing),
      }}
      stepOfTemplate={t.stepOf as string}
      title={t.readyTitle as string}
      total={TOTAL}
    >
      {setupGap && (
        <section className="rounded-md border border-amber-600/40 bg-amber-600/10 p-4 text-sm">
          <h2 className="font-medium text-amber-600 dark:text-amber-400">
            {t.setupMissingTitle}
          </h2>
          <p className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)]">
            {t.setupMissingBody}
          </p>
        </section>
      )}
      <dl className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <dt className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
            {t.summaryBrand}
          </dt>
          <dd className="text-[color:var(--findable-ink,#f7f8f8)]">
            {brandName}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
            {t.summaryMarket}
          </dt>
          <dd className="text-[color:var(--findable-ink,#f7f8f8)]">
            {t[SCOPE_KEY[scope] as string] ?? scope}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
            {(t.summaryAliases ?? "").replace(
              "{count}",
              String(variants.length)
            )}
          </dt>
          <dd>
            <ChipList
              emptyHint={t.emptyHint as string}
              items={variants}
              onRemove={onRemoveVariant}
              removeLabel={(i) => (t.removeItem ?? "").replace("{item}", i)}
            />
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
            {noCompetitors && competitors.length === 0
              ? t.summaryCompetitorsNone
              : (t.summaryCompetitors ?? "").replace(
                  "{count}",
                  String(competitors.length)
                )}
          </dt>
          <dd>
            <ChipList
              emptyHint={t.emptyHint as string}
              items={competitors}
              onRemove={onRemoveCompetitor}
              removeLabel={(i) => (t.removeItem ?? "").replace("{item}", i)}
            />
          </dd>
        </div>
        {savedQuestions > 0 && (
          <div className="flex flex-col gap-1">
            <dt className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
              {(t.summaryQuestions ?? "").replace(
                "{count}",
                String(savedQuestions)
              )}
            </dt>
          </div>
        )}
      </dl>
      <SiteReadinessStatus readiness={readiness} t={t} />
      <div className="border-[color:var(--findable-hairline,#23252a)] border-t pt-4">
        <GrowthFeaturePreview t={t} />
      </div>
    </WelcomeShell>
  );
};

/** 기술 진단 상태 → 사전 키. */
const siteReadinessKey = (
  status: "queued" | "processing" | "completed" | "failed" | undefined
): string => {
  if (status === "completed") {
    return "siteReadinessCompleted";
  }
  if (status === "failed") {
    return "siteReadinessFailed";
  }
  if (status === "queued" || status === "processing") {
    return "siteReadinessRunning";
  }
  return "siteReadinessUnavailable";
};

const SiteReadinessStatus = ({
  readiness,
  t,
}: {
  readiness?: WelcomeFlowProps["readiness"];
  t: Record<string, string>;
}) => {
  const status = readiness?.status;
  const statusKey = siteReadinessKey(status);

  return (
    <section className="rounded-md border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-2,rgba(255,255,255,0.03))] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
            {t.siteReadinessTitle}
          </h2>
          <p
            aria-live="polite"
            className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm"
          >
            {t[statusKey]}
          </p>
        </div>
        <Link
          className="shrink-0 text-[color:var(--findable-primary,#ff7a4d)] text-sm"
          href="/site-audit"
        >
          {t.siteReadinessLink}
        </Link>
      </div>
    </section>
  );
};
