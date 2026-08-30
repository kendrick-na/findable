import { normalizeDomain } from "@/lib/domain";

export interface NaverSearchDailyRow {
  averagePosition: number | null;
  clicks: number;
  ctr: number | null;
  date: Date;
  impressions: number;
}

const MAX_ROWS = 400;
const BOM_RE = /^\uFEFF/;
const DATE_SEPARATOR_RE = /[./]/g;
const DATE_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;
const LINE_RE = /\r?\n/;
const HEADER_ALIASES = {
  averagePosition: ["평균순위", "평균게재순위", "averageposition", "position"],
  clicks: ["클릭", "클릭수", "clicks"],
  ctr: ["ctr", "클릭률"],
  date: ["날짜", "일자", "date"],
  impressions: ["노출", "노출수", "impressions"],
} as const;

/**
 * IndexNow 요청은 host와 keyLocation이 실제 URL의 호스트와 같아야 한다.
 * 브랜드 저장값은 apex로 정규화되므로, 동일 사이트의 apex와 www를 후보로
 * 인정하되 한 요청에는 하나의 실제 호스트만 사용한다.
 */
export function resolveIndexNowHost(
  brandDomain: string,
  urls: URL[]
): string | null {
  if (urls.length === 0) {
    return null;
  }
  const apex = normalizeDomain(brandDomain);
  if (!apex) {
    return null;
  }
  const allowedHosts = new Set([apex, `www.${apex}`]);
  const requestedHost = urls[0]?.hostname.toLowerCase();
  if (!(requestedHost && allowedHosts.has(requestedHost))) {
    return null;
  }
  return urls.every(
    (url) =>
      url.protocol === "https:" && url.hostname.toLowerCase() === requestedHost
  )
    ? requestedHost
    : null;
}

/**
 * 루트에 `{key}.txt`를 설치한 표준 경로는 keyLocation을 생략한다.
 * 네이버는 동일한 루트 위치를 명시적으로 보낸 POST 요청을 422로 거부할 수 있다.
 */
export function buildIndexNowPayload(host: string, key: string, urls: URL[]) {
  return {
    host,
    key,
    urlList: urls.map(String),
  };
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_%()/-]/g, "");
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

function findColumn(headers: string[], aliases: readonly string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

function integer(value: string, field: string): number {
  const parsed = Number(value.replaceAll(",", ""));
  if (!(Number.isInteger(parsed) && parsed >= 0)) {
    throw new Error(`NAVER_CSV_INVALID_${field.toUpperCase()}`);
  }
  return parsed;
}

function optionalNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value.replaceAll("%", "").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function utcDate(value: string): Date {
  const normalized = value.trim().replace(DATE_SEPARATOR_RE, "-");
  if (!DATE_RE.test(normalized)) {
    throw new Error("NAVER_CSV_INVALID_DATE");
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  const [year, month, day] = normalized.split("-").map(Number);
  if (
    Number.isNaN(date.valueOf()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new Error("NAVER_CSV_INVALID_DATE");
  }
  return date;
}

export async function verifyIndexNowKeyFile(
  host: string,
  key: string
): Promise<boolean> {
  try {
    const response = await fetch(`https://${host}/${key}.txt`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return false;
    }
    return (await response.text()).trim() === key;
  } catch {
    return false;
  }
}

export function parseNaverSearchCsv(csv: string): NaverSearchDailyRow[] {
  const lines = csv.replace(BOM_RE, "").split(LINE_RE).filter(Boolean);
  if (lines.length < 2) {
    throw new Error("NAVER_CSV_EMPTY");
  }
  if (lines.length - 1 > MAX_ROWS) {
    throw new Error("NAVER_CSV_TOO_MANY_ROWS");
  }
  const headers = parseCsvLine(lines[0] ?? "").map(normalizeHeader);
  const dateIndex = findColumn(headers, HEADER_ALIASES.date);
  const clicksIndex = findColumn(headers, HEADER_ALIASES.clicks);
  const impressionsIndex = findColumn(headers, HEADER_ALIASES.impressions);
  const ctrIndex = findColumn(headers, HEADER_ALIASES.ctr);
  const positionIndex = findColumn(headers, HEADER_ALIASES.averagePosition);
  if (dateIndex < 0 || clicksIndex < 0 || impressionsIndex < 0) {
    throw new Error("NAVER_CSV_REQUIRED_COLUMNS");
  }

  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    const clicks = integer(fields[clicksIndex] ?? "", "clicks");
    const impressions = integer(fields[impressionsIndex] ?? "", "impressions");
    const importedCtr =
      ctrIndex < 0 ? null : optionalNumber(fields[ctrIndex] ?? "");
    let ctr = importedCtr;
    if (ctr === null && impressions > 0) {
      ctr = clicks / impressions;
    } else if (ctr !== null && ctr > 1) {
      ctr /= 100;
    }
    return {
      averagePosition:
        positionIndex < 0 ? null : optionalNumber(fields[positionIndex] ?? ""),
      clicks,
      ctr,
      date: utcDate(fields[dateIndex] ?? ""),
      impressions,
    };
  });
}
