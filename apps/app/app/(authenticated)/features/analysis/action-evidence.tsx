// 근거 등급 6칸 + 「하지 마세요」 — 표시 전용 컴포넌트 (2026-09-28).
//
// 🔴 근거 등급은 **글자로** 쓴다(색만으로 구분하지 않는다 — 색각 이상·흑백 인쇄).
// 🔴 등급 이름·엔진 이름은 `@repo/audit/action-rules` 한 곳에서 가져온다(웹과 문구가 갈리지 않게).
// 상태·이벤트 없음 → 서버/클라이언트 어디서든 렌더된다.

import type {
  ActionGuide,
  DontItem,
  EvidenceGrade,
} from "@repo/audit/action-rules";
// 엔진 이름은 언어를 받는 원본(`engine-labels`)에서 — `action-rules` 판은 한국어 고정 별칭이다.
import { engineDisplayName } from "@repo/audit/engine-labels";
import { cn } from "@repo/design-system/lib/utils";
import type { AppDictionary } from "@/lib/i18n";

const GRADE_TONE: Record<EvidenceGrade, string> = {
  strong:
    "border-[color:var(--findable-primary,#ff7a4d)]/40 text-[color:var(--findable-primary,#ff7a4d)]",
  medium: "border-sky-400/30 text-sky-300",
  weak: "border-white/15 text-[color:var(--findable-ink-subtle,#8a8f98)]",
  none: "border-red-400/30 text-red-300",
};

/** 사전 `app.actionEvidence`. */
export type ActionEvidenceLabels = AppDictionary["actionEvidence"];

// 등급 이름·뜻 — 사전 `app.actionEvidence.grade*`(한국어 원문은 `EVIDENCE_GRADE_LABEL` 과 같다).
function gradeCopy(
  grade: EvidenceGrade,
  t: ActionEvidenceLabels
): { label: string; meaning: string } {
  const map: Record<EvidenceGrade, { label: string; meaning: string }> = {
    strong: { label: t.gradeStrong, meaning: t.gradeStrongMeaning },
    medium: { label: t.gradeMedium, meaning: t.gradeMediumMeaning },
    weak: { label: t.gradeWeak, meaning: t.gradeWeakMeaning },
    none: { label: t.gradeNone, meaning: t.gradeNoneMeaning },
  };
  return map[grade];
}

export const EvidenceGradeBadge = ({
  grade,
  t,
}: {
  grade: EvidenceGrade;
  t: ActionEvidenceLabels;
}) => (
  <span
    className={cn(
      "rounded-full border px-2 py-0.5 font-medium text-xs",
      GRADE_TONE[grade]
    )}
    title={gradeCopy(grade, t).meaning}
  >
    {gradeCopy(grade, t).label}
  </span>
);

function effortLabel(
  effort: ActionGuide["effortHours"],
  t: ActionEvidenceLabels
): string {
  const range =
    effort.min === effort.max
      ? t.hoursOne.replace("{n}", String(effort.min))
      : t.hoursRange
          .replace("{min}", String(effort.min))
          .replace("{max}", String(effort.max));
  return (effort.per === "week" ? t.weekly : t.about).replace("{range}", range);
}

function channelsLabel(
  engines: string[],
  t: ActionEvidenceLabels,
  isKo: boolean
): string {
  return engines.length === 0
    ? t.allChannels
    : engines.map((id) => engineDisplayName(id, isKo)).join(", ");
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

/** 카드 6칸 — 근거 등급·출처 / 적용 채널 / 예상 작업 시간 / 재측정 권장 시점 / 다시 잴 숫자 / 재점검 조건. */
export const ActionEvidenceGuide = ({
  guide,
  isKo = true,
  t,
}: {
  guide: ActionGuide;
  isKo?: boolean;
  t: ActionEvidenceLabels;
}) => (
  <div className="flex flex-col gap-3 rounded border border-white/6 bg-white/[0.02] p-3">
    <div className="flex flex-wrap items-center gap-2">
      <EvidenceGradeBadge grade={guide.evidenceGrade} t={t} />
      <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
        {gradeCopy(guide.evidenceGrade, t).meaning}
      </span>
    </div>
    <dl className="flex flex-col gap-2">
      <Row label={t.channels}>{channelsLabel(guide.engines, t, isKo)}</Row>
      <Row label={t.effort}>{effortLabel(guide.effortHours, t)}</Row>
      <Row label={t.lag}>{guide.effectLag}</Row>
      <Row label={t.metric}>{guide.remeasureMetric}</Row>
      <Row label={t.failCondition}>{guide.failCondition}</Row>
    </dl>
    <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs leading-relaxed">
      {t.disclaimer}
    </p>
    {guide.quotes && guide.quotes.length > 0 && (
      <div className="flex flex-col gap-2">
        <p className="font-medium text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
          {t.quotesTitle}
        </p>
        {guide.quotes.map((q) => (
          <blockquote
            className="border-white/15 border-l-2 pl-3 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed"
            key={`${q.engineId}:${q.excerpt.slice(0, 24)}`}
          >
            <span className="font-medium text-[color:var(--findable-ink-muted,#d0d6e0)]">
              {engineDisplayName(q.engineId, isKo)}
            </span>{" "}
            {q.excerpt}
          </blockquote>
        ))}
      </div>
    )}
    <SourceLinks sources={guide.sources} t={t} />
  </div>
);

const SourceLinks = ({
  sources,
  t,
}: {
  sources: ActionGuide["sources"];
  t: ActionEvidenceLabels;
}) => (
  <ul className="flex flex-col gap-1">
    {sources.map((s) => (
      <li className="text-xs" key={s.url}>
        <a
          className="text-[color:var(--findable-ink-subtle,#8a8f98)] underline underline-offset-2 hover:text-[color:var(--findable-ink,#f7f8f8)]"
          href={s.url}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t.source.replace("{label}", s.label)}
        </a>
      </li>
    ))}
  </ul>
);

/** 「하지 마세요」 — 항목마다 이유와 출처. 등급은 항상 '근거 없음'. */
export const DontList = ({
  donts,
  t,
}: {
  donts: DontItem[];
  t: ActionEvidenceLabels;
}) => (
  <ul className="flex flex-col gap-3">
    {donts.map((d) => (
      <li
        className="flex flex-col gap-1.5 rounded border border-white/6 bg-white/[0.02] p-3"
        key={d.title}
      >
        <div className="flex flex-wrap items-center gap-2">
          <EvidenceGradeBadge grade={d.evidenceGrade} t={t} />
          <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
            {d.title}
          </span>
        </div>
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
          {d.reason}
        </p>
        <SourceLinks sources={d.sources} t={t} />
      </li>
    ))}
  </ul>
);
