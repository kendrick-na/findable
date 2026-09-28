import "server-only";

import { createHash } from "node:crypto";
import {
  type ClientReportData,
  parseClientReportData,
} from "@repo/audit/client-report/report-data";
import { log } from "@repo/observability/log";

/** 공유 링크 토큰 = 32바이트 base64url(43자). 형식이 다르면 DB 를 부르지 않고 404. */
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
/** 개발 전용 fixture 이름(`/r/dev?fixture=knowverse`). */
const FIXTURE_RE = /^[a-z0-9-]{1,40}$/;

export interface LoadedClientReport {
  data: ClientReportData;
  pdfUrl: string | null;
  /** DB 행 id. fixture 면 null(열람 기록 안 함). */
  reportId: string | null;
}

export async function loadClientReport(
  token: string,
  fixture: string | undefined
): Promise<LoadedClientReport | null> {
  // 🔴 fixture 는 개발 서버 전용. 프로덕션 빌드에선 이 분기가 통째로 제거된다
  //   (NODE_ENV 가 빌드 때 "production" 으로 박혀 dead code 가 되고, 동적 import 도 사라진다).
  if (process.env.NODE_ENV !== "production" && token === "dev" && fixture) {
    if (!FIXTURE_RE.test(fixture)) {
      return null;
    }
    const { loadClientReportFixture } = await import("./fixture");
    const data = parseClientReportData(await loadClientReportFixture(fixture));
    return data ? { data, reportId: null, pdfUrl: null } : null;
  }

  if (!TOKEN_RE.test(token)) {
    return null;
  }
  // DB 는 여기서만 부른다 — fixture 모드는 DATABASE_URL 없이도 떠야 한다.
  const { database } = await import("@repo/database");
  const row = await database.report.findUnique({
    where: { accessToken: token },
    select: { id: true, data: true, pdfUrl: true },
  });
  if (!row) {
    return null;
  }
  const data = parseClientReportData(row.data);
  if (!data) {
    log.warn("client-report: data 형식 불일치", { reportId: row.id });
    return null;
  }
  return { data, reportId: row.id, pdfUrl: row.pdfUrl };
}

/** 링크 미리보기 봇·크롤러는 열람으로 세지 않는다. */
const BOT_UA =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|kakaotalk-scrap|headless|lighthouse/i;

/**
 * 열람 기록 — 개인정보 없이 (reportId, 시각, user-agent 해시 16자)만 남긴다.
 * 실패해도 페이지는 떠야 하므로 예외를 삼키고 로그만 남긴다.
 */
export async function recordClientReportView(
  reportId: string,
  userAgent: string | null
): Promise<void> {
  if (userAgent && BOT_UA.test(userAgent)) {
    return;
  }
  const uaHash = userAgent
    ? createHash("sha256").update(userAgent).digest("hex").slice(0, 16)
    : null;
  try {
    const { database } = await import("@repo/database");
    await database.reportView.create({ data: { reportId, uaHash } });
  } catch (error) {
    log.warn("client-report: 열람 기록 실패", {
      reportId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
