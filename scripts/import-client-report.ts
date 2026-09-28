// 고객 GEO 리포트 가져오기 — 템플릿 폴더(audit.json + config.json) → Report.data JSON.
//
// 사용법 (저장소 루트에서):
//   bun scripts/import-client-report.ts <clientDir> [--version 1]                 ← 기본: 출력만(dry-run)
//   bun scripts/import-client-report.ts <clientDir> --out file.json               ← 파일로 저장
//   DATABASE_URL=... bun scripts/import-client-report.ts <clientDir> --write \
//       [--brand-id <id>] [--organization-id <id>]                                 ← 로컬/개발 DB 에만 저장
//
// <clientDir> 예: ../Findable_GEO리포트_템플릿/clients/knowverse
//
// 🔴 --write 는 DB 호스트가 localhost/127.0.0.1 이거나, 호스트를
//   CLIENT_REPORT_ALLOW_DB_HOST 로 **정확히** 적었을 때만 동작한다(프로덕션 DB 보호).
//   저장하면 공유 링크 토큰(256비트)을 새로 만들고 /r/<토큰> 주소를 출력한다.

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type {
  ClientReportAudit,
  ClientReportConfig,
} from "../packages/audit/client-report/compute";
import {
  buildClientReportData,
  clientReportPdfFilename,
} from "../packages/audit/client-report/report-data";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const clientDir = args[0];
if (!clientDir || clientDir.startsWith("--")) {
  process.stderr.write(
    "사용법: bun scripts/import-client-report.ts <clientDir> [--version N] [--out f.json] [--write]\n"
  );
  process.exit(1);
}
const dir = resolve(clientDir);
const version = Number(flag("--version") ?? "1");
if (!Number.isInteger(version) || version < 1) {
  throw new Error("--version 은 1 이상의 정수");
}

const config = JSON.parse(
  readFileSync(join(dir, "config.json"), "utf8")
) as ClientReportConfig;
const audit = JSON.parse(
  readFileSync(join(dir, "audit.json"), "utf8")
) as ClientReportAudit;
const slug = typeof config.slug === "string" ? config.slug : basename(dir);

const data = buildClientReportData({
  config,
  audit,
  slug,
  version,
  importedAt: new Date(),
});

const out = flag("--out");
const json = JSON.stringify(data, null, 2);
if (out) {
  writeFileSync(out, `${json}\n`);
  process.stderr.write(`저장: ${out}\n`);
} else if (!args.includes("--write")) {
  process.stdout.write(`${json}\n`);
}
process.stderr.write(
  `요약: 답변 ${data.computed.s.n}건 · 정확 ${data.computed.s.ok_n}건(${data.computed.s.ok_rate}%) · PDF 파일명 ${clientReportPdfFilename(data)}\n`
);

if (args.includes("--write")) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("--write 에는 DATABASE_URL 이 필요합니다");
  }
  const host = new URL(url).hostname;
  const allowed =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === process.env.CLIENT_REPORT_ALLOW_DB_HOST;
  if (!allowed) {
    throw new Error(
      `DB 호스트 ${host.slice(0, 4)}*** 는 허용 목록에 없습니다. 로컬/개발 DB 만 쓰세요 (CLIENT_REPORT_ALLOW_DB_HOST).`
    );
  }
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import(
    "../packages/database/generated/client"
  );
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  try {
    const accessToken = randomBytes(32).toString("base64url");
    const row = await prisma.report.create({
      data: {
        type: "custom",
        brandId: flag("--brand-id") ?? null,
        organizationId: flag("--organization-id") ?? null,
        accessToken,
        data: JSON.parse(json),
      },
      select: { id: true },
    });
    process.stderr.write(`Report ${row.id} 저장 · 링크 /r/${accessToken}\n`);
  } finally {
    await prisma.$disconnect();
  }
}
