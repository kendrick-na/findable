import type { PromptScore } from "../lib/dashboard-data";

// 🔴 `export`(세션N-39): 스토리(`satisfies Meta<typeof …>`)가 이 타입을 이름으로
//   참조해야 해서 공개한다 — 안 하면 **TS4023**. N-38 이 같은 자리에서 겪었다.
export interface PromptScoreboardProps {
  scores: PromptScore[];
}

/**
 * "밀리는 질문" — 질문별로 어디서 이기고 어디서 지는지 (2026-08-07 세션N-9).
 *
 * 📕 리서치 `01:130-132` (Peec AI, **VERIFIED**):
 *   "active prompts view shows position, sentiment, and visibility % per prompt …
 *   so you can see at a glance **where you're winning and where you're not**"
 *   → "이게 밀리는 질문 리스트다. **업계 1군은 이걸 메인에 둔다**."
 *   경쟁사 채택률 **8/15** 인데 우리에겐 없었다 = 벤치마크 최대 공백.
 *
 * 왜 유료가 아니라 무료에도 보이나: 이건 "시간·비교·알림"(유료 축)이 아니라
 *   **이번 측정 결과를 쪼개 보여주는 것**이다. 히어로 3장이 "전체 평균"을 말하고
 *   이 표가 "그 평균이 어디서 왔는지"를 말한다 — 같은 1회 측정의 분해다.
 *
 * 표시 규율:
 *   · 약한 질문이 **위**로 온다(정렬은 집계 쪽 foldPromptScores). 리서치가 요구한 건
 *     "어디서 지고 있나"이므로 잘한 것부터 보여주면 목적이 뒤집힌다.
 *   · 못한 질문에 **빨강을 쓰지 않는다**(§9-2 GSC 안티패닉). 막대 길이와 숫자로만 말한다.
 *   · 순위가 없는 질문은 `—`. 0으로 깔면 "1등"이라는 정반대 신호가 된다.
 */
export const PromptScoreboard = ({ scores }: PromptScoreboardProps) => {
  // 🔴 0건 상태(v4 §4-b 탭2 — *"현재 `null` 반환 → 빈 상태 신설 필요"*, 세션N-39).
  //   `return null` 이면 섹션이 **통째로 사라진다**. 그러면 사용자는
  //   *"내 질문 성적표가 원래 없는 기능인가?"* 로 읽는다 —
  //   `sentiment-section.tsx:133` 이 같은 이유로 이미 0건 화면을 둔다(같은 규율).
  //
  // 🔬 **언제 나는가**(실측 2026-08-17, 진짜 DB 239행):
  //   지금은 **7/7 브랜드가 질문을 갖고 있어 발생 0건**이다(버려지는 행도 0).
  //   그런데 이 표는 **최신 측정 1회분만** 보는데(`dashboard-data.ts:661`),
  //   그 회차에 `prompt.text` 가 없으면 `foldPromptScores` 가 **전부 버린다**(:451).
  //   = N-36 이 겪은 **「측정 성공·화면 정상·데이터만 증발」** 과 같은 형상이다.
  //   그때는 섹션이 조용히 사라져 **3주 동안 아무도 못 봤다.**
  //   → 0건이어도 **자리를 지키고 이유를 말한다.** 그게 다음 사고를 빨리 드러낸다.
  //
  // ⚠️ 여기서 "측정을 해보세요" 라고 하지 않는다 — 이 카드가 보이는 시점엔
  //   이미 측정이 있다(`hasData` 분기 안). 원인은 **질문이 안 붙은 것**이다.
  if (scores.length === 0) {
    return (
      <section className="findable-card flex flex-col gap-2 p-6">
        {/* 🔴 제목·크기를 **데이터 있을 때와 똑같이** 맞춘다(아래 :61 과 동일).
            스크린샷으로 잡은 실수: 처음엔 「밀리는 질문」 `text-base` 로 썼는데
            실제 화면은 「질문별 성적」 `text-lg` 다 → **같은 섹션이 상태에 따라
            다른 이름으로 불리게 된다**(NN/g 4 일관성 위반). */}
        <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg">
          질문별 성적
        </h2>
        <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-sm leading-relaxed">
          이번 측정에는 질문별로 나눠 볼 기록이 없어요. 질문을 등록하고 다시
          측정하면 어느 질문에서 밀리는지 여기에 나와요.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg">
          질문별 성적
        </h2>
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
          같은 브랜드라도 질문에 따라 AI 답변에 나오기도 하고 빠지기도 해요.
          약한 질문이 위에 있어요.
        </p>
      </div>

      <div className="findable-card flex flex-col divide-y divide-[color:var(--findable-hairline,#23252a)]">
        {scores.map((score) => {
          const rate = Math.round((score.hit / score.total) * 100);
          return (
            <div
              className="flex min-w-0 flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4"
              key={score.text}
            >
              <p className="min-w-0 flex-1 text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm">
                {score.text}
              </p>

              <div className="flex shrink-0 items-center gap-3">
                {/* 등장률 막대 — 숫자만으로는 질문 간 비교가 눈에 안 들어온다. */}
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[color:var(--findable-surface-2,#141516)]">
                  <div
                    className="h-full rounded-full bg-[color:var(--findable-primary,#ff7a4d)]"
                    style={{ width: `${rate}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right text-[color:var(--findable-ink,#f7f8f8)] text-sm tabular-nums">
                  {score.hit}/{score.total}곳
                </span>
                <span className="w-16 shrink-0 text-right text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm tabular-nums">
                  {score.position === null ? "—" : `${score.position}번째`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
