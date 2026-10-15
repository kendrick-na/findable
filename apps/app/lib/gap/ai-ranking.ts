import type { GapAnalysis } from "./gap-analysis";

export interface AiRankingRow {
  /** 평균 순위는 답변 나열 순서를 따로 저장하지 않아 없다. */
  averageRank?: number;
  mine: boolean;
  name: string;
  shareOfVoice: number;
}

/**
 * 비교 화면 순위표용(2026-10-15): AI 가 답변에서 직접 읽은 브랜드 수로 만든 순위.
 * 비율 = 그 브랜드가 나온 답변 수 / 분석한 답변 수. 우리 브랜드 행을 함께 넣고 많이 나온 순.
 * 우리가 0번 나왔으면 순위표에서 빠진다(기존 '순위권 밖' 표시와 같은 뜻).
 */
export function aiRankingRows(
  data: GapAnalysis,
  ownName: string
): AiRankingRow[] {
  if (data.analyzed === 0) {
    return [];
  }
  const pct = (n: number) => Math.round((n / data.analyzed) * 100);
  const rows: AiRankingRow[] = data.brandBoard.map((b) => ({
    name: b.name,
    shareOfVoice: pct(b.answers),
    mine: false,
  }));
  if (data.ownAnswers > 0) {
    rows.push({
      name: ownName,
      shareOfVoice: pct(data.ownAnswers),
      mine: true,
    });
  }
  return rows.sort(
    (a, b) => b.shareOfVoice - a.shareOfVoice || Number(b.mine) - Number(a.mine)
  );
}
