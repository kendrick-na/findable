/**
 * "아직 migration 이 적용되지 않은 테이블" 오류 판정 — 2026-10-05.
 *
 * 배포가 migration 보다 먼저 나가는 경우(deploy-before-migrate)에 새 테이블을 쓰는 기능이
 * 기존 기능을 깨지 않고 스스로 물러나게 하는 데 쓴다. Prisma 는 P2021 을 주고, 드라이버
 * 어댑터 경로에 따라서는 Postgres 원문(42P01 "relation ... does not exist")만 올 수 있다.
 * `lib/billing/payment-refund-record.ts` 의 판정과 같은 규칙을 테이블 이름별로 일반화한 것이다.
 */

const MISSING_RELATION_RE = /does not exist|42P01|42704/;

function errorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const { code } = error as { code: unknown };
    return typeof code === "string" ? code : null;
  }
  return null;
}

export function isMissingTableErrorFor(
  error: unknown,
  tableName: string
): boolean {
  if (errorCode(error) === "P2021") {
    return true;
  }
  const message = error instanceof Error ? error.message : "";
  return message.includes(tableName) && MISSING_RELATION_RE.test(message);
}
