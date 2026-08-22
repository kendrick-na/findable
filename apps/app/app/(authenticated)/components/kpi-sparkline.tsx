"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";

// ──────────────────────────────────────────────────
// 1-6 스파크라인 (원안 §10 1단계) — 📕UIUX_대개선_기획서_2026-08-06.md §3-1
//
// 🔴 세션N-5에서 **조용히 빠진 항목**. 원안 1-6이 "스파크라인"이었는데 구현 1-6이
//   "모션 off"로 번호가 덮이면서 누락됐고 완료표에도 안 적혔다(2026-08-06 실측 grep 0건).
//
// 왜 넣는가: 리서치 §2 "Ahrefs = 숫자+델타+**스파크라인** 3종 세트"가 히어로 카드의
//   업계 표준. 델타 배지는 "직전 대비 1점"만 말하고 **모양**을 못 말한다
//   (같은 +7%p라도 계속 오르는 중 vs 떨어지다 반등은 완전히 다른 이야기).
//
// 규율(따를 것):
//   · 토스 = "격자선·커스터마이징 없이 **추세만**" → 축·격자·툴팁·범례 전부 없음.
//     장식이 아니라 **정보 밀도**다. 카드의 주인공은 숫자이고 이건 배경 맥락.
//   · shadcn charts에 스파크라인 템플릿이 **없다**(리서치 실측) → Recharts로 직접 제작.
//     ChartContainer도 쓰지 않는다 — 툴팁·범례·색토큰 주입이 목적인 래퍼라 여기선 과잉.
//   · `isAnimationActive={false}` — §9-2(a) 모션 규약. 1-6(모션 off)과 같은 규율.
//   · `aria-hidden` — 같은 정보를 옆의 숫자·힌트가 **글자로 이미 말한다**.
//     스크린리더에 좌표 나열을 읽히면 중복 소음이 된다(WIG: 장식 그래픽은 접근성 트리 제외).
// ──────────────────────────────────────────────────

/** 2점 미만이면 "추세"가 존재하지 않는다 → 그리지 않는다(빈 계열 = 노이즈). */
const MIN_POINTS = 2;

interface KpiSparklineProps {
  /** 선 색. 지표마다 카드 성격에 맞춰 다르게 준다. */
  color: string;
  /**
   * 값이 낮을수록 좋은 지표(=언급 순위)면 true.
   * 이때 값을 부호 반전해 그린다 — **"위로 가면 좋아짐"** 을 세 카드에서 동일하게 유지한다.
   * 반전하지 않으면 순위가 1.3→1.0으로 개선될 때 선이 내려가 "나빠졌다"로 오독된다.
   * (스파크라인은 절대값 축이 없어 부호 반전이 모양에 주는 왜곡이 없다.)
   */
  lowerIsBetter?: boolean;
  /** 오래된→최신 순 값. null(미측정)은 호출부에서 걸러 넣는다. */
  values: number[];
}

export const KpiSparkline = ({
  values,
  color,
  lowerIsBetter = false,
}: KpiSparklineProps) => {
  if (values.length < MIN_POINTS) {
    return null;
  }

  const data = values.map((value, index) => ({
    index,
    value: lowerIsBetter ? -value : value,
  }));

  return (
    <div aria-hidden="true" className="h-8 w-full">
      <ResponsiveContainer height="100%" width="100%">
        <LineChart
          data={data}
          margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
        >
          <Line
            dataKey="value"
            dot={false}
            isAnimationActive={false}
            stroke={color}
            strokeWidth={1.5}
            type="monotone"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export { MIN_POINTS as SPARKLINE_MIN_POINTS };
