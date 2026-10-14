import type { DomainType } from "@/lib/gap/domain-type";
import type { GapAnalysis } from "@/lib/gap/gap-analysis";
import type { AppDictionary } from "@/lib/i18n";
import { GapAnalyzeButton } from "./gap-analyze-button";

type Labels = AppDictionary["gapPanel"];

const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
    s
  );

const typeLabel = (t: Labels, type: DomainType) => t[`type_${type}`];
const hintLabel = (t: Labels, type: DomainType) => t[`hint_${type}`];

const Section = ({
  children,
  hint,
  title,
}: {
  children: React.ReactNode;
  hint?: string;
  title: string;
}) => (
  <section className="findable-card flex flex-col gap-3 p-5">
    <div>
      <h3 className="font-medium">{title}</h3>
      {hint ? (
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
          {hint}
        </p>
      ) : null}
    </div>
    {children}
  </section>
);

const BoardSection = ({ data, t }: { data: GapAnalysis; t: Labels }) =>
  data.brandBoard.length === 0 ? null : (
    <Section hint={t.boardHint} title={t.boardTitle}>
      <ul className="flex flex-col gap-1.5 text-sm">
        {data.brandBoard.map((b) => (
          <li className="flex items-center justify-between gap-3" key={b.name}>
            <span>
              {b.name}{" "}
              <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                {b.isRegistered ? t.registered : t.candidate}
              </span>
            </span>
            <span className="tabular-nums">
              {fill(t.answersValue, { n: b.answers })}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );

const QuestionSection = ({ data, t }: { data: GapAnalysis; t: Labels }) => (
  <Section title={t.questionsTitle}>
    {data.questionGaps.length === 0 ? (
      <p className="text-sm">{t.questionsEmpty}</p>
    ) : (
      <ul className="flex flex-col gap-3 text-sm">
        {data.questionGaps.map((q) => (
          <li key={q.promptText}>
            <p className="font-medium">{q.promptText}</p>
            <p className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
              {t.questionWith}: {q.competitors.map((c) => c.name).join(", ")}
            </p>
          </li>
        ))}
      </ul>
    )}
  </Section>
);

const SourceSection = ({ data, t }: { data: GapAnalysis; t: Labels }) => (
  <Section hint={t.sourcesHint} title={t.sourcesTitle}>
    {data.sourceGaps.length === 0 ? (
      <p className="text-sm">{t.sourcesEmpty}</p>
    ) : (
      <ul className="flex flex-col gap-3 text-sm">
        {data.sourceGaps.map((s) => (
          <li className="flex flex-col gap-0.5" key={s.domain}>
            <p>
              <a
                className="font-medium underline underline-offset-4"
                href={s.sampleUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                {s.domain}
              </a>{" "}
              <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                {typeLabel(t, s.type)} ·{" "}
                {fill(t.sourceCount, { n: s.absentAnswers })}
              </span>
            </p>
            {s.competitors.length > 0 ? (
              <p className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
                {t.sourceWith}: {s.competitors.join(", ")}
              </p>
            ) : null}
            <p>
              {t.actionTitle}: {hintLabel(t, s.type)}
            </p>
          </li>
        ))}
      </ul>
    )}
  </Section>
);

/** 경쟁사 빈틈 분석 패널 — 분석 전이면 버튼만, 분석 후에는 보드·질문 빈틈·출처 빈틈. */
export const GapPanel = ({
  brandId,
  data,
  t,
}: {
  brandId: string;
  data: GapAnalysis | null;
  t: Labels;
}) => {
  const analyzed = data?.analyzed ?? 0;
  const total = data?.total ?? 0;
  const partial = total > 0 && analyzed < total;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-semibold text-lg">{t.title}</h2>
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
          {t.lede}
        </p>
      </div>
      {analyzed === 0 ? (
        <div className="findable-card flex flex-col gap-3 p-5">
          <p className="text-sm">{t.needAnalyze}</p>
          <GapAnalyzeButton
            brandId={brandId}
            label={t.analyze}
            pendingLabel={t.analyzing}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>{fill(t.progress, { analyzed, total })}</span>
            <a
              className="underline underline-offset-4"
              href={`/api/export/gap.csv?brand=${brandId}`}
            >
              {t.csv}
            </a>
          </div>
          {partial ? (
            <div className="flex flex-col gap-2">
              <p className="text-amber-600 text-sm dark:text-amber-400">
                {t.partialNote}
              </p>
              <GapAnalyzeButton
                brandId={brandId}
                label={t.analyzeMore}
                pendingLabel={t.analyzing}
              />
            </div>
          ) : null}
          <BoardSection data={data as GapAnalysis} t={t} />
          <QuestionSection data={data as GapAnalysis} t={t} />
          <SourceSection data={data as GapAnalysis} t={t} />
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
            {t.excerptNote}
          </p>
        </>
      )}
    </div>
  );
};
