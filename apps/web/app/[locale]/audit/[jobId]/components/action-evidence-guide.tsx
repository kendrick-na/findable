// 근거 등급 6칸 + 「하지 마세요」 — 무료 진단 결과용 표시 컴포넌트 (2026-09-28).
//
// ⚠️ 아직 `audit-result.tsx` 에 연결하지 않았다(다른 브랜치가 같은 파일을 고치는 중).
//   연결은 `ActionDetails` 안에서 `action.guide` 가 있을 때
//   `<ActionEvidenceGuide guide={action.guide} />` 한 줄이면 된다(한국어 전용 문구).
// 🔴 근거 등급은 글자로 쓴다(색만으로 구분하지 않는다).
// 🔴 등급·엔진 이름은 `@repo/audit/action-rules` 에서 가져온다(앱 대시보드와 문구 일치).

import {
  type ActionGuide,
  type DontItem,
  EVIDENCE_GRADE_LABEL,
  type EvidenceGrade,
  engineDisplayName,
} from "@repo/audit/action-rules";

const GRADE_TONE: Record<EvidenceGrade, string> = {
  strong: "border-[var(--brand-3)]/40 text-[var(--brand-3)]",
  medium: "border-sky-300/30 text-sky-300",
  weak: "border-white/15 text-zinc-400",
  none: "border-red-300/30 text-red-300",
};

function GradeBadge({ grade }: { grade: EvidenceGrade }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-medium text-xs ${GRADE_TONE[grade]}`}
      title={EVIDENCE_GRADE_LABEL[grade].meaning}
    >
      {EVIDENCE_GRADE_LABEL[grade].label}
    </span>
  );
}

function effortLabel(effort: ActionGuide["effortHours"]): string {
  const range =
    effort.min === effort.max
      ? `${effort.min}시간`
      : `${effort.min}~${effort.max}시간`;
  return effort.per === "week" ? `매주 약 ${range}` : `약 ${range}`;
}

function Sources({ sources }: { sources: ActionGuide["sources"] }) {
  return (
    <ul className="space-y-1">
      {sources.map((s) => (
        <li className="text-xs" key={s.url}>
          <a
            className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200"
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
}

export function ActionEvidenceGuide({ guide }: { guide: ActionGuide }) {
  const rows: [string, string][] = [
    [
      "적용되는 AI",
      guide.engines.length === 0
        ? "측정한 AI 전체"
        : guide.engines.map(engineDisplayName).join(", "),
    ],
    ["예상 작업 시간", effortLabel(guide.effortHours)],
    ["재측정 권장 시점", guide.effectLag],
    ["다시 잴 숫자", guide.remeasureMetric],
    ["재점검 조건", guide.failCondition],
  ];
  return (
    <div className="mt-4 space-y-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <GradeBadge grade={guide.evidenceGrade} />
        <span className="text-xs text-zinc-400">
          {EVIDENCE_GRADE_LABEL[guide.evidenceGrade].meaning}
        </span>
      </div>
      <dl className="space-y-2">
        {rows.map(([label, value]) => (
          <div
            className="grid gap-0.5 sm:grid-cols-[7.5rem_1fr] sm:gap-3"
            key={label}
          >
            <dt className="font-medium text-xs text-zinc-400">{label}</dt>
            <dd className="text-sm text-zinc-300 leading-relaxed">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-zinc-500 leading-relaxed">
        작업 시간·재측정 시점·재점검 조건은 Findable 내부 운영 기준·추정이며 효과를 입증하지 않습니다.
      </p>
      {guide.quotes && guide.quotes.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium text-xs text-zinc-400">
            AI가 실제로 이렇게 답했습니다
          </p>
          {guide.quotes.map((q) => (
            <blockquote
              className="border-white/15 border-l-2 pl-3 text-sm text-zinc-400 leading-relaxed"
              key={`${q.engineId}:${q.excerpt.slice(0, 24)}`}
            >
              <span className="font-medium text-zinc-200">
                {engineDisplayName(q.engineId)}
              </span>{" "}
              {q.excerpt}
            </blockquote>
          ))}
        </div>
      )}
      <Sources sources={guide.sources} />
    </div>
  );
}

export function DontList({ donts }: { donts: DontItem[] }) {
  return (
    <ul className="space-y-3">
      {donts.map((d) => (
        <li
          className="space-y-1.5 rounded-lg border border-white/10 bg-white/[0.02] p-3"
          key={d.title}
        >
          <div className="flex flex-wrap items-center gap-2">
            <GradeBadge grade={d.evidenceGrade} />
            <span className="font-medium text-sm text-zinc-100">{d.title}</span>
          </div>
          <p className="text-sm text-zinc-400 leading-relaxed">{d.reason}</p>
          <Sources sources={d.sources} />
        </li>
      ))}
    </ul>
  );
}
