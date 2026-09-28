// 고객 웹 리포트 주소 → PDF 파일 (로컬에서 사람이 돌리는 도구).
//
// 사용법 (저장소 루트, 웹 서버가 떠 있을 때):
//   bun scripts/print-client-report.ts <리포트주소> <저장폴더>
//   예) bun scripts/print-client-report.ts "http://localhost:3001/r/dev?fixture=knowverse" ./out
// 파일명은 규칙대로 자동: 회사명_AI검색진단_v버전_날짜.pdf (리포트 데이터에서 읽는다)
// 로컬 Chrome 경로가 다르면 CHROME_PATH 로 지정.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { printClientReportPdf } from "../packages/audit/client-report/pdf";
import {
  type ClientReportData,
  clientReportPdfFilename,
} from "../packages/audit/client-report/report-data";

const [reportUrl, outDir = "."] = process.argv.slice(2);
if (!reportUrl) {
  process.stderr.write(
    "사용법: bun scripts/print-client-report.ts <리포트주소> [저장폴더]\n"
  );
  process.exit(1);
}

// 파일명에 필요한 브랜드·버전·발행일은 페이지의 <title> 이 아니라 데이터에서 읽어야 정확하다.
// fixture 주소면 fixture 파일을, 아니면 --name 으로 받은 파일명을 쓴다.
const nameFlag = process.argv.indexOf("--name");
let filename = nameFlag >= 0 ? process.argv[nameFlag + 1] : "client-report.pdf";
const fixture = new URL(reportUrl).searchParams.get("fixture");
if (nameFlag < 0 && fixture) {
  const data = (await import(
    `../apps/web/__tests__/fixtures/client-report/${fixture}.report.json`
  )) as { default: ClientReportData };
  filename = clientReportPdfFilename(data.default);
}

const { buffer, pageCount } = await printClientReportPdf(reportUrl);
mkdirSync(outDir, { recursive: true });
const path = join(outDir, filename);
writeFileSync(path, buffer);
process.stderr.write(
  `저장: ${path} (${pageCount}쪽, ${buffer.byteLength} bytes)\n`
);
