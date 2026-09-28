import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * 개발 서버 전용 — DB 없이 리포트 화면을 보기 위한 fixture.
 * `scripts/import-client-report.ts --out` 으로 만든 동결 스냅숏(= DB 에 들어갈 값 그대로)을 읽는다.
 * load.ts 가 NODE_ENV!=="production" 일 때만 동적 import 한다.
 */
export async function loadClientReportFixture(name: string): Promise<unknown> {
  const file = join(
    process.cwd(),
    "__tests__/fixtures/client-report",
    `${name}.report.json`
  );
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}
