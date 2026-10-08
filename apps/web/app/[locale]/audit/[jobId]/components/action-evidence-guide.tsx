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
} from "@repo/audit/action-rules";
import { engineDisplayName } from "@repo/audit/engine-labels";

const GRADE_MEANING_EN: Record<EvidenceGrade, string> = {
  strong: "An official platform document confirms this prerequisite.",
  medium:
    "A large observation or official document exists; this does not guarantee an effect.",
  weak: "Only a small experiment or limited replication supports this.",
  none: "No effect is established, or there is a policy or downside risk.",
};
const GRADE_TONE: Record<EvidenceGrade, string> = {
  strong: "border-[var(--brand-3)]/40 text-[var(--brand-3)]",
  medium: "border-sky-300/30 text-sky-300",
  weak: "border-white/15 text-zinc-400",
  none: "border-red-300/30 text-red-300",
};

function GradeBadge({
  grade,
  isKo = true,
}: {
  grade: EvidenceGrade;
  isKo?: boolean;
}) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-medium text-xs ${GRADE_TONE[grade]}`}
      title={
        isKo ? EVIDENCE_GRADE_LABEL[grade].meaning : GRADE_MEANING_EN[grade]
      }
    >
      {isKo ? EVIDENCE_GRADE_LABEL[grade].label : `Evidence: ${grade}`}
    </span>
  );
}

function effortLabel(
  effort: ActionGuide["effortHours"],
  isKo: boolean
): string {
  const range = effortRange(effort, isKo);
  if (effort.per === "week") {
    return isKo ? `매주 약 ${range}` : `about ${range} per week`;
  }
  return isKo ? `약 ${range}` : `about ${range}`;
}

function effortRange(
  effort: ActionGuide["effortHours"],
  isKo: boolean
): string {
  if (effort.min === effort.max) {
    return isKo ? `${effort.min}시간` : `${effort.min} hours`;
  }
  return isKo
    ? `${effort.min}~${effort.max}시간`
    : `${effort.min}-${effort.max} hours`;
}

function allChannelsLabel(isKo: boolean): string {
  return isKo ? "측정 채널 전체" : "All measured channels";
}

function Sources({
  sources,
  isKo = true,
}: {
  sources: ActionGuide["sources"];
  isKo?: boolean;
}) {
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
            {isKo ? "출처: " : "Source: "}
            {s.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ActionEvidenceGuide({
  guide,
  isKo = true,
}: {
  guide: ActionGuide;
  isKo?: boolean;
}) {
  const engineLabel = (engine: string) => engineDisplayName(engine, isKo);
  const storedRuleValue = (value: string) =>
    isKo ? value : `Stored Korean rule: ${value}`;
  const rows: [string, string][] = [
    [
      isKo ? "적용 채널" : "Measurement channels",
      guide.engines.length === 0
        ? allChannelsLabel(isKo)
        : guide.engines.map(engineLabel).join(", "),
    ],
    [
      isKo ? "예상 작업 시간" : "Estimated work time",
      effortLabel(guide.effortHours, isKo),
    ],
    [
      isKo ? "재측정 권장 시점" : "Suggested remeasurement timing",
      storedRuleValue(guide.effectLag),
    ],
    [
      isKo ? "다시 잴 숫자" : "Metric to remeasure",
      storedRuleValue(guide.remeasureMetric),
    ],
    [
      isKo ? "재점검 조건" : "Recheck condition",
      storedRuleValue(guide.failCondition),
    ],
  ];
  return (
    <div className="mt-4 space-y-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <GradeBadge grade={guide.evidenceGrade} isKo={isKo} />
        <span className="text-xs text-zinc-400">
          {isKo
            ? EVIDENCE_GRADE_LABEL[guide.evidenceGrade].meaning
            : GRADE_MEANING_EN[guide.evidenceGrade]}
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
        {isKo
          ? "작업 시간·재측정 시점·재점검 조건은 Findable 내부 운영 기준·추정이며 효과를 입증하지 않습니다."
          : "Work time, remeasurement timing, and recheck conditions are Findable operating estimates; they do not prove an effect."}
      </p>
      {guide.quotes && guide.quotes.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium text-xs text-zinc-400">
            {isKo
              ? "AI가 실제로 이렇게 답했습니다"
              : "Measured response excerpt"}
          </p>
          {guide.quotes.map((q) => (
            <blockquote
              className="border-white/15 border-l-2 pl-3 text-sm text-zinc-400 leading-relaxed"
              key={`${q.engineId}:${q.excerpt.slice(0, 24)}`}
            >
              <span className="font-medium text-zinc-200">
                {engineLabel(q.engineId)}
              </span>{" "}
              {q.excerpt}
            </blockquote>
          ))}
        </div>
      )}
      <Sources isKo={isKo} sources={guide.sources} />
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
