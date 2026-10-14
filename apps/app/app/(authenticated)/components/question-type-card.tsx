import type {
  BaselineState,
  QuestionTypeBreakdown,
} from "@/lib/brand/question-type-breakdown";
import type { AppDictionary } from "@/lib/i18n";

/**
 * 「이런 질문에서 얼마나 나오나」 카드(2026-10-14 · 대표 승인).
 * 메인 점수는 건드리지 않고, 이름을 넣은 질문과 이름 없이 추천을 묻는 질문을 나눠 보여 준다.
 * 순수 뷰다 — 데이터는 서버 래퍼(`question-type-card-server.tsx`)가 만든다.
 */
export type QuestionTypeCardLabels = AppDictionary["questionTypeCard"];

const Row = ({
  label,
  mentioned,
  answers,
  ratePct,
  countText,
}: {
  answers: number;
  countText: string;
  label: string;
  mentioned: number;
  ratePct: number | null;
}) => (
  <div className="flex flex-col gap-1">
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-[color:var(--findable-ink,#f7f8f8)]">{label}</span>
      <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] tabular-nums">
        {ratePct === null ? "—" : `${ratePct}%`}
      </span>
    </div>
    <div
      aria-hidden="true"
      className="h-1.5 overflow-hidden rounded-full bg-[color:var(--findable-surface-2,#17181a)]"
    >
      <div
        className="h-full rounded-full bg-[color:var(--findable-primary,#ff7a4d)]"
        style={{ width: `${ratePct ?? 0}%` }}
      />
    </div>
    <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
      {answers === 0
        ? countText.replace("{m}", "0").replace("{n}", "0")
        : countText
            .replace("{m}", String(mentioned))
            .replace("{n}", String(answers))}
    </span>
  </div>
);

export const QuestionTypeCard = ({
  baseline,
  baselineDate,
  data,
  t,
}: {
  baseline: BaselineState;
  /** 처음 측정 날짜(표시용). */
  baselineDate: string | null;
  data: QuestionTypeBreakdown;
  t: QuestionTypeCardLabels;
}) => {
  let baselineText: string = t.baselineFirst;
  if (baseline.kind === "same") {
    baselineText = t.baselineSame
      .replace("{date}", baselineDate ?? "")
      .replace("{from}", String(baseline.fromPct))
      .replace("{to}", String(baseline.toPct));
  } else if (baseline.kind === "changed") {
    baselineText = t.baselineChanged;
  }
  return (
    <section
      aria-label={t.title}
      className="flex flex-col gap-3 rounded-xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
          {t.title}
        </h2>
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
          {t.hint}
        </p>
      </div>
      <Row
        answers={data.named.answers}
        countText={t.counts}
        label={t.rowNamed}
        mentioned={data.named.mentioned}
        ratePct={data.named.ratePct}
      />
      <Row
        answers={data.nameless.answers}
        countText={t.counts}
        label={t.rowNameless}
        mentioned={data.nameless.mentioned}
        ratePct={data.nameless.ratePct}
      />
      {data.competitorsListedAvg !== null && data.competitorsListedAvg > 0 ? (
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
          {t.competitorsAvg.replace("{n}", String(data.competitorsListedAvg))}
        </p>
      ) : null}
      <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
        {baselineText}
      </p>
    </section>
  );
};
