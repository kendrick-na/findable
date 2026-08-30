"use client";

import {
  type BrandSizeKey,
  DEFAULT_ASSUMPTIONS,
  estimateRevenueImpact,
  formatKrwCompact,
  type RevenueAssumptions,
  SIZE_PRESETS,
} from "@repo/audit/revenue-impact";
import { Info } from "lucide-react";
import { useState } from "react";

interface RevenueImpactCardProps {
  /**
   * 물어본 엔진 수(고유). **분모**로 화면에 밝힌다.
   * 🔴 2026-08-10 세션N-14 신설 — 이 카드는 `sov` 하나로 손실을 추정하면서
   *   **그 값이 몇 개 엔진에서 나왔는지 말하지 않고 있었다.** 28개 중 12개만
   *   성공한 회차도 전부 성공한 회차와 똑같은 확신으로 숫자를 보여준다.
   */
  attemptedEngines?: number;
  /** 측정 신호로 추정한 초기 규모 (전수감사 2026-08-02 §A-1). 없으면 small. */
  defaultSizeKey?: BrandSizeKey;
  isKo: boolean;
  /** 응답을 실제로 받아낸 엔진 수(고유). **분자**. */
  measuredEngines?: number;
  /** 리포트는 당시 결과를 읽는 문서다. 가정 조정은 대시보드에서만 제공한다. */
  readOnly?: boolean;
  sov: number;
}

const T = (isKo: boolean) => ({
  // 🔴 감사 5번(2026-08-07 세션N-8): 주 숫자를 금액→세션으로 바꾸면서 제목도 맞춘다.
  //   제목이 "매출"인데 큰 숫자가 세션이면 둘이 어긋나 보인다.
  eyebrow: isKo ? "놓치는 유입 (추정)" : "Missed Traffic (Estimate)",
  headline: isKo
    ? "AI 답변에서 놓치고 있는 방문"
    : "Visits you may be missing in AI answers",
  // KPI 프레이밍(시뮬 병목: "이게 내 이번 분기 문제인지 인식"에 직결).
  // 해요체 + 주 숫자(세션)와 같은 층위로 — 금액은 아래 토글에서만 말한다(감사 5번).
  kpiFraming: isKo
    ? "지금 이 순간에도 AI에게 브랜드를 묻는 잠재고객이 다른 답을 받고 있어요. 그 중 우리에게 올 수 있었던 방문을 세어봤어요."
    : "Right now, prospects asking AI about your category are getting someone else's answer. Here's how many visits that costs you.",
  perMonth: isKo ? "/ 월 (추정)" : "/ mo (est.)",
  directLoss: isKo ? "직접 유입 손실" : "Direct referral loss",
  directHint: isKo
    ? "답변에서 클릭해 들어올 방문의 매출"
    : "Revenue from clicks you'd receive",
  influenceLoss: isKo ? "제로클릭 영향 손실" : "Zero-click influence loss",
  influenceHint: isKo
    ? "클릭 없이 답변만 보고 결정이 바뀌는 몫"
    : "Decisions shaped by the answer without a click",
  adEquivalent: isKo ? "광고비 환산 가치" : "Ad-equivalent value",
  adHint: isKo
    ? "이 노출을 검색광고로 사면 드는 월 비용 (매출과 별도)"
    : "What buying this exposure as search ads would cost (separate from revenue)",
  missedSessions: isKo ? "놓치는 유입(추정)" : "Missed sessions (est.)",
  recoverable: isKo ? "회복 가능 매출(추정)" : "Recoverable revenue (est.)",
  sessionsUnit: isKo ? "세션 / 월" : "sessions / mo",
  disclaimer: isKo
    ? "2025-2026 공개 실측 연구 기반 추정입니다 — 클릭률 8%(Pew Research), AI 방문자 전환가치 2.5배(Semrush 4.4배·Adobe +54%의 보수 반영), 제로클릭 영향 20%(Bain: 검색 60%가 클릭 없이 종료). 실제 값은 업종·객단가에 따라 다르니 규모 선택과 가정 조정으로 맞춰 보세요."
    : "Based on published 2025-2026 studies — 8% answer CTR (Pew), 2.5x AI-visitor conversion (conservative vs Semrush 4.4x / Adobe +54%), 20% zero-click influence (Bain: 60% of searches end without a click). Adjust size and assumptions to fit your brand.",
  sizeLabel: isKo ? "브랜드 규모" : "Brand size",
  adjust: isKo ? "가정 조정" : "Adjust assumptions",
  queries: isKo ? "월 AI 답변 노출(추정)" : "Monthly AI answer views (est.)",
  ctr: isKo ? "답변→클릭률" : "Answer→click rate",
  conv: isKo ? "AI 방문→고객 전환율" : "AI visitor→customer rate",
  influenceRate: isKo ? "제로클릭 영향률" : "Zero-click influence rate",
  influenceConv: isKo ? "영향→전환율(타채널)" : "Influence→conversion rate",
  cpc: isKo ? "광고 환산 CPC(원)" : "Ad-equivalent CPC",
  aov: isKo ? "고객당 매출(원)" : "Revenue per customer",
  // 🔴 S7-3차(2026-08-12) — 칸마다 **이 숫자가 어디서 왔는지**. 예전에는 라벨+맨
  //   입력칸 7개뿐이라, 곱해져 "예상 손실"이 되는 값들의 근거를 고객이 댈 수 없었다
  //   (사내 보고에 못 쓴다 = 우리 숫자를 안 믿는다). 아래 문구는 전부 코드에 이미
  //   적혀 있던 출처를 화면으로 끌어올린 것이다 — **새로 지어낸 근거는 없다**.
  hQueries: isKo
    ? "선택한 브랜드 규모에서 자동으로 잡혀요. 내 검색량을 알면 직접 넣어주세요."
    : "Set by the brand size you picked. Enter your own if you know it.",
  hCtr: isKo
    ? "Pew Research 실측 8% — AI 요약을 본 사람이 링크를 누르는 비율"
    : "8% measured by Pew Research — link clicks after seeing an AI summary",
  hConv: isKo
    ? "일반 방문의 2.5배로 잡았어요(Semrush 4.4배·Adobe +54%를 보수적으로 반영)"
    : "2.5x normal visitors — conservative vs Semrush 4.4x / Adobe +54%",
  hInfluenceRate: isKo
    ? "클릭 없이 답변만 보고 영향받는 비율. Bain 조사(검색 60%가 클릭 없이 끝남) 기반 보수치"
    : "Influenced without clicking. Conservative, based on Bain (60% of searches end click-free)",
  hInfluenceConv: isKo
    ? "위에서 영향받은 사람이 매장·직접방문·지명검색으로 사는 비율"
    : "Of those influenced, the share converting via store, direct, or branded search",
  hCpc: isKo
    ? "같은 노출을 광고로 사면 얼마인지 환산할 때 써요. 네이버 검색광고 단가 밴드 기준"
    : "Used to price the same exposure as ads. Based on Naver search-ad CPC bands",
  hAov: isKo
    ? "고객 1명이 한 번에 사는 평균 금액(객단가). 내 값으로 바꾸면 추정이 크게 정확해져요."
    : "Average revenue per customer. Replacing this with your own sharpens the estimate most.",
  reset: isKo ? "기본값으로" : "Reset",
  range: isKo ? "추정 범위" : "Estimate range",
  showMoney: isKo ? "금액으로 환산해 보기" : "Convert to revenue",
  hideMoney: isKo ? "금액 추정 접기" : "Hide revenue estimate",
});

export function RevenueImpactCard({
  attemptedEngines,
  measuredEngines,
  sov,
  isKo,
  defaultSizeKey = "small",
  readOnly = false,
}: RevenueImpactCardProps) {
  const t = T(isKo);
  // 규모 프리셋: AI 답변 노출량과 광고 CPC를 함께 조정.
  // 초기값 = 측정 신호 기반 추정(전수감사 §A-1: small 하드코딩이 SK하이닉스에
  // ₩63만/월을 보여줬던 결함). 가정도 그 규모로 시작해야 첫 숫자가 정합.
  const [assumptions, setAssumptions] = useState<RevenueAssumptions>(() => ({
    ...DEFAULT_ASSUMPTIONS,
    monthlyAiQueries: SIZE_PRESETS[defaultSizeKey].monthlyAiQueries,
    cpcKrw: SIZE_PRESETS[defaultSizeKey].cpcKrw,
  }));
  const [sizeKey, setSizeKey] = useState<BrandSizeKey>(defaultSizeKey);
  const [open, setOpen] = useState(false);
  // 금액은 기본 접힘 — 감사 5번(방어 못 하는 숫자를 페이지 최대 숫자로 두지 않는다).
  const [showMoney, setShowMoney] = useState(false);

  const est = estimateRevenueImpact(sov, assumptions);

  const setField = (key: keyof RevenueAssumptions, value: number) =>
    setAssumptions((prev) => ({ ...prev, [key]: value }));

  const applySize = (key: BrandSizeKey) => {
    setSizeKey(key);
    setAssumptions((prev) => ({
      ...prev,
      monthlyAiQueries: SIZE_PRESETS[key].monthlyAiQueries,
      cpcKrw: SIZE_PRESETS[key].cpcKrw,
    }));
  };

  return (
    <section className="rounded-2xl border border-[var(--brand-2)]/25 bg-zinc-900/60 p-6 md:p-8">
      <div className="font-medium text-[var(--brand-2)] text-xs">
        {t.eyebrow}
      </div>
      {/* 한글은 정사각 격자라 음수 자간이 가독성을 깎는다 → 한글일 때만 tracking 제거
          (랜딩 hero.tsx·step-sections.tsx 의 isKo 분기와 같은 규율) */}
      <h3
        className={`mt-2 font-semibold text-xl text-zinc-100 ${
          isKo ? "" : "tracking-tight"
        }`}
      >
        {t.headline}
      </h3>
      <p className="mt-2 max-w-2xl text-sm text-zinc-400 leading-relaxed">
        {t.kpiFraming}
      </p>

      {/* 규모 프리셋 — 추정의 첫 변수(노출량·CPC)를 사용자가 고른다 */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-400">{t.sizeLabel}</span>
        {(Object.keys(SIZE_PRESETS) as BrandSizeKey[]).map((key) => readOnly ? (
          key === sizeKey ? (
            <span className="rounded-full border border-[var(--brand-2)]/50 bg-[var(--brand-2)]/10 px-3 py-1 text-xs text-[var(--brand-2)]" key={key}>
              {isKo ? SIZE_PRESETS[key].labelKo : SIZE_PRESETS[key].labelEn}
            </span>
          ) : null
        ) : (
          <button
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              sizeKey === key
                ? "border-[var(--brand-2)]/50 bg-[var(--brand-2)]/10 text-[var(--brand-2)]"
                : "border-white/10 bg-white/[0.03] text-zinc-400 hover:text-zinc-200"
            }`}
            key={key}
            onClick={() => applySize(key)}
            type="button"
          >
            {isKo ? SIZE_PRESETS[key].labelKo : SIZE_PRESETS[key].labelEn}
          </button>
        ))}
        {sizeKey === defaultSizeKey && defaultSizeKey !== "small" && (
          <span className="text-[11px] text-zinc-400">
            {isKo
              ? "· 측정 결과(인지 엔진 수·점유율)로 자동 선택됨"
              : "· auto-selected from measurement"}
          </span>
        )}
      </div>

      {/* 🔴 5번 "매출 위계 강등" (2026-08-07 세션N-8, 감사결과 문서)
          거절 사유: *"내가 방어 못 하는 숫자는 안 씁니다"* ·
                    *"가정 조정 버튼이 있으면 이건 슬라이더예요"*
          금액이 게이지보다 크게 조판돼 **페이지 최대 숫자**인데 근거는 가장 약했다
          (노출량·CTR·전환율·객단가 4단 추정의 곱 → 오차가 곱해진다).
          → 주 숫자를 **놓치는 세션**(추정 1단계, 방어 가능)으로 바꾸고
            금액은 **접어서** 보여준다. 지우지 않는다 — 금액을 원하는 사용자도 있다. */}
      <div className="mt-5 flex flex-wrap items-end gap-x-3 gap-y-1">
        <span className="font-semibold text-4xl text-zinc-50 tabular-nums tracking-tight">
          {est.missedSessionsPerMonth.toLocaleString()}
        </span>
        <span className="pb-1 text-sm text-zinc-400">
          {isKo ? "세션 / 월 (추정)" : "sessions / mo (est.)"}
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-400">
        {isKo
          ? "AI 답변에서 우리를 못 봐서 놓치는 방문이에요."
          : "Visits you miss because AI answers don't surface you."}
      </p>

      {!readOnly && <button
        aria-expanded={showMoney}
        className="mt-3 inline-flex items-center gap-1.5 text-xs text-zinc-400 underline decoration-zinc-700 underline-offset-4 transition-colors hover:text-zinc-200"
        onClick={() => setShowMoney((v) => !v)}
        type="button"
      >
        {showMoney ? t.hideMoney : t.showMoney}
      </button>}

      {showMoney && (
        <div className="mt-3 rounded-xl border border-white/10 bg-zinc-950/40 p-4">
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            {/* formatKrwCompact 은 "₩1.2억"처럼 한글 단위를 포함한다 → 음수 자간 금지 */}
            <span className="font-semibold text-2xl text-zinc-100 tabular-nums">
              {formatKrwCompact(est.missedRevenuePerMonth)}
            </span>
            <span className="pb-0.5 text-xs text-zinc-400">{t.perMonth}</span>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {t.range}: {formatKrwCompact(est.missedRevenueLow)} ~{" "}
            {formatKrwCompact(est.missedRevenueHigh)}
          </p>
          {/* 방어 가능성을 위해 **무엇을 곱했는지**를 접힌 안에서 바로 밝힌다.
              리서치(Semrush 3요인 분해)가 최강 신뢰장치로 꼽은 패턴.
              ⚠️ 이 문장은 **직접 유입분만** 설명한다 — 총액은 직접 + 제로클릭 영향이라
              한 줄로 다 적으면 곱셈이 안 맞아 보인다(그게 바로 감사 6번 "숫자 혼재").
              ⚠️ 가정값은 **비율(0~1)** 이다. 0.05를 그대로 쓰면 "0.05%"가 되어 100배 틀린다. */}
          <p className="mt-2 text-[11px] text-zinc-400 leading-relaxed">
            {isKo
              ? `직접 유입분은 세션 ${est.missedSessionsPerMonth.toLocaleString()}건 × 전환율 ${(assumptions.aiVisitorConversionRate * 100).toFixed(1)}% × 고객당 매출 ${assumptions.revenuePerConversion.toLocaleString()}원이에요. 나머지는 클릭 없이 답변만 보고 결정이 바뀌는 몫이고요. 아래 '가정 조정'에서 우리 값으로 바꿀 수 있어요.`
              : `The direct portion is ${est.missedSessionsPerMonth.toLocaleString()} sessions × ${(assumptions.aiVisitorConversionRate * 100).toFixed(1)}% conversion × ${assumptions.revenuePerConversion.toLocaleString()} KRW per customer. The rest is zero-click influence. Adjust below.`}
          </p>
        </div>
      )}

      {/* 3요소 분해 — 어디서 새는 돈인지. **전부 금액**이라 토글 안에 둔다(감사 5번).
          밖에 두면 주 숫자만 세션으로 바꾸고 금액 3개가 그대로 남아 강등이 무의미하다. */}
      {showMoney && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <BreakdownCell
            hint={t.directHint}
            label={t.directLoss}
            value={formatKrwCompact(est.directRevenuePerMonth)}
          />
          <BreakdownCell
            hint={t.influenceHint}
            label={t.influenceLoss}
            value={formatKrwCompact(est.influenceRevenuePerMonth)}
          />
          <BreakdownCell
            hint={t.adHint}
            label={t.adEquivalent}
            muted
            value={formatKrwCompact(est.adEquivalentKrwPerMonth)}
          />
        </div>
      )}

      {/* 보조 지표 — "놓치는 유입"은 위 주 숫자와 **같은 값**이라 중복 제거(감사 5번).
          "회복 가능 매출"도 금액이므로 금액 토글 안으로 들어간다 — 밖에 두면
          금액을 접어도 초록색 금액이 그대로 남아 강등이 무의미해진다. */}
      {showMoney && (
        <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="text-xs text-zinc-400">{t.recoverable}</p>
          <p className="mt-1 font-semibold text-emerald-300 text-lg tabular-nums">
            +{formatKrwCompact(est.recoverableRevenuePerMonth)}
            <span className="ml-1 font-normal text-xs text-zinc-400">
              SoV {sov}% → {est.targetSov}%
            </span>
          </p>
        </div>
      )}

      {/* 🔴 측정 분모 고지 (2026-08-10 세션N-14) — **이 숫자가 몇 개로 잰 것인지 밝힌다.**
          임계값으로 경고하거나 숨기지 않는다(그런 경계선은 근거가 없다).
          전부 성공한 회차는 굳이 말하지 않는다(노이즈) — **일부만 성공했을 때만** 밝힌다. */}
      {typeof measuredEngines === "number" &&
        typeof attemptedEngines === "number" &&
        attemptedEngines > 0 &&
        measuredEngines < attemptedEngines && (
          <div className="mt-4 flex items-start gap-2 text-amber-300/80 text-xs">
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              {isKo
                ? `AI ${attemptedEngines}곳 중 ${measuredEngines}곳에서 측정한 결과로 계산했어요. 나머지는 응답을 받지 못해 이 추정에 들어가지 않았어요.`
                : `Calculated from ${measuredEngines} of ${attemptedEngines} AI engines. The rest didn't respond and aren't included in this estimate.`}
            </p>
          </div>
        )}

      {/* 투명성 고지 — 벤치마크 출처 */}
      <div className="mt-4 flex items-start gap-2 text-xs text-zinc-400">
        <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>{t.disclaimer}</p>
      </div>

      {/* 가정 조정 */}
      {readOnly ? (
        <p className="mt-3 text-xs text-zinc-400">
          {isKo
            ? "이 리포트는 측정 시점의 기본 가정을 고정해 보여줍니다. 값 조정과 실행 관리는 대시보드에서 할 수 있어요."
            : "This report keeps the measurement-time defaults fixed. Adjust assumptions and manage actions in the dashboard."}
        </p>
      ) : <button
        className="mt-3 text-[var(--brand-2)] text-xs underline-offset-2 hover:underline"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        {t.adjust} {open ? "▲" : "▼"}
      </button>}

      {open && (
        <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-white/10 bg-zinc-950/40 p-4 sm:grid-cols-2">
          <AssumptionField
            hint={t.hQueries}
            label={t.queries}
            onChange={(v) => setField("monthlyAiQueries", v)}
            step={5000}
            value={assumptions.monthlyAiQueries}
          />
          <AssumptionField
            hint={t.hAov}
            label={t.aov}
            onChange={(v) => setField("revenuePerConversion", v)}
            step={10_000}
            value={assumptions.revenuePerConversion}
          />
          <AssumptionField
            hint={t.hCtr}
            label={t.ctr}
            onChange={(v) => setField("answerClickThroughRate", v)}
            percent
            step={0.01}
            value={assumptions.answerClickThroughRate}
          />
          <AssumptionField
            hint={t.hConv}
            label={t.conv}
            onChange={(v) => setField("aiVisitorConversionRate", v)}
            percent
            step={0.005}
            value={assumptions.aiVisitorConversionRate}
          />
          <AssumptionField
            hint={t.hInfluenceRate}
            label={t.influenceRate}
            onChange={(v) => setField("zeroClickInfluenceRate", v)}
            percent
            step={0.05}
            value={assumptions.zeroClickInfluenceRate}
          />
          <AssumptionField
            hint={t.hInfluenceConv}
            label={t.influenceConv}
            onChange={(v) => setField("influencedConversionRate", v)}
            percent
            step={0.005}
            value={assumptions.influencedConversionRate}
          />
          <AssumptionField
            hint={t.hCpc}
            label={t.cpc}
            onChange={(v) => setField("cpcKrw", v)}
            step={100}
            value={assumptions.cpcKrw}
          />
          <button
            className="text-left text-xs text-zinc-400 hover:text-zinc-300"
            onClick={() => {
              // 리셋도 측정 기반 초기값으로 — small 고정이면 자동인식이 무효가 된다.
              setAssumptions({
                ...DEFAULT_ASSUMPTIONS,
                monthlyAiQueries: SIZE_PRESETS[defaultSizeKey].monthlyAiQueries,
                cpcKrw: SIZE_PRESETS[defaultSizeKey].cpcKrw,
              });
              setSizeKey(defaultSizeKey);
            }}
            type="button"
          >
            ↺ {t.reset}
          </button>
        </div>
      )}
    </section>
  );
}

const BreakdownCell = ({
  label,
  hint,
  value,
  muted,
}: {
  label: string;
  hint: string;
  value: string;
  muted?: boolean;
}) => (
  <div
    className={`rounded-xl border p-4 ${
      muted
        ? "border-white/10 bg-zinc-950/40"
        : "border-[var(--brand-2)]/20 bg-[var(--brand-2)]/[0.04]"
    }`}
  >
    <p className="text-xs text-zinc-400">{label}</p>
    <p
      className={`mt-1 font-semibold text-lg tabular-nums ${
        muted ? "text-zinc-300" : "text-zinc-100"
      }`}
    >
      {value}
    </p>
    <p className="mt-1 text-[11px] text-zinc-400 leading-snug">{hint}</p>
  </div>
);

/**
 * 가정 입력 한 칸.
 *
 * 🔴 S7-3차(2026-08-12) — `hint` 추가. 예전에는 라벨 + 맨 숫자 입력칸 7개가
 *   나란히 있을 뿐, **그 기본값이 어디서 왔는지 한 글자도 없었다**. 이 숫자들이
 *   곱해져 "예상 매출 손실"이 되는데, 고객이 사내에서 그 값을 설명해야 할 때
 *   근거를 댈 수 없다 → 자기 회사 숫자로 고치지도, 믿지도 못한다.
 *   ⚠️ 힌트에 **없는 출처를 지어내지 않는다** — 어디서 온 값인지와 무엇을 뜻하는지만 쓴다.
 */
const AssumptionField = ({
  label,
  value,
  onChange,
  step,
  percent,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  percent?: boolean;
  hint?: string;
}) => (
  <label className="flex flex-col gap-1 text-xs text-zinc-400">
    {label}
    <input
      className="rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 tabular-nums outline-none focus:border-[var(--brand-2)]/50"
      min={0}
      onChange={(e) => {
        const raw = Number.parseFloat(e.target.value);
        if (Number.isFinite(raw)) {
          onChange(percent ? raw / 100 : raw);
        }
      }}
      step={percent ? step * 100 : step}
      type="number"
      value={percent ? Math.round(value * 1000) / 10 : value}
    />
    {hint ? (
      <span className="text-[10px] text-zinc-400 leading-relaxed">{hint}</span>
    ) : null}
  </label>
);
