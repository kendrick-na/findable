// 근거 등급 6칸 + 「하지 마세요」 — 표시 전용 컴포넌트 (2026-09-28).
//
// 🔴 근거 등급은 **글자로** 쓴다(색만으로 구분하지 않는다 — 색각 이상·흑백 인쇄).
// 🔴 등급 이름·엔진 이름은 `@repo/audit/action-rules` 한 곳에서 가져온다(웹과 문구가 갈리지 않게).
// 상태·이벤트 없음 → 서버/클라이언트 어디서든 렌더된다.

import {
  type ActionGuide,
  type DontItem,
  EVIDENCE_GRADE_LABEL,
  type EvidenceGrade,
  engineDisplayName,
} from "@repo/audit/action-rules";
import { cn } from "@repo/design-system/lib/utils";

const GRADE_TONE: Record<EvidenceGrade, string> = {
  strong:
    "border-[color:var(--findable-primary,#ff7a4d)]/40 text-[color:var(--findable-primary,#ff7a4d)]",
  medium: "border-sky-400/30 text-sky-300",
  weak: "border-white/15 text-[color:var(--findable-ink-subtle,#8a8f98)]",
  none: "border-red-400/30 text-red-300",
};

export const EvidenceGradeBadge = ({ grade }: { grade: EvidenceGrade }) => (
  <span
    className={cn(
      "rounded-full border px-2 py-0.5 font-medium text-xs",
      GRADE_TONE[grade]
    )}
    title={EVIDENCE_GRADE_LABEL[grade].meaning}
  >
    {EVIDENCE_GRADE_LABEL[grade].label}
  </span>
);

function effortLabel(effort: ActionGuide["effortHours"]): string {
  const range =
    effort.min === effort.max
      ? `${effort.min}시간`
      : `${effort.min}~${effort.max}시간`;
  return effort.per === "week" ? `매주 약 ${range}` : `약 ${range}`;
}

function enginesLabel(engines: string[]): string {
  return engines.length === 0
    ? "측정한 AI 전체"
    : engines.map(engineDisplayName).join(", ");
}

const Row = ({ label, children }: { children: string; label: string }) => (
  <div className="grid gap-0.5 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
    <dt className="font-medium text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
      {label}
    </dt>
    <dd className="text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm leading-relaxed">
      {children}
    </dd>
  </div>
);

/** 카드 6칸 — 근거 등급·출처 / 적용 AI / 작업 시간 / 효과가 보이기까지 / 다시 잴 숫자 / 실패로 볼 조건. */
export const ActionEvidenceGuide = ({ guide }: { guide: ActionGuide }) => (
  <div className="flex flex-col gap-3 rounded border border-white/6 bg-white/[0.02] p-3">
    <div className="flex flex-wrap items-center gap-2">
      <EvidenceGradeBadge grade={guide.evidenceGrade} />
      <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
        {EVIDENCE_GRADE_LABEL[guide.evidenceGrade].meaning}
      </span>
    </div>
    <dl className="flex flex-col gap-2">
      <Row label="적용되는 AI">{enginesLabel(guide.engines)}</Row>
      <Row label="작업 시간">{effortLabel(guide.effortHours)}</Row>
      <Row label="효과가 보이기까지">{guide.effectLag}</Row>
      <Row label="다시 잴 숫자">{guide.remeasureMetric}</Row>
      <Row label="실패로 볼 조건">{guide.failCondition}</Row>
    </dl>
    {guide.quotes && guide.quotes.length > 0 && (
      <div className="flex flex-col gap-2">
        <p className="font-medium text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
          AI가 실제로 이렇게 답했습니다
        </p>
        {guide.quotes.map((q) => (
          <blockquote
            className="border-white/15 border-l-2 pl-3 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed"
            key={`${q.engineId}:${q.excerpt.slice(0, 24)}`}
          >
            <span className="font-medium text-[color:var(--findable-ink-muted,#d0d6e0)]">
              {engineDisplayName(q.engineId)}
            </span>{" "}
            {q.excerpt}
          </blockquote>
        ))}
      </div>
    )}
    <SourceLinks sources={guide.sources} />
  </div>
);

const SourceLinks = ({ sources }: { sources: ActionGuide["sources"] }) => (
  <ul className="flex flex-col gap-1">
    {sources.map((s) => (
      <li className="text-xs" key={s.url}>
        <a
          className="text-[color:var(--findable-ink-subtle,#8a8f98)] underline underline-offset-2 hover:text-[color:var(--findable-ink,#f7f8f8)]"
          href={s.url}
          rel="noopener noreferrer"
          target="_blank"
        >
          출처: {s.label}
        </a>
      </li>
    ))}
  </ul>
);

/** 「하지 마세요」 — 항목마다 이유와 출처. 등급은 항상 '근거 없음'. */
export const DontList = ({ donts }: { donts: DontItem[] }) => (
  <ul className="flex flex-col gap-3">
    {donts.map((d) => (
      <li
        className="flex flex-col gap-1.5 rounded border border-white/6 bg-white/[0.02] p-3"
        key={d.title}
      >
        <div className="flex flex-wrap items-center gap-2">
          <EvidenceGradeBadge grade={d.evidenceGrade} />
          <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
            {d.title}
          </span>
        </div>
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
          {d.reason}
        </p>
        <SourceLinks sources={d.sources} />
      </li>
    ))}
  </ul>
);
