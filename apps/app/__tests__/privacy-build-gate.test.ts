/**
 * apps/app 운영 빌드 게이트(`privacy-build-gate.ts`) — 2026-10-20 코덱스 4차.
 * 운영(VERCEL_ENV=production)에서만 DeletedClerkUser 표 존재를 확인하고, 없거나 확인 불가면 빌드 실패.
 * 운영 DB 접속 0(조회 함수 주입).
 *
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDatabaseUrl } from "@repo/database/keys";
import {
  decidePrivacyBuildGate,
  gateConnectionString,
  PRIVACY_GATE_TOTAL_TIMEOUT_MS,
} from "@repo/database/scripts/privacy-build-gate";
import type { PrivacyTableVerdict } from "@repo/database/scripts/privacy-table-gate";
import { PRIVACY_GATE_CONNECT_TIMEOUT_MS } from "@repo/database/scripts/privacy-table-gate";
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

  it("⛔ 제한 시간 안에 DB 확인이 안 끝나면 실패(연결 문자열 노출 없음) — 기본 60초·연결 10초", async () => {
    expect(PRIVACY_GATE_TOTAL_TIMEOUT_MS).toBe(60_000);
    expect(PRIVACY_GATE_CONNECT_TIMEOUT_MS).toBe(10_000);
    const hang = vi.fn(() => new Promise<PrivacyTableVerdict>(() => undefined));
    const d = await decidePrivacyBuildGate(PROD, hang, 20);
    expect(d.action).toBe("fail");
    expect(d.message).toContain("안에 DB 확인이 끝나지 않음");
    expect(d.message).not.toContain("db.example");
    expect(d.message).not.toContain("u:p");
  });

  it("FINDABLE_DATABASE_URL 이 있으면 런타임처럼 그 DB 를 검사한다(DATABASE_URL 보다 우선)", async () => {
    const read = vi.fn().mockResolvedValue(okVerdict);
    const findable = "postgresql://u:p@findable-prod.example/x";
    const d = await decidePrivacyBuildGate(
      { ...PROD, FINDABLE_DATABASE_URL: findable },
      read
    );
    expect(d.action).toBe("pass");
    expect(read).toHaveBeenCalledWith(findable);
    expect(read).not.toHaveBeenCalledWith(PROD.DATABASE_URL);
  });

  it("게이트와 런타임이 같은 주소 선택 규칙을 쓴다", () => {
    const cases = [
      {
        FINDABLE_DATABASE_URL: "postgresql://a",
        DATABASE_URL: "postgresql://b",
      },
      { DATABASE_URL: "postgresql://b" },
      {},
    ];
    for (const env of cases) {
      expect(gateConnectionString(env)).toBe(resolveDatabaseUrl(env));
    }
  });

  it("⛔ 운영인데 DB 주소(FINDABLE_DATABASE_URL·DATABASE_URL)가 없으면 실패", async () => {
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
