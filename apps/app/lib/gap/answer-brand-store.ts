import { database } from "@repo/database";
import type { AnswerRow } from "./gap-analysis";

/**
 * AnswerBrand 캐시(2026-10-15) — 답변 1개에서 AI 가 나열한 브랜드 이름. raw SQL 로만 읽고 쓴다(Prisma 스키마 불변).
 * 테이블이 아직 없으면(SQL 미적용) null/false 를 돌려줘 분석만 '준비 중'이 되고 나머지는 영향이 없다.
 * 측정 결과(AuditJob.result)는 원본이라 건드리지 않는다 — 파생 계산은 여기에만 둔다.
 */
const MISSING_TABLE =
  /relation .*AnswerBrand.* does not exist|AnswerBrand.*does not exist/i;
const isMissingTable = (e: unknown) =>
  e instanceof Error && MISSING_TABLE.test(e.message);

export async function loadAnswerBrands(
  auditJobId: string
): Promise<Map<string, string[]> | null> {
  try {
    const rows = (await database.$queryRaw<
      Array<{ brands: unknown; engineId: string; promptIndex: number }>
    >`SELECT "promptIndex","engineId","brands" FROM "AnswerBrand" WHERE "auditJobId" = ${auditJobId}`) as Array<{
      brands: unknown;
      engineId: string;
      promptIndex: number;
    }>;
    const out = new Map<string, string[]>();
    for (const r of rows) {
      out.set(
        `${r.promptIndex}|${r.engineId}`,
        Array.isArray(r.brands)
          ? r.brands.filter((b): b is string => typeof b === "string")
          : []
      );
    }
    return out;
  } catch (error) {
    if (isMissingTable(error)) {
      return null;
    }
    throw error;
  }
}

export async function saveAnswerBrands(
  auditJobId: string,
  entries: ReadonlyArray<{
    brands: string[];
    engineId: string;
    promptIndex: number;
  }>
): Promise<boolean> {
  if (entries.length === 0) {
    return true;
  }
  try {
    await database.$executeRaw`
      INSERT INTO "AnswerBrand" ("auditJobId","promptIndex","engineId","brands")
      SELECT ${auditJobId}, t.idx, t.eng, t.br::jsonb
      FROM unnest(${entries.map((e) => e.promptIndex)}::int[], ${entries.map((e) => e.engineId)}::text[], ${entries.map((e) => JSON.stringify(e.brands))}::text[]) AS t(idx, eng, br)
      ON CONFLICT ("auditJobId","promptIndex","engineId") DO NOTHING`;
    return true;
  } catch (error) {
    if (isMissingTable(error)) {
      return false;
    }
    throw error;
  }
}

export const MAX_ANALYZE_ANSWERS = 60;
const CONCURRENCY = 6;

/** 아직 추출하지 않은 답변만 AI 로 추출한다(상한 60개 · 동시 6개). 실패한 답변은 저장하지 않고 다음에 다시 시도한다. */
export async function extractMissing(
  rows: readonly AnswerRow[],
  existing: ReadonlyMap<string, readonly string[]>,
  extract: (answer: string) => Promise<string[] | null>
): Promise<Array<{ brands: string[]; engineId: string; promptIndex: number }>> {
  const todo = rows
    .filter((r) => !existing.has(r.key))
    .slice(0, MAX_ANALYZE_ANSWERS);
  const out: Array<{
    brands: string[];
    engineId: string;
    promptIndex: number;
  }> = [];
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const row = todo[next++] as AnswerRow;
      const brands = await extract(row.excerpt).catch(() => null);
      if (brands) {
        out.push({
          promptIndex: row.promptIndex,
          engineId: row.engineId,
          brands,
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker)
  );
  return out;
}
