// 사용(배포 전, 권한자만): 대상 DB 연결을 DATABASE_URL 로 둔 채
//   `pnpm --filter @repo/database check:privacy-tables`
//   또는 env 파일을 source 하지 않고: `... check:privacy-tables <env-file>#DATABASE_URL`
// 읽기 전용. 표 이름만 출력. 필수 표가 없으면 exit 1 → **배포 중단**(먼저 마이그레이션 적용).
// 체크리스트: docs/_적용/개인정보_삭제범위_20261020.md 「운영 반영 순서」.

import {
  resolveEnvSpec,
  safeErrorLabel,
} from "../prisma/db-target-fingerprint";
import { readPrivacyTables } from "./privacy-table-gate";

async function main(): Promise<void> {
  const spec = process.argv[2];
  const connectionString = spec
    ? resolveEnvSpec(spec)
    : process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("connection not set (env spec or DATABASE_URL)");
  }
  const verdict = await readPrivacyTables(connectionString);
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  if (!verdict.ok) {
    process.stderr.write(
      "[check-privacy-tables] 필수 표 없음 → 배포 중단. 마이그레이션을 먼저 적용하세요.\n"
    );
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `[check-privacy-tables] failed: ${safeErrorLabel(error)}\n`
  );
  process.exitCode = 2;
});
