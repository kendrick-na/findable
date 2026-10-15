import Link from "next/link";
import type { AppDictionary } from "@/lib/i18n";
import type {
  EngineSourceLine,
  SiteSummary,
  TodayDelta,
  TodayFirst,
} from "../lib/today-view";

// ──────────────────────────────────────────────────
// 「오늘」 화면 (2026-10-15 — 설계안 `설계안_애플식_단순구조_고객앱`, 0단계)
//
// 한 질문에 답한다: "AI 답변에 우리가 나오나, 그래서 먼저 뭘 보면 되나."
//   · 주인공 1개(비율) + 먼저 볼 것 1개. 나머지는 접는다(HIG Progressive Disclosure).
//   · 숫자는 기존 대시보드가 계산한 값을 그대로 받는다(여기서 새로 계산하지 않는다).
//   · 판정 문구("낮은 편")를 쓰지 않는다 — 기준선을 지어내게 된다. 사실만 말한다.
//   · 문구는 전부 사전(`app.today`) — 한글 리터럴 금지(hangul-literal-ratchet).
// ⚠️ 이 화면은 파일럿 조직(`isTodayViewEnabled`)에만 보인다. 꺼져 있으면 기존 대시보드 그대로.
// ──────────────────────────────────────────────────

interface TodayViewProps {
  basis: { engines: number | null; prompts: number; runs: number };
  brandId: string | null;
  brandName: string | null;
  conditions: EngineSourceLine[];
  coverage: { mentioned: number; total: number } | null;
  delta: TodayDelta;
  first: TodayFirst;
  oldViewHref: string;
  site: SiteSummary | null;
  sov: number;
  t: AppDictionary["today"];
  warnMissingSources: boolean;
}

function fill(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template
  );
}

function deltaText(delta: TodayDelta, t: AppDictionary["today"]) {
  switch (delta.kind) {
    case "up":
      return fill(t.deltaUp, { points: delta.points ?? 0 });
    case "down":
      return fill(t.deltaDown, { points: delta.points ?? 0 });
    case "flat":
      return t.deltaFlat;
    case "blocked":
      return t.deltaBlocked;
    default:
      return t.deltaNone;
  }
}

const muted = "text-[color:var(--findable-ink-subtle,#8a8f98)]";
const strong = "text-[color:var(--findable-ink,#f7f8f8)]";

export const TodayView = ({
  basis,
  brandId,
  brandName,
  conditions,
  coverage,
  delta,
  first,
  oldViewHref,
  site,
  sov,
  t,
  warnMissingSources,
}: TodayViewProps) => {
  const brandQuery = brandId ? `?brand=${brandId}` : "";
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <section className="findable-card flex flex-col gap-3 p-6">
        <h1 className={`font-medium text-base ${muted}`}>
          {brandName
            ? fill(t.question, { brand: brandName })
            : t.questionNoBrand}
        </h1>
        <p className={`font-semibold text-6xl tracking-tight ${strong}`}>
          {sov}%
        </p>
        <p className={`text-sm ${strong}`}>{t.heroValueNote}</p>
        <ul className={`flex flex-col gap-1 text-sm ${muted}`}>
          {coverage ? (
            <li>
              {fill(t.engines, {
                mentioned: coverage.mentioned,
                total: coverage.total,
              })}
            </li>
          ) : null}
          <li>{deltaText(delta, t)}</li>
          <li>
            {fill(t.basis, {
              prompts: basis.prompts,
              engines: basis.engines ?? "-",
              runs: basis.runs,
            })}
          </li>
        </ul>
        {basis.runs <= 1 ? (
          <p className={`text-xs ${muted}`}>{t.singleRunNote}</p>
        ) : null}
      </section>

      {first ? (
        <section className="findable-card flex flex-col gap-3 border-[color:var(--findable-primary,#ff7a4d)] p-6">
          <h2 className="font-semibold text-[color:var(--findable-primary,#ff7a4d)] text-xs">
            {t.firstTitle}
          </h2>
          <p className={`text-base ${strong}`}>
            {first.kind === "weak"
              ? fill(t.firstBody, {
                  prompt: first.prompt,
                  hit: first.hit,
                  total: first.total,
                })
              : t.firstAllHit}
          </p>
          <div>
            <Link
              className="findable-btn-primary inline-flex items-center rounded-md px-4 py-2 font-medium text-sm"
              href={`/actions${brandQuery}`}
            >
              {t.firstCta}
            </Link>
          </div>
        </section>
      ) : null}

      <details className="findable-card p-4">
        <summary className={`cursor-pointer font-medium text-sm ${strong}`}>
          {t.conditionsTitle}
        </summary>
        <ul className={`mt-3 flex flex-col gap-1 text-sm ${muted}`}>
          {conditions.map((line) => (
            <li key={line.engine}>
              {fill(t.conditionsLine, {
                engine: line.engine,
                answers: line.answers,
                withSources: line.withSources,
              })}
            </li>
          ))}
        </ul>
        {warnMissingSources ? (
          <p className={`mt-3 text-xs ${muted}`}>{t.conditionsNote}</p>
        ) : null}
      </details>

      <details className="findable-card p-4">
        <summary className={`cursor-pointer font-medium text-sm ${strong}`}>
          {t.siteTitle}
        </summary>
        <p className={`mt-3 text-sm ${muted}`}>
          {site
            ? fill(t.siteSummary, {
                total: site.total,
                fail: site.fail,
                warning: site.warning,
              })
            : t.siteNone}
        </p>
        {site && site.newIssues !== null ? (
          <p className={`mt-1 text-sm ${muted}`}>
            {site.newIssues > 0
              ? fill(t.siteNew, { count: site.newIssues })
              : t.siteNoNew}
          </p>
        ) : null}
        <Link
          className="mt-2 inline-block text-[color:var(--findable-primary,#ff7a4d)] text-sm"
          href="/site-audit"
        >
          {t.siteCta}
        </Link>
      </details>

      <details className="findable-card p-4">
        <summary className={`cursor-pointer font-medium text-sm ${strong}`}>
          {t.moreTitle}
        </summary>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          <li>
            <Link className="underline" href={`/actions${brandQuery}`}>
              {t.linkActions}
            </Link>
          </li>
          <li>
            <Link className="underline" href="/compare">
              {t.linkCompare}
            </Link>
          </li>
          <li>
            <Link className="underline" href="/sources">
              {t.linkSources}
            </Link>
          </li>
          <li>
            <Link className="underline" href="/history">
              {t.linkHistory}
            </Link>
          </li>
        </ul>
      </details>

      <p className="text-center text-xs">
        <Link className={`underline ${muted}`} href={oldViewHref}>
          {t.oldView}
        </Link>
      </p>
    </div>
  );
};
