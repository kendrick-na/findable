// 개발·검증 전용 — 계약 fixture(ReportSource@1 + ReportReview@1) → 웹 v2 발행본 fixture(JSON).
//
//   bun scripts/client-report/build-v12-fixture.ts <report_source.json> <report_review.json> <out.report.json> [--issued ISO]
//
// 🔴 DB 에 쓰지 않는다. 결과는 `/r/dev?fixture=<이름>`(개발 서버 전용)과 테스트에서만 쓴다.
// 🔴 fixture 판별은 사람이 승인한 것이 아니다 → reviewer 를 「내부 fixture(실제 검토 아님)」로 박고,
//   발송 승인(sendApproval)은 항상 null — 화면·PDF 모든 쪽에 「내부 시안 · 외부 발송 금지」가 찍힌다.

import { readFileSync, writeFileSync } from "node:fs";
import { buildReportFromReview } from "../../packages/audit/client-report/publish";

const [sourcePath, reviewPath, outPath] = process.argv.slice(2);
if (!(sourcePath && reviewPath && outPath)) {
  process.stderr.write(
    "사용법: bun scripts/client-report/build-v12-fixture.ts <source> <review> <out> [--issued ISO]\n"
  );
  process.exit(1);
}
const issuedFlag = process.argv.indexOf("--issued");
const issuedAt = new Date(
  issuedFlag > 0 ? process.argv[issuedFlag + 1] : "2026-09-30T03:00:00.000Z"
);
const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const review = JSON.parse(readFileSync(reviewPath, "utf8"));
const built = buildReportFromReview({
  source,
  review: {
    ...review,
    status: "approved",
    reviewer: "내부 fixture(실제 검토 아님)",
    reviewedAt: issuedAt.toISOString(),
  },
  mode: "issue",
  slug: "knowverse-v12-fixture",
  version: 1,
  issuedAt,
  staleAfterDays: 3650,
});
if (!built.ok) {
  process.stderr.write(`거부: ${JSON.stringify(built.errors)}\n`);
  process.exit(2);
}
writeFileSync(outPath, `${JSON.stringify(built.data, null, 2)}\n`);
process.stderr.write(
  `저장 ${outPath} · 분모 ${built.data.denominator.n} · 정확 ${built.data.computed.s.ok_n}\n`
);
