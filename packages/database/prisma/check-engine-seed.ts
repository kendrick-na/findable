// 사용: DATABASE_URL 을 대상 DB로 둔 채 `pnpm --filter @repo/database check:engine-seed`
//   읽기 전용(READ ONLY 트랜잭션). 누락된 Engine id만 출력하고 누락 시 exit 1.
//   ⚠️ 운영 DB에 돌리는 것은 W0-0 대상 attestation 이후 권한자만 한다.

import { resolveEnvSpec, safeErrorLabel } from "./db-target-fingerprint";
import { ENGINE_SEED } from "./engine-seed-data";
import { readEngineSeedState } from "./engine-seed-gate";

async function main(): Promise<void> {
  // Prefer `<env-file>#VAR[??VAR]` so operators never `source` a production env file.
  const spec = process.argv[2];
  const connectionString = spec
    ? resolveEnvSpec(spec)
    : process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("connection not set (env spec or DATABASE_URL)");
  }
  const verdict = await readEngineSeedState(
    connectionString,
    ENGINE_SEED.map((e) => e.id)
  );
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  if (!verdict.ok) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `[check-engine-seed] failed: ${safeErrorLabel(error)}\n`
  );
  process.exitCode = 2;
});
