import { database } from "@repo/database";
import {
  EMPTY_FACT_SHEET,
  type FactSheetData,
  normalizeFactSheet,
} from "./fact-sheet";

/**
 * BrandFactSheet 저장소(2026-10-16) — raw SQL 로만 읽고 쓴다(Prisma 스키마 불변).
 * 테이블이 아직 없으면(SQL 미적용) `available: false` 를 돌려줘 카드만 '준비 중'이 된다.
 */
const MISSING_TABLE =
  /BrandFactSheet.*does not exist|does not exist.*BrandFactSheet/i;
const isMissingTable = (e: unknown) =>
  e instanceof Error && MISSING_TABLE.test(e.message);

export type FactSheetLoad =
  | { available: true; sheet: FactSheetData; updatedAt: Date | null }
  | { available: false };

export async function loadFactSheet(brandId: string): Promise<FactSheetLoad> {
  try {
    const rows = await database.$queryRaw<
      Array<{ data: unknown; updatedAt: Date }>
    >`SELECT "data","updatedAt" FROM "BrandFactSheet" WHERE "brandId" = ${brandId}`;
    const row = rows[0];
    return {
      available: true,
      sheet: row ? normalizeFactSheet(row.data) : EMPTY_FACT_SHEET,
      updatedAt: row?.updatedAt ?? null,
    };
  } catch (error) {
    if (isMissingTable(error)) {
      return { available: false };
    }
    throw error;
  }
}

/** 저장 성공 여부. 테이블이 없으면 false. 호출부가 org 소유 검증을 먼저 마쳐야 한다. */
export async function saveFactSheet(
  brandId: string,
  input: unknown
): Promise<boolean> {
  const data = JSON.stringify(normalizeFactSheet(input));
  try {
    await database.$executeRaw`
      INSERT INTO "BrandFactSheet" ("brandId","data","updatedAt")
      VALUES (${brandId}, ${data}::jsonb, now())
      ON CONFLICT ("brandId") DO UPDATE SET "data" = EXCLUDED."data", "updatedAt" = now()`;
    return true;
  } catch (error) {
    if (isMissingTable(error)) {
      return false;
    }
    throw error;
  }
}
