import { database } from "@repo/database";

/**
 * 질문 보관(2026-10-14 · 설계원칙 3) — 삭제하지 않고 측정 대상에서만 뺀다. 이력(Tracking)은 그대로 남는다.
 *
 * 🔴 `Prompt.archivedAt` 컬럼은 **raw SQL 로만** 읽고 쓴다(Prisma 스키마는 안 바꾼다).
 *   스키마에 넣으면 생성된 클라이언트가 모든 Prompt 조회에 그 컬럼을 넣어, 운영 DB 에 SQL 이 적용되기 전에
 *   배포되면 **측정 전체가 깨진다**. 컬럼이 아직 없으면 「보관된 질문 없음」으로 읽고, 보관·복원은 정직한 오류를 돌려준다.
 *   (SQL: `packages/database/prisma/migrations/20261014_prompt_archived_at/migration.sql`)
 *
 * 보관된 질문은 러너 선택 · 질문 세트 지문 · 플랜 상한(남은 칸)에서 빠진다 — 각 조회에 `activePromptFilter` 를 건다.
 */

const MISSING_COLUMN = /archivedAt.*does not exist|column.*archivedAt/i;

const isMissingColumn = (error: unknown): boolean =>
  error instanceof Error && MISSING_COLUMN.test(error.message);

/** 이 브랜드들에서 보관된 질문 id. 컬럼이 아직 없으면 빈 배열. 그 밖의 오류는 던진다. */
export async function archivedPromptIds(
  brandIds: readonly string[]
): Promise<string[]> {
  if (brandIds.length === 0) {
    return [];
  }
  try {
    const rows = (await database.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Prompt"
      WHERE "brandId" = ANY(${[...brandIds]}) AND "archivedAt" IS NOT NULL`) as Array<{
      id: string;
    }>;
    return rows.map((row) => row.id);
  } catch (error) {
    if (isMissingColumn(error)) {
      return [];
    }
    throw error;
  }
}

/** Prisma `where` 에 펼쳐 넣는 필터: 보관된 id 를 뺀다. */
export const activePromptFilter = (
  archivedIds: readonly string[]
): { id?: { notIn: string[] } } =>
  archivedIds.length > 0 ? { id: { notIn: [...archivedIds] } } : {};

export type ArchiveResult = { ok: true } | { ok: false; reason: "no_column" };

async function setArchived(
  promptId: string,
  archived: boolean
): Promise<ArchiveResult> {
  try {
    await database.$executeRaw`
      UPDATE "Prompt"
      SET "archivedAt" = ${archived ? new Date() : null}
      WHERE "id" = ${promptId}`;
    return { ok: true };
  } catch (error) {
    if (isMissingColumn(error)) {
      return { ok: false, reason: "no_column" };
    }
    throw error;
  }
}

export const archivePrompt = (promptId: string) => setArchived(promptId, true);
export const restorePrompt = (promptId: string) => setArchived(promptId, false);
