/**
 * 개인정보 배포 게이트 (2026-10-20, 코덱스 3차).
 *  - 필수 표 판정(읽기 전용 점검 스크립트의 순수 부분)
 *  - 마이그레이션 파일이 그 표를 만들고, 기존 표를 건드리지 않는가(additive)
 *  - 잠금 SQL 은 `packages/database/advisory-lock.ts` 한 곳에서만 만든다
 *  - 배포 문서에 「마이그레이션 확인 → 배포 → 실패 모니터링」 체크리스트가 고정돼 있는가
 * 운영 DB 접속 0.
 *
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluatePrivacyTables,
  REQUIRED_PRIVACY_TABLES,
} from "@repo/database/scripts/privacy-table-gate";
import { describe, expect, it } from "vitest";

const repo = join(process.cwd(), "../..");
const read = (rel: string) => readFileSync(join(repo, rel), "utf8");

describe("필수 표 판정", () => {
  it("DeletedClerkUser 가 필수 표 목록에 있다", () => {
    expect(REQUIRED_PRIVACY_TABLES).toContain("DeletedClerkUser");
  });

  it("있으면 ok, 없으면 missing 에 이름이 나온다", () => {
    expect(evaluatePrivacyTables("public", ["DeletedClerkUser"])).toEqual({
      schema: "public",
      present: ["DeletedClerkUser"],
      missing: [],
      ok: true,
    });
    expect(evaluatePrivacyTables("public", ["User"])).toMatchObject({
      ok: false,
      missing: ["DeletedClerkUser"],
    });
  });

  it("점검 스크립트는 읽기 전용이다(READ ONLY + information_schema 만)", () => {
    const gate = read("packages/database/scripts/privacy-table-gate.ts");
    expect(gate).toContain("SET TRANSACTION READ ONLY");
    expect(gate).toContain("information_schema.tables");
    expect(gate).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/);
    const pkg = read("packages/database/package.json");
    expect(pkg).toContain('"check:privacy-tables"');
  });
});

describe("마이그레이션은 추가만 한다", () => {
  it("DeletedClerkUser 를 만들고 다른 표는 바꾸지 않는다", () => {
    const sql = read(
      "packages/database/prisma/migrations/20261020_deleted_clerk_user/migration.sql"
    );
    expect(sql).toContain('CREATE TABLE "DeletedClerkUser"');
    expect(sql).not.toMatch(/\b(ALTER|DROP|DELETE|UPDATE|INSERT)\b/);
  });
});

describe("잠금 SQL 단일 진입점", () => {
  it.each([
    "apps/app/lib/privacy/erase-deleted-user.ts",
    "apps/app/lib/privacy/guarded-user-write.ts",
    "apps/app/app/webhooks/auth/route.ts",
    "apps/web/lib/purge-expired-ip.ts",
  ])("%s 는 raw SQL(잠금 포함)을 직접 실행하지 않는다", (rel) => {
    // 주석 설명은 허용하고, 실제 실행 경로(`$queryRaw`·`$executeRaw`)만 막는다.
    expect(read(rel)).not.toMatch(/\$(query|execute)Raw/);
  });
});

describe("배포 체크리스트 고정", () => {
  it("문서에 마이그레이션 확인 → 배포 → webhook.auth.failed 모니터링 순서가 있다", () => {
    const doc = read("docs/_적용/개인정보_삭제범위_20261020.md");
    const gate = doc.indexOf("check:privacy-tables");
    const deploy = doc.indexOf("앱 배포", gate);
    const monitor = doc.indexOf("webhook.auth.failed", deploy);
    expect(gate).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(gate);
    expect(monitor).toBeGreaterThan(deploy);
  });
});
