/**
 * 영업 발굴(회사 찾기) 화면·액션의 안전장치 — 2026-10-07.
 *
 * 두 겹:
 *  ① env `SALES_DISCOVERY_ENABLED` — 기본 꺼짐. "true" 또는 "1" 일 때만 켠다.
 *  ② 테이블 존재 확인 — migration 20261007_sales_discovery 적용 전 DB 에서는 Prisma 가
 *     P2021(테이블 없음)을 던진다. 그걸 잡아 「DB 준비 전」 상태로 돌려준다(500 대신 빈 화면).
 *
 * 이 파일은 DB·서버 모듈을 import 하지 않는다(테스트·클라이언트 경계 모두 안전).
 */

export type DiscoveryState = "disabled" | "db_not_ready" | "ready";

const ENABLED_VALUES = new Set(["true", "1"]);
const MISSING_TABLE_RE =
  /relation "[^"]*" does not exist|table `[^`]*` does not exist/i;

export function salesDiscoveryEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return ENABLED_VALUES.has(
    (env.SALES_DISCOVERY_ENABLED ?? "").trim().toLowerCase()
  );
}

/** Prisma 「테이블/뷰 없음」 — P2021. 어댑터 경유 원문 오류(42P01 relation does not exist)도 같이 본다. */
export function isMissingTableError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (code === "P2021" || code === "42P01") {
    return true;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && MISSING_TABLE_RE.test(message);
}

export type Guarded<T> =
  | { state: "disabled" }
  | { state: "db_not_ready" }
  | { state: "ready"; value: T };

/**
 * 플래그 → 실행 → 테이블 없음 오류만 「DB 준비 전」으로 바꾼다. 다른 오류는 그대로 던진다
 * (진짜 장애를 빈 화면으로 숨기지 않기 위해).
 */
export async function withDiscovery<T>(
  run: () => Promise<T>,
  env: Record<string, string | undefined> = process.env
): Promise<Guarded<T>> {
  if (!salesDiscoveryEnabled(env)) {
    return { state: "disabled" };
  }
  try {
    return { state: "ready", value: await run() };
  } catch (error) {
    if (isMissingTableError(error)) {
      return { state: "db_not_ready" };
    }
    throw error;
  }
}
