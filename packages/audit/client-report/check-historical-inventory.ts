// 사용(권한자, W0-0 대상 attestation 이후):
//   DATABASE_URL=<대상 runtime 연결> pnpm --filter @repo/audit inventory:reports /tmp/w0/report-inventory.json
//   READ ONLY 트랜잭션. 화면에는 요약 수치만, 고객별 상세(토큰·URL·이메일 제외)는 지정한 파일에만 쓴다.
//   상세 파일도 고객 데이터이므로 결정 기록 후 삭제한다.

import { chmodSync, writeFileSync } from "node:fs";
import { createInspectionClient } from "@repo/database/prisma/read-only-client";
import { readHistoricalReportInventory } from "./historical-inventory";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  const out = process.argv[2];
  if (!(connectionString && out)) {
    throw new Error("usage: DATABASE_URL=... inventory:reports <out.json>");
  }
  const prisma = createInspectionClient(connectionString);
  try {
    const inventory = await readHistoricalReportInventory(prisma);
    writeFileSync(out, `${JSON.stringify(inventory, null, 2)}\n`, {
      mode: 0o600,
    });
    // `mode` applies only on creation; tighten an existing file too.
    chmodSync(out, 0o600);
    process.stdout.write(
      `${JSON.stringify({
        summary: inventory.summary,
        coverage: inventory.coverage,
        freeAuditPdfs: { ...inventory.freeAuditPdfs, jobs: undefined },
      })}\n`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `[inventory:reports] failed: ${error instanceof Error ? error.message : "unknown"}\n`
  );
  process.exitCode = 2;
});
