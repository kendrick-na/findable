/**
 * 운영 빌드 게이트 TLS 회귀 — 2026-10-20 사고(P1011).
 *
 * 사고: 게이트(`privacy-table-gate.ts`)가 `new PrismaPg({ connectionString })` 를 직접 만들어 Supabase 주소의
 * `sslmode=require` 를 그대로 pg 에 넘겼고 CA 고정이 빠져 TLS 검증 실패(P1011) → 운영 빌드 중단.
 * 런타임(`index.ts`)은 sslmode 를 지우고 SUPABASE_ROOT_CA 를 고정해 정상 접속 중이었다.
 * 지금은 둘 다 `create-client.ts` 의 같은 함수를 쓴다. 여기서 그것을 고정한다. 운영 DB 접속 0.
 *
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pgAdapterConfig } from "@repo/database/create-client";
import { SUPABASE_ROOT_CA } from "@repo/database/supabase-ca";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as { url: string; extra: unknown }[],
}));

// 게이트가 실제로 부르는 공용 팩토리를 가로채 「어떤 주소·옵션으로 불렀나」만 기록한다.
vi.mock("@repo/database/create-client", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@repo/database/create-client")>();
  return {
    ...real,
    createPrismaClient: (url: string, extra: unknown) => {
      h.calls.push({ url, extra });
      return {
        $transaction: () =>
          Promise.resolve([{ table_name: "DeletedClerkUser" }]),
        $disconnect: () => Promise.resolve(),
      };
    },
  };
});

const { readPrivacyTables, PRIVACY_GATE_CONNECT_TIMEOUT_MS } = await import(
  "@repo/database/scripts/privacy-table-gate"
);

const SUPABASE_URL =
  "postgresql://postgres.ref:pw@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require";
const NEON_URL =
  "postgresql://u:pw@ep-x.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const repo = join(process.cwd(), "../..");
const read = (rel: string) => readFileSync(join(repo, rel), "utf8");

describe("게이트는 런타임과 같은 클라이언트 생성 경로를 탄다", () => {
  it("TLS 주소(sslmode=require)로 게이트를 돌리면 공용 createPrismaClient 를 연결 10초 제한과 함께 부른다", async () => {
    const verdict = await readPrivacyTables(SUPABASE_URL);
    expect(verdict.ok).toBe(true);
    expect(h.calls).toEqual([
      {
        url: SUPABASE_URL,
        extra: { connectionTimeoutMillis: PRIVACY_GATE_CONNECT_TIMEOUT_MS },
      },
    ]);
  });

  it("게이트·런타임 소스 모두 직접 new PrismaClient / new PrismaPg 를 하지 않는다", () => {
    for (const rel of [
      "packages/database/scripts/privacy-table-gate.ts",
      "packages/database/index.ts",
    ]) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/new PrismaClient\(|new PrismaPg\(/);
      expect(src, rel).toContain("createPrismaClient(");
    }
  });
});

describe("공용 어댑터 설정(pgAdapterConfig) — 런타임과 게이트가 같이 쓰는 규칙", () => {
  it("Supabase + sslmode=require → sslmode 를 지우고 Supabase 루트 CA 를 고정(검증 켬)", () => {
    const cfg = pgAdapterConfig(SUPABASE_URL, {
      connectionTimeoutMillis: 10_000,
    });
    expect(new URL(cfg.connectionString).searchParams.has("sslmode")).toBe(
      false
    );
    expect(cfg).toMatchObject({
      connectionTimeoutMillis: 10_000,
      ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
    });
  });

  it("Supabase 가 아닌 TLS 주소는 그대로 둔다(sslmode 유지, CA 고정 없음)", () => {
    const cfg = pgAdapterConfig(NEON_URL);
    expect(cfg.connectionString).toBe(NEON_URL);
    expect(cfg).not.toHaveProperty("ssl");
  });

  it("supabase.co 직접 주소도 같은 규칙", () => {
    const cfg = pgAdapterConfig(
      "postgresql://postgres:pw@db.abc.supabase.co:5432/postgres?sslmode=require"
    );
    expect(cfg).toHaveProperty("ssl.ca", SUPABASE_ROOT_CA);
  });
});
