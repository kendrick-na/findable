// `_prisma_migrations` baseline 읽기 전용 게이트 (W0-0).
//
// 운영 스키마를 건드리는 배포 전에, 대상 DB가 저장소의 어느 migration을 적용했는지
// **쓰기 없이** 증명한다. 출력은 migration 이름뿐이며 연결 문자열·데이터는 내보내지 않는다.
// checksum = migration.sql 의 sha256 hex (Prisma 7.4.2 `migrate deploy` 일회용 PG 실측 2026-10-04).

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client";

export interface RepoMigration {
  checksum: string;
  name: string;
}

export interface AppliedMigrationRow {
  checksum: string;
  finished_at: Date | null;
  migration_name: string;
  rolled_back_at: Date | null;
}

export interface MigrationBaselineVerdict {
  applied: string[];
  checksumMismatch: string[];
  failed: string[];
  ok: boolean;
  pending: string[];
  rolledBack: string[];
  unknownInDb: string[];
}

export function listRepoMigrations(migrationsDir: string): RepoMigration[] {
  return readdirSync(migrationsDir)
    .filter((name) => statSync(join(migrationsDir, name)).isDirectory())
    .sort()
    .map((name) => ({
      name,
      checksum: createHash("sha256")
        .update(readFileSync(join(migrationsDir, name, "migration.sql")))
        .digest("hex"),
    }));
}

export function evaluateMigrationBaseline(
  repo: readonly RepoMigration[],
  rows: readonly AppliedMigrationRow[]
): MigrationBaselineVerdict {
  const verdict: MigrationBaselineVerdict = {
    ok: false,
    applied: [],
    pending: [],
    unknownInDb: [],
    failed: [],
    rolledBack: [],
    checksumMismatch: [],
  };
  const repoNames = new Set(repo.map((m) => m.name));

  for (const migration of repo) {
    const attempts = rows.filter((r) => r.migration_name === migration.name);
    const live = attempts.filter((r) => r.rolled_back_at === null);
    const finished = live.find((r) => r.finished_at !== null);
    if (finished) {
      if (finished.checksum === migration.checksum) {
        verdict.applied.push(migration.name);
      } else {
        verdict.checksumMismatch.push(migration.name);
      }
    } else if (live.length > 0) {
      verdict.failed.push(migration.name);
    } else {
      verdict.pending.push(migration.name);
      if (attempts.length > 0) {
        verdict.rolledBack.push(migration.name);
      }
    }
  }

  verdict.unknownInDb = [
    ...new Set(
      rows.map((r) => r.migration_name).filter((name) => !repoNames.has(name))
    ),
  ].sort();

  verdict.ok =
    verdict.pending.length === 0 &&
    verdict.unknownInDb.length === 0 &&
    verdict.failed.length === 0 &&
    verdict.rolledBack.length === 0 &&
    verdict.checksumMismatch.length === 0;
  return verdict;
}

export async function readMigrationBaseline(
  connectionString: string,
  migrationsDir: string
): Promise<MigrationBaselineVerdict & { historyTable: "missing" | "present" }> {
  const repo = listRepoMigrations(migrationsDir);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: 1 }),
  });
  try {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const table = await tx.$queryRawUnsafe<{ exists: boolean }[]>(
        `SELECT to_regclass('"_prisma_migrations"') IS NOT NULL AS exists`
      );
      if (!table[0]?.exists) {
        return null;
      }
      return tx.$queryRawUnsafe<AppliedMigrationRow[]>(
        `SELECT migration_name, checksum, finished_at, rolled_back_at
           FROM "_prisma_migrations"`
      );
    });
    if (rows === null) {
      return {
        ...evaluateMigrationBaseline(repo, []),
        historyTable: "missing",
      };
    }
    return {
      ...evaluateMigrationBaseline(repo, rows),
      historyTable: "present",
    };
  } finally {
    await prisma.$disconnect();
  }
}
