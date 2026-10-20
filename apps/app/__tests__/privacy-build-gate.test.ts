/**
 * apps/app 운영 빌드 게이트(`privacy-build-gate.ts`) — 2026-10-20 코덱스 4차.
 * 운영(VERCEL_ENV=production)에서만 DeletedClerkUser 표 존재를 확인하고, 없거나 확인 불가면 빌드 실패.
 * 운영 DB 접속 0(조회 함수 주입).
 *
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decidePrivacyBuildGate } from "@repo/database/scripts/privacy-build-gate";
import type { PrivacyTableVerdict } from "@repo/database/scripts/privacy-table-gate";
import { describe, expect, it, vi } from "vitest";

const okVerdict: PrivacyTableVerdict = {
  schema: "public",
  present: ["DeletedClerkUser"],
  missing: [],
  ok: true,
};
const missingVerdict: PrivacyTableVerdict = {
  schema: "public",
  present: [],
  missing: ["DeletedClerkUser"],
  ok: false,
};
const PROD = {
  VERCEL_ENV: "production",
  DATABASE_URL: "postgresql://u:p@db.example/x",
};

describe("decidePrivacyBuildGate", () => {
  it.each([
    ["preview", { VERCEL_ENV: "preview", DATABASE_URL: "postgresql://x" }],
    ["development", { VERCEL_ENV: "development" }],
    ["로컬(미설정)", {}],
  ])("%s 빌드는 DB 를 조회하지 않고 건너뛴다", async (_name, env) => {
    const read = vi.fn();
    const d = await decidePrivacyBuildGate(env, read);
    expect(d.action).toBe("skip");
    expect(read).not.toHaveBeenCalled();
  });

  it("운영 + 표 있음 → 통과", async () => {
    const read = vi.fn().mockResolvedValue(okVerdict);
    const d = await decidePrivacyBuildGate(PROD, read);
    expect(d.action).toBe("pass");
    expect(read).toHaveBeenCalledWith(PROD.DATABASE_URL);
  });

  it("⛔ 운영 + 표 없음 → 실패(빌드 중단)", async () => {
    const d = await decidePrivacyBuildGate(
      PROD,
      vi.fn().mockResolvedValue(missingVerdict)
    );
    expect(d.action).toBe("fail");
    expect(d.message).toContain("DeletedClerkUser");
  });

  it("⛔ 운영 + DB 접속 실패 → 실패(fail-closed), 연결 문자열은 메시지에 없다", async () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "P1001",
    });
    const d = await decidePrivacyBuildGate(
      PROD,
      vi.fn().mockRejectedValue(err)
    );
    expect(d.action).toBe("fail");
    expect(d.message).not.toContain("db.example");
    expect(d.message).not.toContain("u:p");
  });

  it("⛔ 운영인데 DATABASE_URL 이 없으면 실패", async () => {
    const read = vi.fn();
    const d = await decidePrivacyBuildGate(
      { VERCEL_ENV: "production", DATABASE_URL: "  " },
      read
    );
    expect(d.action).toBe("fail");
    expect(read).not.toHaveBeenCalled();
  });
});

describe("빌드 명령 연결", () => {
  it("apps/app build 가 next build **전에** 게이트를 실행한다", () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8")
    ) as { scripts: { build: string } };
    const build = pkg.scripts.build;
    const gate = build.indexOf(
      "bun ../../packages/database/scripts/privacy-build-gate.ts"
    );
    const next = build.indexOf("next build");
    expect(gate).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(gate);
    // `&&` 로 이어져야 게이트 실패가 빌드 실패가 된다.
    expect(build.slice(gate, next)).toContain("&&");
  });
});
