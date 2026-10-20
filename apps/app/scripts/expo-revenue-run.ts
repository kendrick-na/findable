/**
 * 엑스포 참가업체 매출 실행 진입점 — 실제 DART 호출은 대표 승인 후에만 돌린다.
 *
 * 사용(승인 후):
 *   OPENDART_API_KEY 는 환경변수로만 준다(값은 출력하지 않는다)
 *   npx tsx scripts/expo-revenue-run.ts <회사목록.json> <체크포인트.json> <표출력.md>
 *
 * 회사목록.json: [{ "booth": "E-11", "name": "(주)탑월드" }, ...]  (이메일·전화 필드 없이)
 * 안전: 호출 간격 1초(minIntervalMs), 예산 90초(hasBudget) — 다 쓰면 멈추고 체크포인트에서 이어한다.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fetchDart } from "@/lib/ax-mail/sources/opendart";
import {
  type ExpoCompany,
  loadCheckpoint,
  revenueTable,
  runRevenueLookup,
} from "./expo-revenue-lookup";

async function main(): Promise<void> {
  const [companiesPath, checkpointPath, outPath] = process.argv.slice(2);
  if (!(companiesPath && checkpointPath && outPath)) {
    console.error(
      "usage: expo-revenue-run <companies.json> <checkpoint.json> <out.md>"
    );
    process.exit(2);
  }
  if (!process.env.OPENDART_API_KEY) {
    console.error("OPENDART_API_KEY 가 없습니다(값은 출력하지 않습니다).");
    process.exit(3);
  }
  const companies = JSON.parse(
    await readFile(companiesPath, "utf8")
  ) as ExpoCompany[];
  const checkpoint = await loadCheckpoint(checkpointPath);
  const deadline = Date.now() + 90_000;
  const result = await runRevenueLookup(
    companies,
    async (name) => await fetchDart({ name }),
    checkpoint,
    {
      checkpointPath,
      hasBudget: () => Date.now() < deadline,
      minIntervalMs: 1000,
    }
  );
  await writeFile(
    outPath,
    `${revenueTable(companies, result.checkpoint)}\n`,
    "utf8"
  );
  console.log(
    `calls=${result.calls} skipped=${result.skipped} stoppedBy=${result.stoppedBy} (재실행하면 남은 회사부터 이어함)`
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "unexpected error");
    process.exit(1);
  });
}
