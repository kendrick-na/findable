// 사용: 대상 DB 연결을 DATABASE_URL 로 둔 채
//   `pnpm --filter @repo/database check:migration-baseline`
//   읽기 전용(READ ONLY 트랜잭션). migration 이름만 출력, 불일치 시 exit 1.
//   ⚠️ migrate CLI 가 실제로 쓰는 연결은 `DATABASE_URL_UNPOOLED ?? DATABASE_URL` 이다
//   (prisma.config.ts). 운영 대조는 W0-0 대상 attestation 이후 권한자만 한다.

import { join } from "node:path";
import { readMigrationBaseline } from "./migration-baseline-gate";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const verdict = await readMigrationBaseline(
    connectionString,
    join(import.meta.dirname, "migrations")
  );
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  if (!verdict.ok) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `[check-migration-baseline] failed: ${error instanceof Error ? error.message : "unknown"}\n`
  );
  process.exitCode = 2;
});
