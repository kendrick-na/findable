/**
 * 공공데이터 파일(CSV) 읽기 — 새 의존성 없이.
 *
 * 실측(2026-10-07):
 *  - data.go.kr 벤처기업명단: UTF-8 + BOM
 *  - 이노비즈·메인비즈·국민연금 월별 파일·공정위 통신판매 파일: CP949(EUC-KR)
 *  - 따옴표 안의 쉼표("계량시스템 및 전자저울, 자동화장비")·줄바꿈이 있다 → RFC 4180 방식으로 파싱.
 */

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const BOM_RE = /^\uFEFF/;
const NEWLINE_RE = /\r?\n/;

/** 바이트 → 문자열. BOM 이 있거나 UTF-8 로 깨끗이 읽히면 UTF-8, 아니면 CP949. */
export function decodeCsvBytes(bytes: Uint8Array): string {
  if (UTF8_BOM.every((b, i) => bytes[i] === b)) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Node(full-icu) 의 TextDecoder 는 euc-kr 라벨로 CP949 확장 문자까지 읽는다(WHATWG Encoding 표준).
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

/** RFC 4180 CSV → 행 배열. 빈 줄은 건너뛴다. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  const src = text.replace(BOM_RE, "");
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      const [value, next] = readQuoted(src, i + 1);
      field += value;
      i = next;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (ch === "\n" || ch === "\r") {
      row.push(field);
      field = "";
      pushNonEmpty(rows, row);
      row = [];
      i += ch === "\r" && src[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  row.push(field);
  pushNonEmpty(rows, row);
  return rows;
}

/** 따옴표 필드 하나 — start 는 여는 따옴표 다음. [값, 닫는 따옴표 다음 위치]. "" 는 " 하나. */
function readQuoted(src: string, start: number): [string, number] {
  let value = "";
  let i = start;
  while (i < src.length) {
    const close = src.indexOf('"', i);
    if (close === -1) {
      return [value + src.slice(i), src.length];
    }
    value += src.slice(i, close);
    if (src[close + 1] !== '"') {
      return [value, close + 1];
    }
    value += '"';
    i = close + 2;
  }
  return [value, i];
}

function pushNonEmpty(rows: string[][], row: string[]): void {
  if (row.some((cell) => cell.trim() !== "")) {
    rows.push(row);
  }
}

/** 헤더 행 기준 레코드. 헤더 이름은 공백을 접어서 비교한다. */
export function csvRecords(text: string): Record<string, string>[] {
  const [header, ...body] = parseCsv(text);
  if (!header) {
    return [];
  }
  const keys = header.map((h) => h.trim().replaceAll(/\s+/g, " "));
  return body.map((cells) => {
    const record: Record<string, string> = {};
    keys.forEach((key, i) => {
      record[key] = (cells[i] ?? "").trim();
    });
    return record;
  });
}

/** 여러 후보 헤더 중 처음 있는 값. "null"·"N/A"·"-" 는 빈 값으로 본다. */
export function pick(
  record: Record<string, string>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined) {
      continue;
    }
    const v = value.trim();
    if (v && !["null", "NULL", "N/A", "-"].includes(v)) {
      return v;
    }
    return null;
  }
  return null;
}

/** 헤더에 이 열들이 모두 있나 — 파일 종류 판별용 */
export function hasColumns(text: string, columns: string[]): boolean {
  const firstLine = text.replace(BOM_RE, "").split(NEWLINE_RE, 1)[0] ?? "";
  const header = parseCsv(firstLine)[0]?.map((h) => h.trim()) ?? [];
  return columns.every((c) => header.includes(c));
}
