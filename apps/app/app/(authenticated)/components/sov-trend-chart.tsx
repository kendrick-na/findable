"use client";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@repo/design-system/components/ui/chart";
import { type ReactNode, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import type { SovTrendPoint } from "../lib/dashboard-data";

export interface TrendAnnotation {
  id: string;
  label: string;
  occurredAt: Date;
}

export interface SovTrendChartProps {
  annotations?: TrendAnnotation[];
  /**
   * 그래프가 그려질 때(2회차 이상) 아래에 붙는 주석 관리 UI — 주입받는다.
   * 🔴 `emptyAction` 과 같은 이유: `TrendAnnotations` 가 서버 액션을 타서
   *   import 하면 Storybook 이 `node:*` 를 못 읽어 **모든 스토리가 새하얘진다**
   *   (2026-08-17 실측 — 촬영 18건 전부 "렌더 안 됨"으로 잡혔다).
   */
  annotationsSlot?: ReactNode;
  brandId?: string | null;
  /**
   * 빈 상태(측정 1회)에 놓을 재측정 진입점 — 2026-08-17(N-37).
   *
   * 🔴 **버튼을 import 하지 않고 주입받는다.** 그 버튼은 서버 액션을 타고, 그 끝에
   *   Prisma·러너가 붙어 있어서 Storybook(브라우저 번들)이 `child_process`·`net` 을
   *   못 찾아 죽는다. 여기서 끊으면 차트는 순수 표시 컴포넌트로 남고 스토리도 돈다.
   *   ⚠️ 없으면 아무 것도 그리지 않는다 — 못 누르는 버튼을 그리지 않는다.
   */
  emptyAction?: ReactNode;
  trend: SovTrendPoint[];
}

/**
 * 기간 선택지 — 경쟁사 4/4 가 갖는 컨트롤(`Last 7 Days`·`Last 14 days`·`Last 12 weeks`).
 *
 * 🔴 **데이터가 채우는 선택지만 만든다.** 고르면 점이 2개 미만이 되는 기간은 아예
 *   렌더하지 않는다 — 누르면 빈 화면이 되는 필터는 경쟁사 공통 실패 1번
 *   (Otterly `No data to display.`)을 그대로 복제하는 것이다.
 * ⚠️ 선택지가 1개(전체)뿐이면 호출부가 필터 UI 를 그리지 않는다.
 */
export function rangeOptions(
  trend: SovTrendPoint[]
): { days: number | null; label: string }[] {
  const candidates: { days: number; label: string }[] = [
    { days: 7, label: "7일" },
    { days: 14, label: "14일" },
    { days: 30, label: "30일" },
  ];
  const usable = candidates.filter(
    (candidate) => filterByRange(trend, candidate.days).length >= 2
  );
  // 전체가 후보들과 같은 점 수를 주면 중복 버튼이 되므로, 더 넓을 때만 붙인다.
  const widest = usable.at(-1);
  const showAll =
    !widest || filterByRange(trend, widest.days).length < trend.length;
  return showAll ? [...usable, { days: null, label: "전체" }] : usable;
}

/** 최근 N일로 자른다. `null` 이면 전체. 기준시각은 **마지막 측정**(오늘이 아니다). */
export function filterByRange(
  trend: SovTrendPoint[],
  days: number | null
): SovTrendPoint[] {
  if (days === null || trend.length === 0) {
    return trend;
  }
  // 🔴 `Date.now()` 가 아니라 **마지막 측정 시점** 기준이다. 오늘 기준으로 자르면
  //   며칠 쉰 계정은 "7일" 을 눌렀을 때 0점이 되어 멀쩡한 데이터가 사라진다.
  const newest = trend.at(-1)?.timestamp ?? 0;
  const from = newest - days * 24 * 60 * 60 * 1000;
  return trend.filter((point) => point.timestamp >= from);
}

/**
 * 카드 머리글 숫자 — 지금 몇 %이고 구간 첫 점 대비 얼마 변했나.
 * ⚠️ 분모(기간·측정 회수)를 함께 밝힌다 — 기간을 좁히면 증감 기준도 바뀐다.
 */
export function headlineOf(
  visible: SovTrendPoint[],
  days: number | null
): { delta: number | null; latest: number; rangeNote: string } | null {
  // ⚠️ `sov` 는 `number`(non-null)다(`dashboard-data.ts:151`) — null 분기를 두지 않는다
  //   (읽는 코드가 없는 상태를 방어하면 죽은 코드가 남고, 없는 상태를 있는 것처럼 읽힌다).
  const last = visible.at(-1);
  if (!last) {
    return null;
  }
  // 🔴 `delta === 0`(변화 없음)과 `null`(비교 불가)은 **다른 뜻**이다 — 섞지 않는다.
  const delta =
    visible.length >= 2
      ? Math.round((last.sov - visible[0].sov) * 10) / 10
      : null;
  return {
    delta,
    latest: Math.round(last.sov),
    rangeNote: days === null ? "전체 기간" : `최근 ${days}일`,
  };
}

/**
 * 주석을 X축의 어느 점에 붙일지 — **가장 가까운 측정 시점**으로 스냅한다(감사 D2).
 *   Recharts 의 카테고리 X축은 `label` 문자열로만 위치를 잡는다. 주석 시각이 측정 시각과
 *   정확히 같을 일은 없으므로, 가장 가까운 측정 점의 라벨에 붙인다.
 *   ⚠️ 추세 밖(첫 측정 이전·마지막 이후) 주석은 스냅해도 거짓 위치가 되므로 제외한다.
 */
function snapToTrend(
  annotations: TrendAnnotation[],
  trend: SovTrendPoint[]
): { annotation: TrendAnnotation; label: string }[] {
  if (trend.length === 0) {
    return [];
  }
  const first = trend[0].timestamp;
  const last = trend.at(-1)?.timestamp ?? first;
  const snapped: { annotation: TrendAnnotation; label: string }[] = [];
  for (const annotation of annotations) {
    const t = annotation.occurredAt.getTime();
    if (t < first || t > last) {
      continue;
    }
    let nearest = trend[0];
    for (const point of trend) {
      if (Math.abs(point.timestamp - t) < Math.abs(nearest.timestamp - t)) {
        nearest = point;
      }
    }
    snapped.push({ annotation, label: nearest.label });
  }
  return snapped;
}

// 브랜드 오렌지로 추세선 통일. 1-5(2026-08-06): 감성(긍정 비율) 라인 추가.
//   색 규율(§9 Stripe): "모든 데이터에 색을 칠하면 색은 의미를 잃는다" → 2계열까지만,
//   감성은 브랜드색과 구분되되 상태색(적/녹)이 아닌 중립 계열을 쓴다.
//   ⚠️ 적녹 조합 회피: 색맹 99%가 적녹이고, 하락을 빨강으로 칠하지 않는 것이 이 제품의 규율.
const chartConfig = {
  sov: {
    label: "등장률",
    color: "var(--findable-primary, #ff7a4d)",
  },
  positiveRate: {
    // 단청(teal) = 디자인시스템에 이미 있는 비상태색 2차 색상(globals.css:43).
    // 오렌지↔단청은 적녹이 아니라 색맹에서도 구분된다.
    label: "긍정 비율",
    color: "var(--findable-dancheong, oklch(0.58 0.110 195))",
  },
} satisfies ChartConfig;

// completed 측정들의 추세. 데이터는 서버(page.tsx)에서 asc 정렬되어 내려온다.
export const SovTrendChart = ({
  trend,
  annotations = [],
  brandId = null,
  emptyAction = null,
  annotationsSlot = null,
}: SovTrendChartProps) => {
  // 🔴 기간 선택지는 **데이터가 실제로 채우는 것만** 만든다(장식 컨트롤 금지).
  const options = rangeOptions(trend);
  // 기본값 = 전체(null). 점을 최대한 보여주는 쪽에서 시작한다.
  const [rangeDays, setRangeDays] = useState<number | null>(null);
  const visible = filterByRange(trend, rangeDays);
  const headline = headlineOf(visible, rangeDays);

  // 감성 데이터가 한 점도 없으면 라인·범례를 아예 그리지 않는다(빈 계열 = 노이즈).
  const hasSentiment = visible.some((point) => point.positiveRate !== null);
  const pins = snapToTrend(annotations, visible);

  return (
    <div className="findable-card p-5">
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg">
              시간에 따른 변화
            </h2>
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              {hasSentiment
                ? "측정할 때마다 AI가 우리를 얼마나 말하는지, 얼마나 좋게 말하는지"
                : "측정할 때마다 AI가 우리를 얼마나 말하는지"}
            </p>
          </div>
          {/* 🔴 기간 필터 — 경쟁사 4/4 가 갖고 있고 우리만 없었다(`Last 7 Days`·
              `Last 14 days`·`Last 12 weeks`). 실측 근거: nike.com 은 completed 측정이
              **6회 · Jul 30~Aug 17** 이라 기간을 좁히면 실제로 점 수가 달라진다
              (7일=2점 / 전체=6점). ⚠️ 점이 2개 미만이 되는 선택지는 **렌더하지 않는다** —
              고르면 빈 화면이 되는 필터는 경쟁사 공통 실패 1번(Otterly `No data`)이다. */}
          {options.length > 1 ? (
            <div className="flex shrink-0 flex-wrap gap-1">
              {options.map((option) => {
                const active = option.days === rangeDays;
                return (
                  <button
                    aria-pressed={active}
                    className={
                      active
                        ? "rounded-md bg-[color:var(--findable-surface-3,#1f2124)] px-2.5 py-1 text-[color:var(--findable-ink,#f7f8f8)] text-xs"
                        : "rounded-md px-2.5 py-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs hover:text-[color:var(--findable-ink,#f7f8f8)]"
                    }
                    key={option.label}
                    onClick={() => setRangeDays(option.days)}
                    type="button"
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {/* 🔴 큰 숫자 + 증감을 **차트 위**로(Profound f058 구조: `72.9% +0.7%` → 꺾은선).
            지금까지 이 카드는 선만 보여주고 "그래서 지금 몇 %인지"를 말하지 않았다.
            ⚠️ 증감은 **보이는 구간의 첫 점 대비**다 — 기간을 좁히면 기준도 함께 바뀐다
            (분모를 밝히지 않으면 같은 숫자가 다른 뜻이 된다). */}
        {headline ? (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tabular-nums">
              {headline.latest}%
            </span>
            {headline.delta === null ? null : (
              <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm tabular-nums">
                {headline.delta > 0 ? "+" : ""}
                {headline.delta}%p
              </span>
            )}
            <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
              {headline.rangeNote} · 측정 {visible.length}회 기준
            </span>
          </div>
        ) : null}
      </div>
      <div>
        {visible.length < 2 ? (
          // 빈 상태 = 행동 지향 + 격려형(Polaris §5-5). "실패"로 읽히지 않게 한다.
          <div className="flex h-[220px] flex-col items-center justify-center gap-3 rounded-lg border border-[color:var(--findable-hairline,#23252a)] border-dashed">
            <p className="max-w-xs text-center text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              두 번째 측정을 하면 변화를 그려드려요.
            </p>
            {/* 🔴 2026-08-17(N-37) — **말만 하고 방법을 주지 않던 자리다.**
                화면 3곳이 *"2회차부터 보여드려요"* 라고 안내하는데 정작 재측정 버튼이
                없었다. 실측: 1건(87원) 돌리자 잠겨 있던 화면 4개(추세·순위비교·감성변화·
                메모)가 **즉시** 열렸다. 빈 상태에서 다음 행동을 주는 게 이 카드의 일이다. */}
            {emptyAction}
          </div>
        ) : (
          <ChartContainer className="h-[220px] w-full" config={chartConfig}>
            <AreaChart
              accessibilityLayer
              data={visible}
              margin={{ left: 4, right: 12, top: 8 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="label"
                minTickGap={24}
                tickLine={false}
                tickMargin={8}
              />
              <YAxis
                axisLine={false}
                domain={[0, 100]}
                tickLine={false}
                tickMargin={8}
                width={32}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => `${value}%`}
                    indicator="dot"
                  />
                }
                cursor={false}
              />
              {/* §9-2(a): isAnimationActive={false} — Recharts 기본 진입 애니메이션은
                  prefers-reduced-motion 을 존중하지 않는다(Web Interface Guidelines 위반).
                  추세 차트는 모션이 정보를 더하지도 않는다. */}
              <Area
                dataKey="sov"
                fill="var(--color-sov)"
                fillOpacity={0.2}
                isAnimationActive={false}
                stroke="var(--color-sov)"
                strokeWidth={2}
                type="monotone"
              />
              {hasSentiment ? (
                // 감성은 면(Area)이 아니라 선(Line) — 두 면이 겹치면 둘 다 안 읽힌다.
                // connectNulls={false}: 감성 없는 측정 지점은 선을 끊는다(0으로 잇는 것은
                // "부정적으로 변했다"는 거짓 신호).
                <Line
                  connectNulls={false}
                  dataKey="positiveRate"
                  dot={false}
                  isAnimationActive={false}
                  stroke="var(--color-positiveRate)"
                  strokeWidth={2}
                  type="monotone"
                />
              ) : null}
              {/* 수동 주석 핀(감사 D2) — GSC 주석 패턴.
                  ⚠️ 상태색(적/녹) 금지 규율 유지: 주석은 "좋다/나쁘다"가 아니라 **사실**이라
                  중립 회색 점선으로 그린다. 라벨은 위쪽에 세로로 붙여 선을 가리지 않는다. */}
              {pins.map(({ annotation, label }) => (
                <ReferenceLine
                  key={annotation.id}
                  label={{
                    value: annotation.label,
                    position: "insideTopLeft",
                    fill: "var(--findable-ink-subtle, #8a8f98)",
                    fontSize: 11,
                  }}
                  stroke="var(--findable-ink-subtle, #8a8f98)"
                  strokeDasharray="3 3"
                  strokeOpacity={0.5}
                  x={label}
                />
              ))}
              {hasSentiment ? (
                <ChartLegend content={<ChartLegendContent />} />
              ) : null}
            </AreaChart>
          </ChartContainer>
        )}
      </div>

      {/* 주석 관리 — 브랜드가 특정될 때만(AuditJob 폴백엔 Brand 행이 없다). */}
      {/* 주석 UI 는 **전체 추세** 기준으로 판단한다 — 기간을 7일로 좁혔다고
          이미 달아둔 메모 관리 창구가 사라지면 안 된다(메모는 기간의 함수가 아니다). */}
      {brandId && trend.length >= 2 ? annotationsSlot : null}
    </div>
  );
};
