// 감성 섹션 — 「좋게 말하나?」 카드의 목적지 (2026-08-16 세션N-34 · G-2).
//
// 🔴 **왜 여기(「지금 할 일」)인가 — 경쟁사 4곳 실측**
//   감성만을 위한 독립 화면을 만든 곳은 **0곳**이다:
//     Peec      `Visibility 72% · Sentiment · Position 3.6` — 3대 지표를 한 줄에
//     Profound  `Visibility · Prompts · Sentiment · Citations` — 탭 하나
//     Otterly   `Brand Presence & Sentiment` — 등장률과 한 덩어리
//     Scrunch   `Positive Sentiment 68%` — 개요 타일 하나
//   → 우리 히어로 3장 구조는 이미 업계 표준과 같다. 틀린 건 **카드가 아니라 링크**였다.
//
// 🔴 **고친 결함**: 「좋게 말하나?」 카드가 `/sources` 로 갔는데
//   그 화면엔 **감성이 한 줄도 없다**(`grep sentiment` → 0건). 무료로 보여준 숫자를
//   눌렀더니 **딴 주제(출처 링크)의 결제 벽**이 떴다 = 약속을 배신하는 링크.
//
// ⭐ **중립이 주인공이다** (실측 · 브랜드 3개 전량):
//     나이키 긍5·중28 · sulwhasoo 긍2·중12 · 엔비디아 긍2·중15 → **85% 이상이 중립**
//   AI 답변에서 중립은 *"나쁘지 않다"* 가 아니라 **"밋밋해서 안 골라진다"** 이고
//   그게 곧 개선 대상이다(web `sentimentHint` 가 S7-4차에 정한 해석과 같은 방향).
//   Peec 도 감성을 *"what's going well, and **what requires improvements**"* 로 설명한다.
//
// ⚠️ **부정 0건을 성과로 팔지 않는다.** 분류기가 키워드 휴리스틱이라 부정을 거의 못 잡는다
//   (전 데이터셋 negative 0건). "부정 없음 = 좋음" 으로 읽히게 두면 **못 잰 걸 좋은 소식으로
//   파는 것**이다 — 이 저장소가 반복해 온 "못 잰 것을 0점이라 부르기"와 같은 잘못.

import type { SentimentSummary } from "../../lib/dashboard-data";

/** 질문·엔진 단위 감성 분해 한 줄. */
export interface SentimentBreakdownRow {
  /** 표시 이름(질문 원문 또는 엔진 라벨). */
  label: string;
  summary: SentimentSummary;
}

/**
 * 🔴 `export`(세션N-38): Storybook 스토리가 `Meta<typeof SentimentSection>` 를 쓰려면
 *   이 타입에 이름이 닿아야 한다(미export 시 TS4023 — 스토리 파일이 타입체크에서 깨진다).
 */
export interface Props {
  /** 엔진별 분해. */
  byEngine: SentimentBreakdownRow[];
  /** 질문별 분해. 쿼리 변경 0 — 호출부가 이미 들고 있는 행을 접어서 넘긴다. */
  byPrompt: SentimentBreakdownRow[];
  summary: SentimentSummary | null;
}

const pct = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 100) : 0;

/**
 * 감성 분포 막대. 긍정·중립·부정을 **비중 그대로** 그린다.
 * 색 규율(§9): 긍정=단청 · 중립=hairline-strong · 부정=danger.
 */
const DistributionBar = ({ summary }: { summary: SentimentSummary }) => {
  const segments = [
    {
      key: "positive",
      value: summary.positive,
      color: "var(--findable-dancheong, oklch(0.58 0.110 195))",
    },
    {
      key: "neutral",
      value: summary.neutral,
      color: "var(--findable-hairline-strong, #3a3d42)",
    },
    {
      key: "negative",
      value: summary.negative,
      color: "var(--findable-danger, #e5484d)",
    },
  ].filter((s) => s.value > 0);

  return (
    <div
      aria-label={`긍정 ${summary.positive}, 보통 ${summary.neutral}, 부정 ${summary.negative} (총 ${summary.total}건)`}
      className="flex h-2 w-full overflow-hidden rounded-full bg-[color:var(--findable-hairline,#2a2d31)]"
      role="img"
    >
      {segments.map((s) => (
        <div
          key={s.key}
          style={{
            width: `${pct(s.value, summary.total)}%`,
            backgroundColor: s.color,
          }}
        />
      ))}
    </div>
  );
};

/** 분해 목록(질문별·엔진별). 행이 없으면 통째로 그리지 않는다. */
const BreakdownList = ({
  rows,
  title,
}: {
  rows: SentimentBreakdownRow[];
  title: string;
}) => {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-medium text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
        {title}
      </h3>
      {/* 🔴 PC(1440)에서 눈확인으로 잡은 것: 라벨과 건수가 화면 양 끝으로 갈라져
          **어느 숫자가 어느 줄 것인지 눈이 못 잇는다**(모바일에선 폭이 좁아 안 보였다).
          → 읽는 폭을 제한한다. 표는 넓힐수록 읽기 나빠진다. */}
      <ul className="flex max-w-3xl flex-col gap-3">
        {rows.map((r) => (
          <li className="flex flex-col gap-1.5" key={r.label}>
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              {/* 한국어 질문은 길다 → 자르지 않고 줄바꿈을 허용한다(맥락이 사라지면 의미 없음). */}
              <span className="min-w-0 text-[color:var(--findable-ink,#f7f8f8)] text-sm">
                {r.label}
              </span>
              {/* 🔴 분모를 항상 함께 적는다 — 비중만 말하면 1건짜리와 30건짜리가 같아 보인다. */}
              <span className="shrink-0 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs tabular-nums">
                긍정 {r.summary.positive} · 보통 {r.summary.neutral} · 부정{" "}
                {r.summary.negative} · 총 {r.summary.total}
              </span>
            </div>
            <DistributionBar summary={r.summary} />
          </li>
        ))}
      </ul>
    </div>
  );
};

export const SentimentSection = ({ summary, byPrompt, byEngine }: Props) => {
  // 🔴 0건 상태 필수 — 미언급 행은 `sentiment=null` 이라 저인지도 브랜드는 대부분 빈다.
  //   "감성 0%" 가 아니라 **"판정할 답변이 없다"** 고 말한다(0과 없음은 다르다).
  if (!summary) {
    return (
      <section className="findable-card flex flex-col gap-2 p-6">
        <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-base">
          AI가 우리를 어떻게 말하나
        </h2>
        <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-sm leading-relaxed">
          아직 판정할 답변이 없어요. AI가 우리를 언급한 답변에서만 어떻게
          말하는지 읽을 수 있어요 — 먼저 등장률을 올리는 게 순서예요.
        </p>
      </section>
    );
  }

  const neutralPct = pct(summary.neutral, summary.total);
  const positivePct = pct(summary.positive, summary.total);

  // ⭐ 중립이 지배적이면 **그게 개선 대상**이라고 말한다(같은 3할 경계 — 새 임계값 발명 금지).
  const neutralDominant = positivePct < 30 && summary.negative === 0;

  return (
    <section className="findable-card flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-base">
          AI가 우리를 어떻게 말하나
        </h2>
        <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-sm">
          우리를 언급한 답변 {summary.total}건을 읽은 결과예요.
        </p>
      </div>

      <div className="flex max-w-3xl flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-2xl text-[color:var(--findable-ink,#f7f8f8)] tabular-nums">
            {neutralPct}%
          </span>
          <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            가 밋밋한 서술
          </span>
        </div>
        <DistributionBar summary={summary} />
        <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs tabular-nums">
          긍정 {summary.positive} · 보통 {summary.neutral} · 부정{" "}
          {summary.negative} · 총 {summary.total}건
        </p>
      </div>

      {/* ⭐ 중립이 왜 문제인지 — 이 섹션의 존재 이유. */}
      {neutralDominant ? (
        <p className="rounded-lg border border-[color:var(--findable-hairline,#2a2d31)] bg-[color:var(--findable-surface-2,rgba(255,255,255,0.02))] px-4 py-3 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
          AI가 우리를 <strong>사실만 건조하게</strong> 말하고 있어요. 틀린 건
          아니지만 <strong>고를 이유를 못 주는 상태</strong>예요. 아래 처방 중
          차별점이 담긴 문장을 늘리는 것부터 손대면 달라져요.
        </p>
      ) : null}

      {/* ⚠️ 부정 0건을 성과로 표기하지 않는다 — 분류기가 못 잡는 것이지 없는 게 아니다. */}
      {summary.negative === 0 ? (
        <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs leading-relaxed">
          * 부정 표현은 키워드로만 찾고 있어서 놓치는 경우가 있어요. 부정 0건을
          &ldquo;문제 없음&rdquo;으로 읽지 마세요.
        </p>
      ) : null}

      <BreakdownList rows={byPrompt} title="질문별" />
      <BreakdownList rows={byEngine} title="AI별" />
    </section>
  );
};
