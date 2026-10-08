// 백로그 4(2026-07-31): 경쟁사 SoV 리더보드 — org 최신 측정 1회분 기반.
// 서버 컴포넌트(상호작용 없음). 데이터는 analysis-data.ts 가 이미 집계해 넘긴다.
//
// 🔴 2026-08-22 — "누가 더 많이 나오나" 순위(등장률 기준)와 "평균 N위"(등장했을 때
//   실제 순번의 평균)는 계산 근거가 다른데 같은 "위"라는 말을 써서 혼동을 낳았다
//   (실측: 1위 아디다스 13%·평균1.7위 vs 3위 나이키 8%·평균1위 — "1위인데 왜 평균이
//   더 나쁘지?"). `<details>`는 이미 대시보드 KPI 카드(dashboard-kpis.tsx)가 쓰는
//   패턴 그대로 재사용한다 — 툴팁은 터치에 없고 링크 안 트리거는 중첩 인터랙티브가
//   되어 배제됐던 이유가 여기도 같다(이 카드도 순위 클릭 시 다른 화면으로 안 감).

import { cn } from "@repo/design-system/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import type { AppDictionary } from "@/lib/i18n";
import type { CompetitorAnalysis } from "../../lib/analysis-data";
import { isMyBrand } from "../../lib/analysis-data";
import {
  formatMeasuredAt,
  type RelativeTimeLabels,
} from "../../lib/dashboard-data";

// 표본이 이 미만이면 순위가 흔들릴 수 있다는 주의를 띄운다(www 무료 진단과 동일 기준).
const LOW_CONFIDENCE_SAMPLE = 10;
// 화면에 세우는 최대 경쟁사 수. 롱테일(1회 언급)은 노이즈라 자른다.
const MAX_ROWS = 10;

export const CompetitorBoard = ({
  data,
  relativeTime,
  t,
}: {
  data: CompetitorAnalysis;
  /** 사전 `app.competitorBoard`. */
  t: AppDictionary["competitorBoard"];
  /** 상대 시간 문구(사전 `app.relativeTime`). */
  relativeTime: RelativeTimeLabels;
}) => {
  const { landscape, brandName, measuredAt, responsesParsed } = data;
  const rows = landscape.ranking.slice(0, MAX_ROWS);
  const topShare = rows[0]?.shareOfVoice ?? 0;
  const myRank = landscape.ranking.findIndex((row) =>
    isMyBrand(row.name, brandName)
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard
          hint={t.myRankHint}
          label={t.myRank}
          value={
            myRank >= 0
              ? t.rankValue.replace("{n}", String(myRank + 1))
              : t.outOfRanking
          }
        />
        <SummaryCard
          hint={t.brandsHint}
          label={t.brands}
          value={t.brandsValue.replace("{n}", String(landscape.ranking.length))}
        />
        <SummaryCard
          hint={t.lastHint.replace("{n}", String(responsesParsed))}
          label={t.last}
          value={formatMeasuredAt(measuredAt, relativeTime)}
        />
      </div>

      <div className="findable-card flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg">
            {t.title}
          </h2>
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            {t.lede}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {rows.map((row, index) => {
            const mine = isMyBrand(row.name, brandName);
            // 1위 대비 상대 폭 — 절대 %는 옆에 숫자로 보여주므로 막대는 비교용.
            const width =
              topShare > 0 ? (row.shareOfVoice / topShare) * 100 : 0;
            return (
              <div className="flex items-center gap-3" key={row.name}>
                <span className="w-6 shrink-0 text-right text-[color:var(--findable-ink-tertiary,#7e8289)] text-sm tabular-nums">
                  {index + 1}
                </span>
                <span
                  className={cn(
                    "w-32 shrink-0 truncate text-sm",
                    mine
                      ? "font-semibold text-[color:var(--findable-primary,#ff7a4d)]"
                      : "text-[color:var(--findable-ink-muted,#d0d6e0)]"
                  )}
                  title={row.name}
                >
                  {row.name}
                  {mine && t.ours}
                </span>
                <div className="h-6 flex-1 overflow-hidden rounded bg-[color:var(--findable-surface-2,#141516)]">
                  <div
                    className={cn(
                      "h-full rounded transition-all",
                      mine
                        ? "bg-[color:var(--findable-primary,#ff7a4d)]"
                        : "bg-[color:var(--findable-ink-tertiary,#7e8289)]"
                    )}
                    style={{ width: `${Math.max(width, 2)}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-[color:var(--findable-ink,#f7f8f8)] text-sm tabular-nums">
                  {row.shareOfVoice}%
                </span>
                <span className="hidden w-20 shrink-0 whitespace-nowrap text-right text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs tabular-nums sm:inline">
                  {t.averageRank.replace("{n}", String(row.averageRank))}
                </span>
              </div>
            );
          })}
        </div>

        {/* 🔴 왼쪽 번호(등장률 순위)와 오른쪽 "평균 N위"가 다른 지표라는 걸
            설명한다 — dashboard-kpis.tsx의 MetricGlossary와 같은 이유로
            details를 쓴다(툴팁은 터치 없음·행마다 아이콘은 인터랙티브 과다).
            오른쪽 지표 자체가 `sm:` 이상에서만 보이므로(모바일은 좁아서 뺐다),
            이 뜻풀이도 같은 뷰포트에서만 보인다 — 화면에 없는 지표를 설명하면
            더 헷갈린다. */}
        <details className="group hidden sm:block">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs hover:text-[color:var(--findable-ink-subtle,#8a8f98)]">
            <span className="[&::-webkit-details-marker]:hidden">
              {t.glossaryToggle}
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className="size-3 transition-transform group-open:rotate-180"
            />
          </summary>
          <p className="mt-2 border-[color:var(--findable-hairline,#26292e)] border-l-2 pl-3 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs leading-relaxed">
            {t.glossary}
          </p>
        </details>

        {!landscape.brandInRanking && (
          <p className="rounded border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-amber-300/90 text-sm">
            {landscape.brandFound ? t.foundNotRanked : t.notFound}
          </p>
        )}

        <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs leading-relaxed">
          {t.noteBefore}
          <strong>{t.noteStrong}</strong>
          {t.noteAfter}
          {landscape.sampleSize < LOW_CONFIDENCE_SAMPLE &&
            t.lowSample.replace("{n}", String(landscape.sampleSize))}
          {/* 🔴 변별력 없는 분포 고지 (2026-08-06 세션N-7)
              무료 진단(www)은 이 경우 섹션을 **숨긴다**. 여기는 경쟁 비교 **전용 페이지**라
              숨기면 빈 화면이 되므로, 대신 "순위로 읽지 말라"고 명시한다(같은 판정·다른 처방).
              실측: 라이브 5건 중 3건이 사실상 동률이었다(전원 2% 등). */}
          {!landscape.discriminative && t.flat}
        </p>
      </div>
    </div>
  );
};

const SummaryCard = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) => (
  <div className="findable-card flex flex-col gap-2 p-5">
    <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
      {label}
    </p>
    <span className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)]">
      {value}
    </span>
    <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
      {hint}
    </p>
  </div>
);
