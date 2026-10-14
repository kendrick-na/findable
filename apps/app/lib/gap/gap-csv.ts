import type { GapAnalysis } from "./gap-analysis";

/** 빈틈 분석 CSV 본문 만들기(순수). 수식 인젝션·따옴표 처리는 기존 내보내기와 같은 규칙. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const NEEDS_QUOTING = /[",\n\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const raw = String(value);
  const safe = FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  return NEEDS_QUOTING.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export interface GapCsvLabels {
  boardTitle: string;
  csvCount: string;
  csvDetail: string;
  csvName: string;
  csvSection: string;
  csvType: string;
  questionsTitle: string;
  sourcesTitle: string;
  [key: string]: string;
}

export function gapCsv(data: GapAnalysis, t: GapCsvLabels): string {
  const lines: unknown[][] = [
    [t.csvSection, t.csvName, t.csvCount, t.csvType, t.csvDetail],
  ];
  for (const b of data.brandBoard) {
    lines.push([t.boardTitle, b.name, b.answers, "", ""]);
  }
  for (const q of data.questionGaps) {
    lines.push([
      t.questionsTitle,
      q.promptText,
      q.competitors.reduce((s, c) => s + c.answers, 0),
      "",
      q.competitors.map((c) => c.name).join(" | "),
    ]);
  }
  for (const s of data.sourceGaps) {
    lines.push([
      t.sourcesTitle,
      s.domain,
      s.absentAnswers,
      t[`type_${s.type}`] ?? s.type,
      s.competitors.join(" | "),
    ]);
  }
  return lines.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
