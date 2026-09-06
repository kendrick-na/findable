"use client";

import { Badge } from "@repo/design-system/components/ui/badge";
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

import { WelcomeShell } from "./welcome-shell";

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

interface WelcomeFlowProps {
  /** 1단계에서 등록된 브랜드. 없으면 이 컴포넌트는 렌더되지 않는다. */
  brandId: string;
  brandName: string;
  /**
   * 자동 추정된 타깃 시장 — **프로파운드 f049 에 없는 우리 우위**.
   * 값만 주는 게 아니라 `reason`(왜 그렇게 잡았나)을 함께 보여준다.
   * ⚠️ 고객은 이걸 **고칠 수 있다**. 고쳐도 측정 엔진은 줄지 않는다(분모 불변).
   */
  detected: { confidence: string; reason: string; scope: string };
  initialCompetitors?: string[];
  initialScope?: string;
  initialStep?: number;
  initialVariants?: string[];
  /**
   * 1단계에서 측정이 **실제로 시작됐는지**(N-44 교차검증에서 잡은 거짓말).
   *
   * 🔴 이 값이 없을 때 마지막 단계는 결말과 무관하게 *"측정은 이미 시작됐어요"* 라고
   *   말했다. 24시간 한도(`rate_limited`)나 시작 실패(`failed`)여도 그렇게 말해서,
   *   사용자는 **텅 빈 대시보드에 도착하고 이유를 모른다**.
   *   📕 이 저장소가 이미 고쳤던 「조용한 실패」와 같은 형태(§3-b ⑴).
   */
  measurement?: "failed" | "rate_limited" | "started";
  /** 가입 시 자동 예약한 SEO·GEO 기술 진단의 실제 상태. */
  readiness?: {
    id: string;
    report: unknown;
    status: "queued" | "processing" | "completed" | "failed";
  };
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
    entityVariants?: string[];
    marketScope?: string;
    onboardingStep?: number;
  }) => Promise<{ ok: true } | { error: string }>;
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
 * 범위 확정. 결제 플로우·트라이얼·전환이벤트는 카카오페이 심사 동결 구역이라 손대지 않는다).
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

/**
 * 마지막 단계가 할 말 — **측정 결말마다 다르다.**
 * ⚠️ 하나로 뭉개면 거짓말이 된다(그게 N-44 에서 잡은 버그다).
 */
const FINISH_KEYS: Record<
  "failed" | "rate_limited" | "started",
  { description: string; title: string }
> = {
  started: { description: "doneStarted", title: "doneTitle" },
  rate_limited: { description: "doneRateLimited", title: "savedTitle" },
  failed: { description: "doneFailed", title: "savedTitle" },
};

const getInitialCompetitors = (
  initialStep: number,
  initialCompetitors: string[],
  suggestedCompetitors: string[]
) =>
  initialStep >= 4 && initialCompetitors.length > 0
    ? initialCompetitors
    : suggestedCompetitors;

export const WelcomeFlow = ({
  brandId,
  brandName,
  detected,
  initialCompetitors = [],
  initialScope,
  initialStep = 2,
  initialVariants = [],
  measurement = "started",
  onSave,
  readiness,
  t,
  suggestedCompetitors = [],
}: WelcomeFlowProps) => {
  const router = useRouter();
  // 2단계에서 시작한다(1단계 = 브랜드 등록은 이미 끝났다).
  const [step, setStep] = useState(Math.min(5, Math.max(2, initialStep)));
  // 추정값에서 시작한다 — 고객이 그대로 두면 추정이 확정된다(프로파운드 f049 형태).
  const [scope, setScope] = useState(initialScope ?? detected.scope);
  const [variants, setVariants] = useState<string[]>(initialVariants);
  // 🔴 2026-08-21(👤 결정) — 제안을 **기본으로 채워둔다**(예전엔 기본 미선택).
  //   Otterly 사고(자동채움 후 오분류를 그대로 밀어붙임)와 다른 점: 화면에서
  //   하나씩 X로 빼기 쉽고(ChipList), 잘못된 제안은 그대로 두는 게 아니라
  //   지우는 게 기본 동작이 되도록 안내 문구(competitorLede)를 맞춘다.
  const [competitors, setCompetitors] = useState<string[]>(
    getInitialCompetitors(initialStep, initialCompetitors, suggestedCompetitors)
  );
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // 진단은 서버의 after()에서 실행된다. 진행 중일 때만 새로 읽어 결과를 갱신한다.
  useEffect(() => {
    if (!(readiness?.status === "queued" || readiness?.status === "processing")) {
      return;
    }
    const timer = window.setInterval(() => router.refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [readiness?.status, router]);

  const TOTAL = 5;

  const addDraft = (into: "variants" | "competitors") => {
    const value = draft.trim();
    if (!value) {
      return;
    }
    const setter = into === "variants" ? setVariants : setCompetitors;
    setter((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setDraft("");
  };

  const saveAndGo = async (
    nextStep: number,
    profile: Partial<{
      competitors: string[];
      entityVariants: string[];
      marketScope: string;
    }> = {}
  ) => {
    setSaving(true);
    const result = await onSave({
      brandId,
      onboardingStep: nextStep,
      ...profile,
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(result.error, { description: t.saveFailedHint });
      return;
    }
    setStep(nextStep);
  };

  /** 마지막 단계 — 설정 완료 사실까지 저장하고 대시보드로. */
  const finish = async () => {
    setSaving(true);
    const result = await onSave({
      brandId,
      completeOnboarding: true,
      competitors,
      entityVariants: variants,
      marketScope: scope,
      onboardingStep: 5,
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(result.error, { description: t.saveFailedHint });
      return;
    }
    router.push("/");
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
          suggestedCompetitors.length > 0
            ? t.competitorLede
            : t.competitorLedeEmpty
        }
        primary={{
          disabled: saving,
          label: saving ? (t.saving as string) : (t.next as string),
          onClick: () => saveAndGo(5, { competitors }),
        }}
        skip={{ label: t.skip as string, onClick: () => saveAndGo(5) }}
        stepOfTemplate={t.stepOf as string}
        title={t.competitorTitle}
        total={TOTAL}
      >
        {/* 🔴 2026-08-21 — 이제 제안은 기본으로 담겨 아래 ChipList에 있다.
            이 섹션은 사용자가 X로 뺀 항목을 다시 담는 되돌리기 자리로 남는다
            (competitors 에서 빼면 이 filter 가 다시 여기 보여준다). */}
        {suggestedCompetitors.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              {t.competitorSuggestion}
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
                addDraft("competitors");
              }
            }}
            placeholder={t.competitorPlaceholder}
            value={draft}
          />
          <button
            className="shrink-0 rounded-md border border-[color:var(--findable-hairline,#23252a)] px-3 font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm"
            onClick={() => addDraft("competitors")}
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
  }

  // 5단계 — 확인하고 끝낸다. ⛔ 가격 숫자·결제 CTA 는 넣지 않는다(§7-B/C-4).
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
      current={5}
      description={t[FINISH_KEYS[measurement].description] as string}
      primary={{
        disabled: saving,
        label: saving ? (t.saving as string) : (t.goDashboard as string),
        onClick: finish,
      }}
      stepOfTemplate={t.stepOf as string}
      title={t[FINISH_KEYS[measurement].title] as string}
      total={TOTAL}
    >
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
              onRemove={(v) => setVariants((p) => p.filter((x) => x !== v))}
              removeLabel={(i) => (t.removeItem ?? "").replace("{item}", i)}
            />
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
            {(t.summaryCompetitors ?? "").replace(
              "{count}",
              String(competitors.length)
            )}
          </dt>
          <dd>
            <ChipList
              emptyHint={t.emptyHint as string}
              items={competitors}
              onRemove={(v) => setCompetitors((p) => p.filter((x) => x !== v))}
              removeLabel={(i) => (t.removeItem ?? "").replace("{item}", i)}
            />
          </dd>
        </div>
      </dl>
      <SiteReadinessStatus readiness={readiness} t={t} />
      <div className="border-[color:var(--findable-hairline,#23252a)] border-t pt-4">
        <GrowthFeaturePreview t={t} />
      </div>
    </WelcomeShell>
  );
};

const SiteReadinessStatus = ({
  readiness,
  t,
}: {
  readiness?: WelcomeFlowProps["readiness"];
  t: Record<string, string>;
}) => {
  const status = readiness?.status;
  const statusKey =
    status === "completed"
      ? "siteReadinessCompleted"
      : status === "failed"
        ? "siteReadinessFailed"
        : status === "queued" || status === "processing"
          ? "siteReadinessRunning"
          : "siteReadinessUnavailable";

  return (
    <section className="rounded-md border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-2,rgba(255,255,255,0.03))] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
            {t.siteReadinessTitle}
          </h2>
          <p aria-live="polite" className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            {t[statusKey]}
          </p>
        </div>
        <Link className="shrink-0 text-[color:var(--findable-primary,#ff7a4d)] text-sm" href="/site-audit">
          {t.siteReadinessLink}
        </Link>
      </div>
    </section>
  );
};
